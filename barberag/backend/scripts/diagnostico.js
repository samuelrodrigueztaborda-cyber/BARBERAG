// backend/scripts/diagnostico.js
// Uso (dentro de backend):  node scripts/diagnostico.js
// Ejecuta contra TU base de datos (la del .env) las mismas consultas que usan el registro y la
// disponibilidad, y muestra cuál falla y por qué. No deja datos guardados.
const db = require("../db");
const { ahoraNegocio } = require("../middleware");

async function paso(nombre, fn) {
  try { const r = await fn(); console.log("✓", nombre, r === undefined ? "" : "→ " + r); }
  catch (e) { console.log("✗", nombre, "\n    causa:", e.message, e.code ? `(código ${e.code})` : "", e.detail || "", e.hint || ""); }
}

(async () => {
  const q = (sql, p) => db.pool.query(sql, p);
  await paso("conexión", async () => { const r = await q("select current_user u, current_database() d, version() v"); return `${r.rows[0].u} @ ${r.rows[0].d} · ${r.rows[0].v.split(",")[0]}`; });
  await paso("hora del negocio (America/Bogota)", () => JSON.stringify(ahoraNegocio()));
  for (const t of ["usuarios", "horarios_barbero", "servicios", "citas", "bloqueos_barbero"]) {
    await paso(`tabla ${t}`, async () => {
      const c = await q("select column_name n, data_type t from information_schema.columns where table_name=$1 order by ordinal_position", [t]);
      if (!c.rows.length) throw new Error("la tabla NO existe");
      const n = await q(`select count(*) from ${t}`);
      return `${n.rows[0].count} filas · ` + c.rows.map((x) => `${x.n}:${x.t}`).join(", ");
    });
  }
  for (const [t, id] of [["usuarios", "id_usuario"], ["citas", "id_cita"]]) {
    await paso(`contador de ids de ${t} (no debe estar por debajo del máximo)`, async () => {
      const m = (await q(`select coalesce(max(${id}),0) m from ${t}`)).rows[0].m;
      const seq = (await q("select pg_get_serial_sequence($1,$2) s", [t, id])).rows[0].s;
      if (!seq) return "sin secuencia";
      const s = (await q(`select last_value, is_called from ${seq}`)).rows[0];
      const siguiente = s.is_called ? Number(s.last_value) + 1 : Number(s.last_value);
      if (siguiente <= m) throw new Error(`el siguiente id sería ${siguiente} pero ya existe el ${m}: los ids están desfasados`);
      return `siguiente id ${siguiente}, máximo actual ${m}`;
    });
  }
  await paso("registro (inserta un usuario de prueba y lo deshace)", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`INSERT INTO usuarios (nombre, correo, telefono, contrasena, rol, estado, acepto_tratamiento_datos, fecha_aceptacion_datos, version_politica_aceptada)
                     VALUES ('Prueba', 'diagnostico@prueba.test', '3000000000', 'x', 'cliente', 'activo', 1, NOW(), '1.0') RETURNING id_usuario`);
      return "se pudo insertar";
    } finally { await c.query("ROLLBACK"); c.release(); }
  });
  const b = (await q("select id_usuario from usuarios where rol='barbero' order by id_usuario limit 1")).rows[0];
  const s = (await q("select id_servicio, duracion_min from servicios order by id_servicio limit 1")).rows[0];
  if (b && s) {
    const fecha = ahoraNegocio().fecha;
    await paso("disponibilidad: servicio", () => q("select duracion_min from servicios where id_servicio=$1 and estado='activo'", [s.id_servicio]).then((r) => `${r.rows.length} fila(s)`));
    await paso("disponibilidad: barbero", () => q("select disponible from usuarios where id_usuario=$1 and rol='barbero' and estado='activo'", [b.id_usuario]).then((r) => JSON.stringify(r.rows[0])));
    await paso("disponibilidad: horario del día", () => q("select hora_inicio, hora_fin from horarios_barbero where id_barbero=$1 and disponible=1", [b.id_usuario]).then((r) => `${r.rows.length} día(s) configurados`));
    await paso("disponibilidad: citas y bloqueos", () => q(`select hora_inicio, hora_fin from citas where id_barbero=$1 and fecha=$2 and estado in ('pendiente','confirmada') and id_cita <> $3
                                                           union all select hora_inicio, hora_fin from bloqueos_barbero where id_barbero=$1 and fecha=$2`, [b.id_usuario, fecha, 0]).then((r) => `${r.rows.length} ocupados`));
  }
  await db.pool.end();
})();