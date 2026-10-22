// backend/routes/negocio.js
// Todo lo relacionado con el catálogo y la identidad del negocio, antes
// repartido en 3 archivos: servicios.js, configuracion.js y resenas.js.
// Cada bloque exporta su propio router, montado en la misma ruta de
// siempre — la API pública no cambió en nada.
//
// servicios: RF-33 a RF-40 · configuración: negocio reutilizable sin tocar código
// reseñas: RF-80 a RF-84

const express = require("express");
const pool = require("../db");
const { requireAuth, requireRole, validarServicio, ahoraNegocio } = require("../middleware");

// ═══════════════════════════════════════════════
// SERVICIOS (montado en /api/servicios)
// ═══════════════════════════════════════════════
const serviciosRouter = express.Router();

// ?activos=1 filtra solo activos (RF-37)
serviciosRouter.get("/", async (req, res) => {
  try {
    const soloActivos = req.query.activos === "1";
    const [rows] = await pool.query(`SELECT * FROM servicios ${soloActivos ? "WHERE estado = 'activo'" : ""} ORDER BY nombre`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los servicios." });
  }
});

serviciosRouter.post("/", requireAuth, requireRole("administrador"), validarServicio, async (req, res) => { // RF-33
  try {
    const { nombre, descripcion, precio, duracion_min } = req.body;
    const [result] = await pool.query(
      "INSERT INTO servicios (nombre, descripcion, precio, duracion_min, estado) VALUES (?, ?, ?, ?, 'activo')",
      [nombre, descripcion || null, precio, duracion_min]
    );
    res.status(201).json({ id_servicio: result.insertId, mensaje: "Servicio registrado correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar el servicio." });
  }
});

serviciosRouter.put("/:id", requireAuth, requireRole("administrador"), validarServicio, async (req, res) => { // RF-34
  try {
    const { nombre, descripcion, precio, duracion_min, estado } = req.body;
    await pool.query(
      `UPDATE servicios SET nombre = COALESCE(?, nombre), descripcion = COALESCE(?, descripcion),
        precio = COALESCE(?, precio), duracion_min = COALESCE(?, duracion_min), estado = COALESCE(?, estado) WHERE id_servicio = ?`,
      [nombre, descripcion, precio, duracion_min, estado, req.params.id]
    );
    res.json({ mensaje: "Servicio actualizado correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el servicio." });
  }
});

serviciosRouter.patch("/:id/estado", requireAuth, requireRole("administrador"), async (req, res) => { // RF-35
  try {
    const { estado } = req.body;
    if (!["activo", "inactivo"].includes(estado)) return res.status(400).json({ error: "Estado no válido." });
    await pool.query("UPDATE servicios SET estado = ? WHERE id_servicio = ?", [estado, req.params.id]);
    res.json({ mensaje: `Servicio ${estado === "activo" ? "activado" : "desactivado"} correctamente.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar el estado del servicio." });
  }
});

serviciosRouter.delete("/:id", requireAuth, requireRole("administrador"), async (req, res) => { // RF-36, RN-36
  try {
    const { id } = req.params;
    const [enUso] = await pool.query("SELECT id_cita FROM citas WHERE id_servicio = ? AND estado IN ('pendiente','confirmada') LIMIT 1", [id]);
    if (enUso.length) return res.status(409).json({ error: "No se puede eliminar: el servicio tiene citas activas asociadas." });
    await pool.query("DELETE FROM servicios WHERE id_servicio = ?", [id]);
    res.json({ mensaje: "Servicio eliminado correctamente." });
  } catch (err) {
    // 23503: el servicio ya aparece en citas pasadas; borrarlo dañaría el historial
    if (err.code === "23503") return res.status(409).json({ error: "No se puede eliminar: el servicio tiene historial de citas. Desactívalo en su lugar." });
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el servicio." });
  }
});

// ═══════════════════════════════════════════════
// CONFIGURACIÓN DEL NEGOCIO (montado en /api/configuracion)
// Para que BarberAg sirva a cualquier barbería sin tocar código.
// ═══════════════════════════════════════════════
const configuracionRouter = express.Router();
const CLAVES_VALIDAS = ["nombre_negocio", "direccion", "telefono", "horario_lun_vie", "horario_sabado", "horario_domingo"];

// pública: la necesitan auth.html e index.html antes de iniciar sesión
configuracionRouter.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT clave, valor FROM configuracion_negocio");
    const config = {};
    rows.forEach((r) => { config[r.clave] = r.valor; });
    res.json(config);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar la configuración del negocio." });
  }
});

configuracionRouter.put("/", requireAuth, requireRole("administrador"), async (req, res) => {
  try {
    const entradas = Object.entries(req.body || {}).filter(([clave]) => CLAVES_VALIDAS.includes(clave));
    if (!entradas.length) return res.status(400).json({ error: "No se enviaron campos de configuración válidos." });
    for (const [clave, valor] of entradas) {
      await pool.query("INSERT INTO configuracion_negocio (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor", [clave, String(valor ?? "")]);
    }
    res.json({ mensaje: "Configuración del negocio actualizada correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar la configuración del negocio." });
  }
});

// ═══════════════════════════════════════════════
// RESEÑAS (montado en /api/resenas)
// Una reseña pertenece a UNA cita completada: de ahí salen el cliente y el barbero,
// así que un cliente nunca puede calificar a un barbero que no lo atendió.
// ═══════════════════════════════════════════════
const resenasRouter = express.Router();

/** "Andrés Ruiz" -> "Andrés R." (a quien no es el dueño de la reseña no se le muestra el apellido completo) */
const nombreCorto = (nombre) => { const [primero, segundo] = nombre.split(" "); return segundo ? `${primero} ${segundo[0]}.` : primero; };

resenasRouter.post("/", requireAuth, requireRole("cliente"), async (req, res) => { // RF-80, RN-83
  try {
    const { id_cita, comentario } = req.body;
    const calificacion = Number(req.body.calificacion);
    if (!Number.isInteger(Number(id_cita)) || !id_cita) return res.status(400).json({ error: "Debes indicar la cita que quieres reseñar." });
    if (!Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5) return res.status(400).json({ error: "La calificación debe ser un número entero entre 1 y 5." });
    if (comentario && (typeof comentario !== "string" || comentario.length > 500)) return res.status(400).json({ error: "El comentario no puede superar los 500 caracteres." });

    const [[cita]] = await pool.query("SELECT id_cliente, id_barbero, estado FROM citas WHERE id_cita = ?", [id_cita]);
    if (!cita) return res.status(404).json({ error: "Cita no encontrada." });
    if (cita.id_cliente !== req.usuario.id_usuario) return res.status(403).json({ error: "Solo puedes reseñar tus propias citas." });
    if (cita.estado !== "completada") return res.status(409).json({ error: "Solo puedes dejar una reseña de una cita ya completada." }); // RN-83

    const [existente] = await pool.query("SELECT id_resena FROM resenas WHERE id_cita = ?", [id_cita]);
    if (existente.length) return res.status(409).json({ error: "Ya dejaste una reseña para esta cita." });

    // el barbero se toma de la cita, no de lo que mande el navegador
    const [result] = await pool.query(
      "INSERT INTO resenas (id_usuario, id_cita, id_barbero, calificacion, comentario) VALUES (?, ?, ?, ?, ?)",
      [req.usuario.id_usuario, id_cita, cita.id_barbero, calificacion, (comentario || "").trim() || null]
    );
    await pool.query( // mantiene la calificación promedio del barbero al día
      "UPDATE usuarios SET calificacion_promedio = (SELECT ROUND(AVG(calificacion), 1) FROM resenas WHERE id_barbero = ?) WHERE id_usuario = ?",
      [cita.id_barbero, cita.id_barbero]
    );
    res.status(201).json({ id_resena: result.insertId, mensaje: "Reseña registrada. ¡Gracias por tu opinión!" });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Ya dejaste una reseña para esta cita." });
    console.error(err);
    res.status(500).json({ error: "Error al registrar la reseña." });
  }
});

// pública: las últimas reseñas para la página de inicio (solo nombre corto del cliente)
resenasRouter.get("/publicas", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.calificacion, r.comentario, r.fecha, u.nombre AS cliente_nombre, b.nombre AS barbero_nombre
       FROM resenas r JOIN usuarios u ON u.id_usuario = r.id_usuario JOIN usuarios b ON b.id_usuario = r.id_barbero
       ORDER BY r.fecha DESC LIMIT 6`
    );
    res.json(rows.map((r) => ({ ...r, cliente_nombre: nombreCorto(r.cliente_nombre) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar las reseñas." });
  }
});

// reseñas de un barbero: el propio barbero y el admin ven el nombre completo; los clientes, el nombre corto
resenasRouter.get("/barbero/:id_barbero", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id_resena, r.calificacion, r.comentario, r.fecha, u.nombre AS cliente_nombre, s.nombre AS servicio_nombre
       FROM resenas r JOIN usuarios u ON u.id_usuario = r.id_usuario
       JOIN citas c ON c.id_cita = r.id_cita JOIN servicios s ON s.id_servicio = c.id_servicio
       WHERE r.id_barbero = ? ORDER BY r.fecha DESC`,
      [req.params.id_barbero]
    );
    const verCompleto = req.usuario.rol === "administrador" || Number(req.usuario.id_usuario) === Number(req.params.id_barbero);
    res.json(verCompleto ? rows : rows.map((r) => ({ ...r, cliente_nombre: nombreCorto(r.cliente_nombre) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar las reseñas." });
  }
});

resenasRouter.get("/mias", requireAuth, requireRole("cliente"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id_resena, r.calificacion, r.comentario, r.fecha, r.id_cita, u.nombre AS barbero_nombre, s.nombre AS servicio_nombre
       FROM resenas r JOIN usuarios u ON u.id_usuario = r.id_barbero
       JOIN citas c ON c.id_cita = r.id_cita JOIN servicios s ON s.id_servicio = c.id_servicio
       WHERE r.id_usuario = ? ORDER BY r.fecha DESC`,
      [req.usuario.id_usuario]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar tus reseñas." });
  }
});

resenasRouter.get("/", requireAuth, requireRole("administrador"), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.id_resena, r.calificacion, r.comentario, r.fecha, u.nombre AS cliente_nombre, b.nombre AS barbero_nombre
      FROM resenas r JOIN usuarios u ON u.id_usuario = r.id_usuario JOIN usuarios b ON b.id_usuario = r.id_barbero
      ORDER BY r.fecha DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar las reseñas." });
  }
});

// ═══════════════════════════════════════════════
// REPORTES (montado en /api/reportes) — RF-30, RF-64
// Cifras reales del mes en curso. El admin ve todo el negocio; el barbero, solo lo suyo.
// "Ingresos" = valor de las citas completadas (+ suscripciones pagadas, solo para el admin).
// ═══════════════════════════════════════════════
const reportesRouter = express.Router();

reportesRouter.get("/resumen", requireAuth, requireRole("administrador", "barbero"), async (req, res) => {
  try {
    const esBarbero = req.usuario.rol === "barbero";
    const filtro = esBarbero ? "AND c.id_barbero = ?" : "";
    const inicioMes = ahoraNegocio().fecha.slice(0, 8) + "01";
    const enElMes = "c.fecha >= ?::date AND c.fecha < (?::date + INTERVAL '1 month')";
    const params = esBarbero ? [inicioMes, inicioMes, req.usuario.id_usuario] : [inicioMes, inicioMes];

    const [[mes]] = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE c.estado = 'completada') AS completadas,
              COUNT(*) FILTER (WHERE c.estado = 'cancelada') AS canceladas,
              COALESCE(SUM(COALESCE(c.precio, s.precio)) FILTER (WHERE c.estado = 'completada'), 0) AS ingresos
       FROM citas c JOIN servicios s ON s.id_servicio = c.id_servicio WHERE ${enElMes} ${filtro}`, params);

    // semana 1 = días 1-7, semana 2 = 8-14, ... semana 5 = 29-31
    const [porSemana] = await pool.query(
      `SELECT ((EXTRACT(DAY FROM c.fecha)::int - 1) / 7) + 1 AS semana, SUM(COALESCE(c.precio, s.precio)) AS ingresos
       FROM citas c JOIN servicios s ON s.id_servicio = c.id_servicio
       WHERE c.estado = 'completada' AND ${enElMes} ${filtro} GROUP BY 1`, params);
    const semanas = [1, 2, 3, 4, 5].map((n) => Number(porSemana.find((x) => x.semana === n)?.ingresos || 0));

    const resumen = {
      ingresos_mes: mes.ingresos,
      citas_completadas: mes.completadas,
      ticket_promedio: mes.completadas ? Math.round(mes.ingresos / mes.completadas) : 0,
      tasa_cancelacion: mes.total ? Math.round((mes.canceladas / mes.total) * 1000) / 10 : 0,
      semanas,
    };
    if (!esBarbero) {
      const [[subs]] = await pool.query(
        `SELECT (SELECT COUNT(*) FROM suscripciones WHERE fecha_inicio >= ?::date AND fecha_inicio < (?::date + INTERVAL '1 month')) AS nuevas,
                (SELECT COALESCE(SUM(monto), 0) FROM pagos WHERE id_suscripcion IS NOT NULL AND estado = 'exitoso'
                   AND fecha >= ?::date AND fecha < (?::date + INTERVAL '1 month')) AS ingresos`, [inicioMes, inicioMes, inicioMes, inicioMes]);
      resumen.nuevas_suscripciones = subs.nuevas;
      resumen.ingresos_suscripciones = subs.ingresos;
    }
    res.json(resumen);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar el reporte." });
  }
});

module.exports = { serviciosRouter, configuracionRouter, resenasRouter, reportesRouter };
