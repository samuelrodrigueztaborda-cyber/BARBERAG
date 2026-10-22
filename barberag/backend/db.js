// backend/db.js
// Conexión a PostgreSQL (Supabase) mediante un pool del driver `pg`.
//
// Las credenciales vienen del .env, así que para usar otra base solo se
// cambia el .env, sin tocar código:
//   - Supabase: define DATABASE_URL (Dashboard > Project Settings > Database
//     > Connection string > URI). Se recomienda el puerto 6543 (pooler).
//   - Postgres local: define DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT.
//
// ── Por qué hay un adaptador aquí ──
// El proyecto se escribió originalmente para MySQL, que usa marcadores `?`
// y devuelve `[filas]`. Postgres usa `$1, $2...` y devuelve `{ rows }`.
// En lugar de reescribir las ~150 consultas del proyecto una por una
// (con el riesgo de equivocarse en alguna), este adaptador traduce el
// dialecto al vuelo y conserva la MISMA forma de respuesta que ya usaban
// las rutas. Resultado: las rutas no cambian y el comportamiento es idéntico.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");
const { AsyncLocalStorage } = require("async_hooks");

// Guarda, por petición HTTP, el último error de la base de datos (lo usa server.js para mostrar la causa real mientras se desarrolla).
const contexto = new AsyncLocalStorage();

// Cómo llegan los tipos de Postgres a JavaScript:
//  · DATE (1082): se deja como texto "AAAA-MM-DD". Por defecto pg lo convierte en un objeto Date
//    y al enviarlo como JSON se desplaza por la zona horaria (ej. "2026-10-07T05:00:00.000Z").
//  · COUNT/BIGINT (20) y NUMERIC/DECIMAL (1700): llegan como número, no como texto.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        // Supabase exige TLS. rejectUnauthorized:false evita tener que instalar
        // su certificado raíz a mano; la conexión sigue yendo cifrada.
        ssl: { rejectUnauthorized: false },
        max: 10,
      }
    : {
        host: process.env.DB_HOST || "localhost",
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "postgres",
        database: process.env.DB_NAME || "barberia_db",
        port: Number(process.env.DB_PORT) || 5432,
        max: 10,
      }
);

/** Convierte los marcadores `?` de MySQL en `$1, $2...` de Postgres. */
function convertirMarcadores(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

/**
 * Ejecuta una consulta conservando la forma de respuesta de mysql2:
 *   SELECT            -> [filas]
 *   INSERT/UPDATE/... -> [{ insertId, affectedRows }]
 * `insertId` se obtiene con RETURNING (Postgres no tiene insertId), tomando
 * la primera columna que empiece por "id_" — todas las llaves primarias del
 * esquema siguen esa convención.
 */
async function query(sql, params = []) {
  let texto = convertirMarcadores(sql);
  const esInsert = /^\s*insert\s/i.test(texto);
  if (esInsert && !/returning/i.test(texto)) texto += " RETURNING *";

  let resultado;
  try { resultado = await pool.query(texto, params); }
  catch (err) { const c = contexto.getStore(); if (c) c.error = err; throw err; }

  if (/^\s*select\s|^\s*with\s/i.test(texto)) return [resultado.rows, resultado.fields];

  const fila = resultado.rows?.[0] || {};
  const clavePk = Object.keys(fila).find((k) => k.startsWith("id_"));
  return [{ insertId: clavePk ? fila[clavePk] : undefined, affectedRows: resultado.rowCount, filas: resultado.rows }, resultado.fields];
}

/** Separa schema.sql en sentencias sueltas (respeta los bloques DO $$ ... $$ y los comentarios). */
function separarSentencias(sql) {
  const sentencias = [];
  let actual = "", enBloque = false;
  for (const linea of sql.split("\n")) {
    if (!enBloque && linea.trim().startsWith("--")) continue; // comentario completo
    actual += linea + "\n";
    if ((linea.match(/\$\$/g) || []).length % 2 === 1) enBloque = !enBloque;
    if (!enBloque && linea.trimEnd().endsWith(";")) { sentencias.push(actual.trim()); actual = ""; }
  }
  if (actual.trim()) sentencias.push(actual.trim());
  return sentencias;
}

/**
 * Si los datos se cargaron con ids escritos a mano (o se importó una copia), el contador automático de ids
 * queda por detrás del mayor id existente y el siguiente INSERT falla con "duplicate key" (por ejemplo, al registrarse).
 * Aquí se adelanta cada contador hasta el mayor id que ya exista.
 */
async function alinearContadores() {
  const { rows } = await pool.query(
    "SELECT table_name t, column_name c FROM information_schema.columns WHERE table_schema = 'public' AND ordinal_position = 1 AND column_name LIKE 'id\\_%'"
  );
  for (const { t, c } of rows) {
    try {
      const seq = (await pool.query("SELECT pg_get_serial_sequence($1, $2) s", [t, c])).rows[0].s;
      if (!seq) continue;
      const { m } = (await pool.query(`SELECT COALESCE(MAX(${c}), 0) m FROM ${t}`)).rows[0];
      const { last_value, is_called } = (await pool.query(`SELECT last_value, is_called FROM ${seq}`)).rows[0];
      if (m > 0 && Number(m) >= (is_called ? Number(last_value) + 1 : Number(last_value))) await pool.query("SELECT setval($1, $2)", [seq, m]);
    } catch (err) { console.error(`⚠️  No se pudo revisar el contador de ids de ${t}:`, err.message); }
  }
}

/**
 * Crea/actualiza las tablas ejecutando schema.sql (es idempotente: solo agrega lo que falta).
 * Se llama al arrancar el servidor, así una base ya creada recibe las tablas y columnas nuevas sin pasos manuales.
 * Cada sentencia va por separado: si una falla se muestra cuál fue y las demás se aplican igual.
 */
async function iniciarEsquema() {
  const fallas = [];
  for (const sentencia of separarSentencias(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"))) {
    try { await pool.query(sentencia); }
    catch (err) {
      if (!/^[0-9A-Z]{5}$/.test(err.code || "")) throw err; // no es un error de SQL sino de conexión: no tiene sentido seguir
      fallas.push(`${sentencia.split("\n")[0].slice(0, 70)} → ${err.message}`);
    }
  }
  await alinearContadores();
  if (fallas.length) throw new Error(`Fallaron ${fallas.length} sentencia(s) del esquema:\n   - ${fallas.join("\n   - ")}`);
}

module.exports = { query, pool, iniciarEsquema, contexto };