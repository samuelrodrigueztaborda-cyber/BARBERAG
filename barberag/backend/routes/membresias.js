// backend/routes/membresias.js
// Planes de membresía y suscripciones de clientes (RF-68 a RF-79).

const express = require("express");
const pool = require("../db");
const { requireAuth, requireRole, ahoraNegocio } = require("../middleware");

// ═══════════════════════════════════════════════
// PLANES (montado en /api/planes)
// ═══════════════════════════════════════════════
const planesRouter = express.Router();

// pública: los planes activos (los muestran la página de inicio y el panel del cliente)
planesRouter.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id_plan, nombre, descripcion, precio, duracion_dias FROM planes WHERE estado = 'activo' ORDER BY precio");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los planes." });
  }
});

// admin: todos los planes con su número de suscriptores activos
planesRouter.get("/todos", requireAuth, requireRole("administrador"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, (SELECT COUNT(*) FROM suscripciones s WHERE s.id_plan = p.id_plan AND s.estado = 'activa' AND s.fecha_fin >= CURRENT_DATE) AS suscriptores
       FROM planes p ORDER BY p.precio`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los planes." });
  }
});

function validarPlan(req, res, next) { // RN-68
  const { nombre, precio, duracion_dias } = req.body;
  if (req.method === "POST" && (!nombre || nombre.trim().length < 3)) return res.status(400).json({ error: "El nombre del plan debe tener al menos 3 caracteres." });
  if (precio !== undefined && (isNaN(precio) || Number(precio) <= 0)) return res.status(400).json({ error: "El precio debe ser un número mayor a cero." });
  if (duracion_dias !== undefined && (!Number.isInteger(Number(duracion_dias)) || Number(duracion_dias) <= 0)) return res.status(400).json({ error: "La duración debe ser un número entero de días mayor a cero." });
  if (req.method === "POST" && (precio === undefined || duracion_dias === undefined)) return res.status(400).json({ error: "El precio y la duración son obligatorios." });
  next();
}

planesRouter.post("/", requireAuth, requireRole("administrador"), validarPlan, async (req, res) => {
  try {
    const { nombre, descripcion, precio, duracion_dias } = req.body;
    const [r] = await pool.query("INSERT INTO planes (nombre, descripcion, precio, duracion_dias) VALUES (?, ?, ?, ?)", [nombre.trim(), descripcion || null, precio, duracion_dias]);
    res.status(201).json({ id_plan: r.insertId, mensaje: "Plan creado correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear el plan." });
  }
});

planesRouter.put("/:id", requireAuth, requireRole("administrador"), validarPlan, async (req, res) => {
  try {
    const { nombre, descripcion, precio, duracion_dias, estado } = req.body;
    if (estado !== undefined && !["activo", "inactivo"].includes(estado)) return res.status(400).json({ error: "Estado no válido." });
    await pool.query(
      `UPDATE planes SET nombre = COALESCE(?, nombre), descripcion = COALESCE(?, descripcion), precio = COALESCE(?, precio),
        duracion_dias = COALESCE(?, duracion_dias), estado = COALESCE(?, estado) WHERE id_plan = ?`,
      [nombre, descripcion, precio, duracion_dias, estado, req.params.id]
    );
    res.json({ mensaje: "Plan actualizado correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el plan." });
  }
});

// ═══════════════════════════════════════════════
// SUSCRIPCIONES (montado en /api/suscripciones)
// ═══════════════════════════════════════════════
const suscripcionesRouter = express.Router();
suscripcionesRouter.use(requireAuth);

const SELECT_SUSCRIPCION = `
  SELECT s.id_suscripcion, s.id_usuario, u.nombre AS cliente_nombre, s.id_plan, p.nombre AS plan_nombre, p.precio, p.duracion_dias,
         s.fecha_inicio, s.fecha_fin, s.estado,
         EXISTS (SELECT 1 FROM pagos pg WHERE pg.id_suscripcion = s.id_suscripcion AND pg.estado = 'exitoso') AS pagada
  FROM suscripciones s JOIN usuarios u ON u.id_usuario = s.id_usuario JOIN planes p ON p.id_plan = s.id_plan
`;

// las suscripciones activas cuya fecha ya pasó se marcan como vencidas
const marcarVencidas = () => pool.query("UPDATE suscripciones SET estado = 'vencida' WHERE estado = 'activa' AND fecha_fin < ?", [ahoraNegocio().fecha]);

suscripcionesRouter.get("/", requireRole("administrador"), async (req, res) => {
  try {
    await marcarVencidas();
    const [rows] = await pool.query(`${SELECT_SUSCRIPCION} ORDER BY s.fecha_inicio DESC, s.id_suscripcion DESC`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar las suscripciones." });
  }
});

suscripcionesRouter.get("/mias", requireRole("cliente"), async (req, res) => {
  try {
    await marcarVencidas();
    const [rows] = await pool.query(`${SELECT_SUSCRIPCION} WHERE s.id_usuario = ? ORDER BY s.fecha_inicio DESC, s.id_suscripcion DESC`, [req.usuario.id_usuario]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar tus suscripciones." });
  }
});

// suma `dias` a una fecha AAAA-MM-DD
const sumarDias = (fecha, dias) => new Date(new Date(`${fecha}T00:00:00Z`).getTime() + dias * 864e5).toISOString().slice(0, 10);

// RF-70: el cliente se suscribe a un plan (o el admin se lo asigna a un cliente). RN-70: una sola suscripción activa.
suscripcionesRouter.post("/", requireRole("cliente", "administrador"), async (req, res) => {
  try {
    const id_usuario = req.usuario.rol === "cliente" ? req.usuario.id_usuario : req.body.id_usuario;
    const { id_plan } = req.body;
    if (!id_usuario || !id_plan) return res.status(400).json({ error: "Debes indicar el cliente y el plan." });

    const [[cliente]] = await pool.query("SELECT id_usuario FROM usuarios WHERE id_usuario = ? AND rol = 'cliente' AND estado = 'activo'", [id_usuario]);
    if (!cliente) return res.status(404).json({ error: "Cliente no encontrado." });
    const [[plan]] = await pool.query("SELECT duracion_dias FROM planes WHERE id_plan = ? AND estado = 'activo'", [id_plan]);
    if (!plan) return res.status(404).json({ error: "Plan no encontrado o inactivo." });

    await marcarVencidas();
    const [vigente] = await pool.query("SELECT id_suscripcion FROM suscripciones WHERE id_usuario = ? AND estado IN ('activa','pausada') LIMIT 1", [id_usuario]);
    if (vigente.length) return res.status(409).json({ error: "Este cliente ya tiene una suscripción vigente." });

    const inicio = ahoraNegocio().fecha;
    const [r] = await pool.query(
      "INSERT INTO suscripciones (id_usuario, id_plan, fecha_inicio, fecha_fin, estado) VALUES (?, ?, ?, ?, 'activa')",
      [id_usuario, id_plan, inicio, sumarDias(inicio, plan.duracion_dias)]
    );
    res.status(201).json({ id_suscripcion: r.insertId, mensaje: "Suscripción creada correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear la suscripción." });
  }
});

// RF-77: renovar (extiende la fecha de vencimiento un periodo más)
suscripcionesRouter.post("/:id/renovar", requireRole("cliente", "administrador"), async (req, res) => {
  try {
    const [[s]] = await pool.query("SELECT s.id_usuario, s.fecha_fin, s.estado, p.duracion_dias FROM suscripciones s JOIN planes p ON p.id_plan = s.id_plan WHERE s.id_suscripcion = ?", [req.params.id]);
    if (!s) return res.status(404).json({ error: "Suscripción no encontrada." });
    if (req.usuario.rol === "cliente" && s.id_usuario !== req.usuario.id_usuario) return res.status(403).json({ error: "No puedes renovar la suscripción de otro cliente." });
    if (s.estado === "cancelada") return res.status(409).json({ error: "Una suscripción cancelada no se puede renovar; crea una nueva." });

    const hoy = ahoraNegocio().fecha;
    const base = s.fecha_fin > hoy ? s.fecha_fin : hoy; // si ya venció, cuenta desde hoy
    await pool.query("UPDATE suscripciones SET fecha_fin = ?, estado = 'activa' WHERE id_suscripcion = ?", [sumarDias(base, s.duracion_dias), req.params.id]);
    res.json({ mensaje: "Suscripción renovada correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al renovar la suscripción." });
  }
});

// RF-77: pausar / reactivar / cancelar
suscripcionesRouter.put("/:id/estado", requireRole("cliente", "administrador"), async (req, res) => {
  try {
    const { estado } = req.body;
    const permitidos = req.usuario.rol === "cliente" ? ["cancelada"] : ["activa", "pausada", "cancelada"];
    if (!permitidos.includes(estado)) return res.status(400).json({ error: "Estado no válido." });
    const [[s]] = await pool.query("SELECT id_usuario, estado FROM suscripciones WHERE id_suscripcion = ?", [req.params.id]);
    if (!s) return res.status(404).json({ error: "Suscripción no encontrada." });
    if (req.usuario.rol === "cliente" && s.id_usuario !== req.usuario.id_usuario) return res.status(403).json({ error: "No puedes modificar la suscripción de otro cliente." });
    if (s.estado === "cancelada") return res.status(409).json({ error: "Esta suscripción ya fue cancelada." });
    await pool.query("UPDATE suscripciones SET estado = ? WHERE id_suscripcion = ?", [estado, req.params.id]);
    res.json({ mensaje: `Suscripción ${estado}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar la suscripción." });
  }
});

module.exports = { planesRouter, suscripcionesRouter };
