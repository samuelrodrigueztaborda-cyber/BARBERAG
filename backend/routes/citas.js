// backend/routes/citas.js
// RF-01, RF-03, RF-08, RF-12, RF-15, RF-17, RF-21, RF-22, RF-26, RF-28, RF-30

const express = require("express");
const pool = require("../db");
const { requireAuth, requireRole, validarCita, ahoraNegocio, fechaValida } = require("../middleware");

const router = express.Router();

const SELECT_BASE = `
  SELECT
    c.id_cita, c.fecha, c.hora_inicio, c.hora_fin, c.estado, c.motivo_cancelacion,
    COALESCE(c.precio, s.precio) AS precio,
    cli.id_usuario AS id_cliente, cli.nombre AS cliente_nombre,
    bar.id_usuario AS id_barbero, bar.nombre AS barbero_nombre,
    s.id_servicio, s.nombre AS servicio_nombre,
    EXISTS (SELECT 1 FROM resenas r WHERE r.id_cita = c.id_cita) AS resenada,
    EXISTS (SELECT 1 FROM pagos p WHERE p.id_cita = c.id_cita AND p.estado = 'exitoso') AS pagada
  FROM citas c
  JOIN usuarios cli ON cli.id_usuario = c.id_cliente
  JOIN usuarios bar ON bar.id_usuario = c.id_barbero
  JOIN servicios s  ON s.id_servicio = c.id_servicio
`;

// ── horarios libres ──
// Una sola función decide qué horas se pueden reservar. La usan la consulta de disponibilidad
// (lo que ve el cliente) y el POST que crea la cita (lo que el servidor realmente acepta),
// así lo que se muestra y lo que se permite siempre coinciden.
const PASO_MIN = 30; // las citas pueden empezar cada 30 minutos
const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const aMin = (hora) => { const [h, m] = hora.split(":").map(Number); return h * 60 + m; };
const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;

async function horariosLibres(idBarbero, fecha, duracion, excluirCita = 0) {
  const { fecha: hoy, minutos: ahora } = ahoraNegocio();
  if (fecha < hoy) return [];

  const dia = DIAS[new Date(`${fecha}T00:00:00Z`).getUTCDay()];
  const [[horario]] = await pool.query(
    "SELECT hora_inicio, hora_fin FROM horarios_barbero WHERE id_barbero = ? AND dia_semana = ? AND disponible::int = 1",
    [idBarbero, dia]
  );
  if (!horario) return []; // el barbero no atiende ese día

  // ocupado = citas pendientes/confirmadas + bloqueos que el barbero marcó
  const [ocupado] = await pool.query(
    `SELECT hora_inicio, hora_fin FROM citas WHERE id_barbero = ? AND fecha = ? AND estado IN ('pendiente','confirmada') AND id_cita <> ?
     UNION ALL
     SELECT hora_inicio, hora_fin FROM bloqueos_barbero WHERE id_barbero = ? AND fecha = ?`,
    [idBarbero, fecha, excluirCita, idBarbero, fecha]
  );

  const libres = [];
  for (let ini = aMin(horario.hora_inicio); ini + duracion <= aMin(horario.hora_fin); ini += PASO_MIN) {
    const fin = ini + duracion;
    const choca = ocupado.some((o) => ini < aMin(o.hora_fin) && fin > aMin(o.hora_inicio));
    const yaPaso = fecha === hoy && ini <= ahora;
    if (!choca && !yaPaso) libres.push({ hora_inicio: aHora(ini), hora_fin: aHora(fin) });
  }
  return libres;
}

// GET /api/citas  — lista todas (uso del admin). Filtros opcionales: ?estado=&fecha=&id_barbero=
router.get("/", requireAuth, requireRole("administrador"), async (req, res) => {
  try {
    const { estado, fecha, id_barbero } = req.query;
    const condiciones = [];
    const params = [];

    if (estado && estado !== "todas") { condiciones.push("c.estado = ?"); params.push(estado); }
    if (fecha) {
      if (!fechaValida(fecha)) return res.status(400).json({ error: "La fecha debe tener el formato AAAA-MM-DD." });
      condiciones.push("c.fecha = ?"); params.push(fecha);
    }
    if (id_barbero) { condiciones.push("c.id_barbero = ?"); params.push(id_barbero); }

    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
    const [rows] = await pool.query(`${SELECT_BASE} ${where} ORDER BY c.fecha, c.hora_inicio`, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar las citas." });
  }
});

/** El barbero solo ve lo suyo; el admin ve cualquiera; el cliente no entra. */
function soloSuyoOAdmin(req, res, idBarbero) {
  if (req.usuario.rol === "administrador") return true;
  if (req.usuario.rol === "barbero" && Number(req.usuario.id_usuario) === Number(idBarbero)) return true;
  res.status(403).json({ error: "Solo puedes consultar tus propias citas." });
  return false;
}

// GET /api/citas/pendientes/:id_barbero — TODAS las solicitudes pendientes de este barbero,
// sin importar la fecha (para aceptarlas/rechazarlas apenas el cliente las pide)
router.get("/pendientes/:id_barbero", requireAuth, async (req, res) => {
  try {
    const { id_barbero } = req.params;
    if (!soloSuyoOAdmin(req, res, id_barbero)) return;
    const [rows] = await pool.query(
      `${SELECT_BASE} WHERE c.id_barbero = ? AND c.estado = 'pendiente' ORDER BY c.fecha, c.hora_inicio`,
      [id_barbero]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar las solicitudes pendientes." });
  }
});

// GET /api/citas/agenda/:id_barbero?fecha=YYYY-MM-DD  — agenda de un barbero (RF-22)
router.get("/agenda/:id_barbero", requireAuth, async (req, res) => {
  try {
    const { id_barbero } = req.params;
    const fecha = req.query.desde || req.query.fecha || ahoraNegocio().fecha;
    if (!fechaValida(fecha)) return res.status(400).json({ error: "La fecha debe tener el formato AAAA-MM-DD." });
    if (!soloSuyoOAdmin(req, res, id_barbero)) return;

    // ?fecha= → solo ese día · ?desde= → ese día completo + las citas pendientes/confirmadas de los días siguientes
    const condicion = req.query.desde ? "c.fecha >= ? AND (c.fecha = ? OR c.estado IN ('pendiente','confirmada'))" : "c.fecha = ?";
    const params = req.query.desde ? [id_barbero, fecha, fecha] : [id_barbero, fecha];
    const [rows] = await pool.query(`${SELECT_BASE} WHERE c.id_barbero = ? AND ${condicion} ORDER BY c.fecha, c.hora_inicio`, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar la agenda." });
  }
});

// GET /api/citas/historial/:id_barbero — todas las citas ya completadas o canceladas (RF-30)
router.get("/historial/:id_barbero", requireAuth, async (req, res) => {
  try {
    const { id_barbero } = req.params;
    if (!soloSuyoOAdmin(req, res, id_barbero)) return;
    const [rows] = await pool.query(
      `${SELECT_BASE} WHERE c.id_barbero = ? AND c.estado IN ('completada','cancelada') ORDER BY c.fecha DESC, c.hora_inicio DESC`,
      [id_barbero]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar el historial." });
  }
});

// GET /api/citas/mias — citas del cliente que inició sesión (para su propio panel)
router.get("/mias", requireAuth, requireRole("cliente"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `${SELECT_BASE} WHERE c.id_cliente = ? ORDER BY c.fecha DESC, c.hora_inicio DESC`,
      [req.usuario.id_usuario]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar tus citas." });
  }
});

// GET /api/citas/disponibilidad?id_barbero=&fecha=&id_servicio= — horarios libres reales
router.get("/disponibilidad", requireAuth, async (req, res) => {
  try {
    const { id_barbero, fecha, id_servicio } = req.query;
    if (!Number.isInteger(Number(id_barbero)) || !Number.isInteger(Number(id_servicio)) || !id_barbero || !id_servicio) {
      return res.status(400).json({ error: "id_barbero e id_servicio son obligatorios y deben ser números." });
    }
    if (!fechaValida(fecha)) return res.status(400).json({ error: "La fecha debe tener el formato AAAA-MM-DD." });

    const [[servicio]] = await pool.query("SELECT duracion_min FROM servicios WHERE id_servicio = ? AND estado = 'activo'", [id_servicio]);
    if (!servicio) return res.status(404).json({ error: "Servicio no encontrado o inactivo." });

    const [[barbero]] = await pool.query("SELECT disponible FROM usuarios WHERE id_usuario = ? AND rol = 'barbero' AND estado = 'activo'", [id_barbero]);
    if (!barbero) return res.status(404).json({ error: "Barbero no encontrado." });
    if (!barbero.disponible) return res.json([]); // el barbero se marcó como no disponible

    // `excluir` = cita que se está reprogramando (su propio horario no cuenta como ocupado)
    res.json(await horariosLibres(id_barbero, fecha, servicio.duracion_min, Number(req.query.excluir) || 0));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar la disponibilidad." });
  }
});

// POST /api/citas  — registrar cita (RF-01 admin / RF-02 cliente)
router.post("/", requireAuth, requireRole("cliente", "administrador"), validarCita, async (req, res) => {
  try {
    let { id_cliente, id_barbero, id_servicio, fecha, hora_inicio } = req.body;

    // un cliente solo puede agendar citas para sí mismo, nunca en nombre de otro
    if (req.usuario.rol === "cliente") id_cliente = req.usuario.id_usuario;
    if (![id_cliente, id_barbero, id_servicio].every((v) => Number.isInteger(Number(v)) && Number(v) > 0)) {
      return res.status(400).json({ error: "Faltan datos obligatorios para agendar la cita." });
    }

    // RN: un cliente solo puede agendar dentro del mes actual o el siguiente
    if (req.usuario.rol === "cliente") {
      const [anio, mes] = ahoraNegocio().fecha.split("-").map(Number);
      const ultimoDiaMesSiguiente = new Date(Date.UTC(anio, mes + 1, 0)).toISOString().slice(0, 10);
      if (fecha > ultimoDiaMesSiguiente) return res.status(400).json({ error: "Solo puedes agendar citas dentro de este mes o el siguiente." });
    }

    const [[cliente]] = await pool.query("SELECT id_usuario FROM usuarios WHERE id_usuario = ? AND rol = 'cliente' AND estado = 'activo'", [id_cliente]);
    if (!cliente) return res.status(404).json({ error: "Cliente no encontrado." });
    const [[servicio]] = await pool.query("SELECT duracion_min, precio FROM servicios WHERE id_servicio = ? AND estado = 'activo'", [id_servicio]);
    if (!servicio) return res.status(404).json({ error: "Servicio no encontrado o inactivo." });
    const [[barbero]] = await pool.query("SELECT disponible FROM usuarios WHERE id_usuario = ? AND rol = 'barbero' AND estado = 'activo'", [id_barbero]);
    if (!barbero) return res.status(404).json({ error: "Barbero no encontrado." });
    if (!barbero.disponible) return res.status(409).json({ error: "Este barbero no está disponible para nuevas citas." });

    // el horario pedido tiene que estar entre los libres (dentro de su jornada, sin cruzar otra cita ni un bloqueo)
    const inicio = hora_inicio.length === 5 ? `${hora_inicio}:00` : hora_inicio;
    const slot = (await horariosLibres(id_barbero, fecha, servicio.duracion_min)).find((s) => s.hora_inicio === inicio);
    if (!slot) return res.status(409).json({ error: "Ese horario ya no está disponible. Elige otro." }); // RN-02

    const [result] = await pool.query(
      `INSERT INTO citas (id_cliente, id_barbero, id_servicio, fecha, hora_inicio, hora_fin, estado, precio)
       VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?)`,
      [id_cliente, id_barbero, id_servicio, fecha, slot.hora_inicio, slot.hora_fin, servicio.precio]
    );
    res.status(201).json({ id_cita: result.insertId, mensaje: "Cita registrada correctamente." });
  } catch (err) {
    // 23P01 = la restricción de la base de datos frenó una reserva simultánea al mismo horario
    if (err.code === "23P01") return res.status(409).json({ error: "Ese horario acaba de ser reservado. Elige otro." });
    console.error(err);
    res.status(500).json({ error: "Error al registrar la cita." });
  }
});

// Cambios de estado permitidos: una cita completada o cancelada ya no se toca
const TRANSICIONES = { pendiente: ["confirmada", "cancelada"], confirmada: ["completada", "cancelada"], completada: [], cancelada: [] };

// PUT /api/citas/:id/estado  — confirmar, cancelar, completar (RF-08, RF-12, RF-17)
router.put("/:id/estado", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, motivo_cancelacion } = req.body;

    if (!Object.keys(TRANSICIONES).includes(estado)) return res.status(400).json({ error: "Estado no válido." });

    const [[cita]] = await pool.query("SELECT id_cliente, id_barbero, estado FROM citas WHERE id_cita = ?", [id]);
    if (!cita) return res.status(404).json({ error: "Cita no encontrada." });

    const { rol, id_usuario } = req.usuario;
    // un cliente solo puede cancelar SU PROPIA cita; un barbero solo actúa sobre las suyas
    if (rol === "cliente") {
      if (estado !== "cancelada") return res.status(403).json({ error: "Solo puedes cancelar tus citas; confirmarlas o completarlas le corresponde al negocio." });
      if (cita.id_cliente !== id_usuario) return res.status(403).json({ error: "No puedes cancelar la cita de otro cliente." });
    }
    if (rol === "barbero" && cita.id_barbero !== id_usuario) return res.status(403).json({ error: "No puedes modificar la cita de otro barbero." });

    if (!TRANSICIONES[cita.estado].includes(estado)) {
      return res.status(409).json({ error: `Una cita ${cita.estado} no se puede pasar a ${estado}.` });
    }
    // RN-17: cancelar requiere motivo
    if (estado === "cancelada" && !(motivo_cancelacion || "").trim()) {
      return res.status(400).json({ error: "Debes indicar el motivo de la cancelación." });
    }

    await pool.query("UPDATE citas SET estado = ?, motivo_cancelacion = ? WHERE id_cita = ?", [estado, estado === "cancelada" ? motivo_cancelacion.trim() : null, id]);
    res.json({ mensaje: `Cita actualizada a estado "${estado}".` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar la cita." });
  }
});

// PUT /api/citas/:id  — reprogramar: cambiar barbero, servicio, fecha u hora (RF-12, RF-15)
// Pasa por las mismas reglas que crear una cita: el nuevo horario debe estar libre.
router.put("/:id", requireAuth, requireRole("administrador"), async (req, res) => {
  try {
    const { id } = req.params;
    const [[cita]] = await pool.query("SELECT estado FROM citas WHERE id_cita = ?", [id]);
    if (!cita) return res.status(404).json({ error: "Cita no encontrada." });
    if (["completada", "cancelada"].includes(cita.estado)) {
      return res.status(409).json({ error: "No se puede modificar una cita completada o cancelada." });
    }

    const { id_barbero, id_servicio, fecha, hora_inicio } = req.body;
    if (!id_barbero || !id_servicio || !fechaValida(fecha) || !hora_inicio) {
      return res.status(400).json({ error: "Faltan barbero, servicio, fecha u hora." });
    }
    const [[servicio]] = await pool.query("SELECT duracion_min, precio FROM servicios WHERE id_servicio = ? AND estado = 'activo'", [id_servicio]);
    if (!servicio) return res.status(404).json({ error: "Servicio no encontrado o inactivo." });
    const [[barbero]] = await pool.query("SELECT disponible FROM usuarios WHERE id_usuario = ? AND rol = 'barbero' AND estado = 'activo'", [id_barbero]);
    if (!barbero || !barbero.disponible) return res.status(409).json({ error: "Ese barbero no está disponible." });

    const inicio = hora_inicio.length === 5 ? `${hora_inicio}:00` : hora_inicio;
    const slot = (await horariosLibres(id_barbero, fecha, servicio.duracion_min, id)).find((x) => x.hora_inicio === inicio);
    if (!slot) return res.status(409).json({ error: "Ese horario no está disponible. Elige otro." });

    await pool.query(
      "UPDATE citas SET id_barbero = ?, id_servicio = ?, fecha = ?, hora_inicio = ?, hora_fin = ?, precio = ? WHERE id_cita = ?",
      [id_barbero, id_servicio, fecha, slot.hora_inicio, slot.hora_fin, servicio.precio, id]
    );
    res.json({ mensaje: "Cita reprogramada correctamente." });
  } catch (err) {
    if (err.code === "23P01") return res.status(409).json({ error: "El barbero ya tiene una cita en ese horario." });
    console.error(err);
    res.status(500).json({ error: "Error al reprogramar la cita." });
  }
});

module.exports = router;