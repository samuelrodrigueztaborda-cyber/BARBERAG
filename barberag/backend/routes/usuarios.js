// backend/routes/usuarios.js
// Todo lo relacionado con la tabla `usuarios` en un solo archivo:
// autenticación/perfil (antes auth.js), barberos (antes barberos.js) y
// clientes (antes clientes.js). Cada bloque exporta su propio router y
// server.js los monta exactamente en las mismas rutas de siempre — la
// API pública no cambió en nada, solo dónde vive el código.
//
// auth: RF-41 a RF-45, RNF-12/15 · barberos: RF-46 a RF-53 · clientes: RF-42, RF-49, RF-53, RF-55

const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { JWT_SECRET, requireAuth, requireRole, validarRegistroUsuario, correoValido, contrasenaValida, ahoraNegocio, fechaValida, horaValida } = require("../middleware");

// ═══════════════════════════════════════════════
// AUTH (montado en /api/auth)
// ═══════════════════════════════════════════════
const authRouter = express.Router();

// POST /registro — autorregistro público de clientes (RF-41)
// RN-42: exige constancia del consentimiento de datos (Ley 1581 de 2012)
authRouter.post("/registro", validarRegistroUsuario, async (req, res) => {
  try {
    const { nombre, correo, telefono, contrasena, acepto_tratamiento_datos } = req.body;
    if (!acepto_tratamiento_datos) {
      return res.status(400).json({ error: "Debes autorizar el tratamiento de tus datos personales (Ley 1581 de 2012) para registrarte." });
    }
    const [existe] = await pool.query("SELECT id_usuario FROM usuarios WHERE correo = ?", [correo]);
    if (existe.length) return res.status(409).json({ error: "Ya existe una cuenta registrada con ese correo." });

    const hash = await bcrypt.hash(contrasena, 10);
    const [result] = await pool.query(
      `INSERT INTO usuarios (nombre, correo, telefono, contrasena, rol, estado, acepto_tratamiento_datos, fecha_aceptacion_datos, version_politica_aceptada)
       VALUES (?, ?, ?, ?, 'cliente', 'activo', '1', NOW(), '1.0')`,
      [nombre, correo, telefono, hash]
    );
    const token = jwt.sign({ id_usuario: result.insertId, nombre, rol: "cliente" }, JWT_SECRET, { expiresIn: "8h" }); // autologin
    res.status(201).json({ token, usuario: { id_usuario: result.insertId, nombre, correo, rol: "cliente" } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar la cuenta." });
  }
});

// POST /login
authRouter.post("/login", async (req, res) => {
  try {
    const { correo, contrasena } = req.body;
    if (!correo || !contrasena) return res.status(400).json({ error: "Correo y contraseña son obligatorios." });

    const [[usuario]] = await pool.query(
      "SELECT id_usuario, nombre, correo, contrasena, rol, estado FROM usuarios WHERE correo = ?", [correo]
    );
    if (!usuario) return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    if (usuario.estado === "inactivo") return res.status(403).json({ error: "Esta cuenta está desactivada." });
    if (!(await bcrypt.compare(contrasena, usuario.contrasena))) return res.status(401).json({ error: "Correo o contraseña incorrectos." });

    const token = jwt.sign({ id_usuario: usuario.id_usuario, nombre: usuario.nombre, rol: usuario.rol }, JWT_SECRET, { expiresIn: "8h" }); // RNF-15: expira sola
    res.json({ token, usuario: { id_usuario: usuario.id_usuario, nombre: usuario.nombre, correo: usuario.correo, rol: usuario.rol } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al iniciar sesión." });
  }
});

// GET/PUT /perfil — cada usuario consulta y edita sus propios datos
authRouter.get("/perfil", requireAuth, async (req, res) => {
  try {
    const [[usuario]] = await pool.query(
      "SELECT id_usuario, nombre, correo, telefono, rol, especialidad FROM usuarios WHERE id_usuario = ?", [req.usuario.id_usuario]
    );
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado." });
    res.json(usuario);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar tu perfil." });
  }
});

authRouter.put("/perfil", requireAuth, async (req, res) => {
  try {
    const { nombre, telefono, correo, especialidad, contrasena_actual, nueva_contrasena } = req.body;
    const idUsuario = req.usuario.id_usuario;

    if (nombre !== undefined && nombre.trim().length < 3) return res.status(400).json({ error: "El nombre debe tener al menos 3 caracteres." });
    if (correo !== undefined) {
      if (!correoValido(correo)) return res.status(400).json({ error: "El correo no tiene un formato válido." });
      const [existe] = await pool.query("SELECT id_usuario FROM usuarios WHERE correo = ? AND id_usuario != ?", [correo, idUsuario]);
      if (existe.length) return res.status(409).json({ error: "Ese correo ya está en uso por otra cuenta." });
    }
    if (nueva_contrasena) {
      if (!contrasena_actual) return res.status(400).json({ error: "Debes indicar tu contraseña actual para poder cambiarla." });
      if (!contrasenaValida(nueva_contrasena)) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres." });
      const [[usuario]] = await pool.query("SELECT contrasena FROM usuarios WHERE id_usuario = ?", [idUsuario]);
      if (!(await bcrypt.compare(contrasena_actual, usuario.contrasena))) return res.status(400).json({ error: "La contraseña actual no es correcta." });
      await pool.query("UPDATE usuarios SET contrasena = ? WHERE id_usuario = ?", [await bcrypt.hash(nueva_contrasena, 10), idUsuario]);
    }

    await pool.query(
      `UPDATE usuarios SET nombre = COALESCE(?, nombre), telefono = COALESCE(?, telefono), correo = COALESCE(?, correo),
        especialidad = CASE WHEN rol = 'barbero' THEN COALESCE(?, especialidad) ELSE especialidad END
       WHERE id_usuario = ?`,
      [nombre, telefono, correo, especialidad, idUsuario]
    );
    const [[actualizado]] = await pool.query(
      "SELECT id_usuario, nombre, correo, telefono, rol, especialidad FROM usuarios WHERE id_usuario = ?", [idUsuario]
    );
    res.json({ mensaje: "Perfil actualizado correctamente.", usuario: actualizado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar tu perfil." });
  }
});

// ═══════════════════════════════════════════════
// BARBEROS (montado en /api/barberos)
// ═══════════════════════════════════════════════
const barberosRouter = express.Router();

// la calificación se calcula con las reseñas reales (no depende de un número guardado a mano)
const SELECT_BARBERO = `
  SELECT u.id_usuario, u.nombre, u.especialidad, u.disponible, u.estado,
         (SELECT ROUND(AVG(r.calificacion), 1) FROM resenas r WHERE r.id_barbero = u.id_usuario) AS calificacion_promedio,
         (SELECT COUNT(*) FROM resenas r WHERE r.id_barbero = u.id_usuario) AS total_resenas`;

// pública: la usa la página de inicio para mostrar al equipo (sin correo ni teléfono)
barberosRouter.get("/publicos", async (req, res) => {
  try {
    const [rows] = await pool.query(`${SELECT_BARBERO} FROM usuarios u WHERE u.rol = 'barbero' AND u.estado = 'activo' ORDER BY u.nombre`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los barberos." });
  }
});

barberosRouter.get("/", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      ${SELECT_BARBERO}, u.correo, u.telefono,
             (SELECT COUNT(*) FROM citas c WHERE c.id_barbero = u.id_usuario AND c.fecha = ?) AS citas_hoy,
             (SELECT COUNT(DISTINCT c.id_cliente) FROM citas c WHERE c.id_barbero = u.id_usuario) AS total_clientes
      FROM usuarios u WHERE u.rol = 'barbero' ORDER BY u.nombre
    `, [ahoraNegocio().fecha]);
    // los clientes no necesitan el correo ni el teléfono de los barberos
    res.json(req.usuario.rol === "cliente" ? rows.map(({ correo, telefono, ...publico }) => publico) : rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los barberos." });
  }
});

// RF-46, RF-47 — RN-47: no permitir correos duplicados
barberosRouter.post("/", requireAuth, requireRole("administrador"), validarRegistroUsuario, async (req, res) => {
  try {
    const { nombre, correo, telefono, especialidad, contrasena } = req.body;
    const [existe] = await pool.query("SELECT id_usuario FROM usuarios WHERE correo = ?", [correo]);
    if (existe.length) return res.status(409).json({ error: "Ya existe un usuario registrado con ese correo." });

    const hash = await bcrypt.hash(contrasena, 10);
    const [result] = await pool.query(
      `INSERT INTO usuarios (nombre, correo, telefono, contrasena, rol, especialidad, estado) VALUES (?, ?, ?, ?, 'barbero', ?, 'activo')`,
      [nombre, correo, telefono, hash, especialidad || null]
    );
    res.status(201).json({ id_usuario: result.insertId, mensaje: "Barbero registrado correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar el barbero." });
  }
});

// RF-49, RF-51 — el propio barbero o un admin
barberosRouter.put("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const esAdmin = req.usuario.rol === "administrador";
    const esPropio = req.usuario.rol === "barbero" && Number(req.usuario.id_usuario) === Number(id);
    if (!esAdmin && !esPropio) return res.status(403).json({ error: "No tienes permiso para modificar este barbero." });

    const { nombre, telefono, especialidad, disponible, estado } = req.body;
    if (nombre !== undefined && nombre.trim().length < 3) return res.status(400).json({ error: "El nombre debe tener al menos 3 caracteres." });
    if (disponible !== undefined && ![0, 1].includes(Number(disponible))) return res.status(400).json({ error: "El valor de disponibilidad no es válido." });
    if (estado !== undefined && !["activo", "inactivo"].includes(estado)) return res.status(400).json({ error: "Estado no válido." });
    await pool.query(
      `UPDATE usuarios SET nombre = COALESCE(?, nombre), telefono = COALESCE(?, telefono), especialidad = COALESCE(?, especialidad),
        disponible = COALESCE(?, disponible), estado = COALESCE(?, estado) WHERE id_usuario = ? AND rol = 'barbero'`,
      [nombre, telefono, especialidad, disponible, esAdmin ? estado : undefined, id]
    );
    res.json({ mensaje: "Barbero actualizado correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el barbero." });
  }
});

// RF-22 — disponibilidad semanal
barberosRouter.get("/:id/horarios", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM horarios_barbero WHERE id_barbero = ? ORDER BY CASE dia_semana::text WHEN 'lunes' THEN 1 WHEN 'martes' THEN 2 WHEN 'miercoles' THEN 3 WHEN 'jueves' THEN 4 WHEN 'viernes' THEN 5 WHEN 'sabado' THEN 6 ELSE 7 END",
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los horarios." });
  }
});

// RF-23, RF-51
barberosRouter.put("/:id/horarios", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const esAdmin = req.usuario.rol === "administrador";
    const esPropio = req.usuario.rol === "barbero" && Number(req.usuario.id_usuario) === Number(id);
    if (!esAdmin && !esPropio) return res.status(403).json({ error: "No tienes permiso para modificar este horario." });

    const { horarios } = req.body;
    if (!Array.isArray(horarios)) return res.status(400).json({ error: "Formato de horarios inválido." });

    const DIAS_OK = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
    if (!horarios.every((h) => DIAS_OK.includes(h.dia_semana) && horaValida(h.hora_inicio) && horaValida(h.hora_fin) && h.hora_fin > h.hora_inicio)) {
      return res.status(400).json({ error: "Revisa los horarios: la hora de fin debe ser posterior a la de inicio." });
    }
    // borrar + insertar en una sola transacción: si algo falla, el horario anterior no se pierde
    const cliente = await pool.pool.connect();
    try {
      await cliente.query("BEGIN");
      await cliente.query("DELETE FROM horarios_barbero WHERE id_barbero = $1", [id]);
      for (const h of horarios) {
        await cliente.query(
          "INSERT INTO horarios_barbero (id_barbero, dia_semana, hora_inicio, hora_fin, disponible) VALUES ($1, $2, $3, $4, $5)",
          [id, h.dia_semana, h.hora_inicio, h.hora_fin, h.disponible ?? 1]
        );
      }
      await cliente.query("COMMIT");
    } catch (err) {
      await cliente.query("ROLLBACK");
      throw err;
    } finally {
      cliente.release();
    }
    res.json({ mensaje: "Disponibilidad actualizada correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar la disponibilidad." });
  }
});

// RF-23 — bloqueos de horario (permiso, cita médica…): ese rango deja de ofrecerse al agendar
function propioOAdmin(req, res) {
  const { id } = req.params;
  const permitido = req.usuario.rol === "administrador" || (req.usuario.rol === "barbero" && Number(req.usuario.id_usuario) === Number(id));
  if (!permitido) res.status(403).json({ error: "No tienes permiso para gestionar estos bloqueos." });
  return permitido;
}

barberosRouter.get("/:id/bloqueos", requireAuth, async (req, res) => {
  try {
    if (!propioOAdmin(req, res)) return;
    const [rows] = await pool.query(
      "SELECT id_bloqueo, fecha, hora_inicio, hora_fin FROM bloqueos_barbero WHERE id_barbero = ? AND fecha >= ? ORDER BY fecha, hora_inicio",
      [req.params.id, ahoraNegocio().fecha]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los bloqueos." });
  }
});

barberosRouter.post("/:id/bloqueos", requireAuth, async (req, res) => {
  try {
    if (!propioOAdmin(req, res)) return;
    const { fecha, hora_inicio, hora_fin } = req.body;
    if (!fechaValida(fecha) || !horaValida(hora_inicio) || !horaValida(hora_fin)) return res.status(400).json({ error: "Indica la fecha y el rango de horas del bloqueo." });
    if (hora_fin <= hora_inicio) return res.status(400).json({ error: "La hora final debe ser posterior a la inicial." });
    if (fecha < ahoraNegocio().fecha) return res.status(400).json({ error: "No se pueden bloquear fechas pasadas." });

    const [citas] = await pool.query(
      "SELECT id_cita FROM citas WHERE id_barbero = ? AND fecha = ? AND estado IN ('pendiente','confirmada') AND hora_inicio < ? AND hora_fin > ? LIMIT 1",
      [req.params.id, fecha, hora_fin, hora_inicio]
    );
    if (citas.length) return res.status(409).json({ error: "Ya hay una cita en ese rango. Cancélala o reprograma antes de bloquearlo." });

    const [result] = await pool.query(
      "INSERT INTO bloqueos_barbero (id_barbero, fecha, hora_inicio, hora_fin) VALUES (?, ?, ?, ?)",
      [req.params.id, fecha, hora_inicio, hora_fin]
    );
    res.status(201).json({ id_bloqueo: result.insertId, mensaje: "Horario bloqueado correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al bloquear el horario." });
  }
});

barberosRouter.delete("/:id/bloqueos/:id_bloqueo", requireAuth, async (req, res) => {
  try {
    if (!propioOAdmin(req, res)) return;
    await pool.query("DELETE FROM bloqueos_barbero WHERE id_bloqueo = ? AND id_barbero = ?", [req.params.id_bloqueo, req.params.id]);
    res.json({ mensaje: "Bloqueo eliminado." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el bloqueo." });
  }
});

// ═══════════════════════════════════════════════
// CLIENTES (montado en /api/clientes)
// ═══════════════════════════════════════════════
const clientesRouter = express.Router();

clientesRouter.get("/", requireAuth, requireRole("administrador"), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id_usuario, u.nombre, u.telefono, u.correo, u.estado, u.creado_en,
             (SELECT COUNT(*) FROM citas c WHERE c.id_cliente = u.id_usuario) AS citas_totales
      FROM usuarios u WHERE u.rol = 'cliente' ORDER BY u.nombre
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los clientes." });
  }
});

// RF-06, RF-27 — clientes atendidos por un barbero
clientesRouter.get("/atendidos/:id_barbero", requireAuth, async (req, res) => {
  try {
    const { id_barbero } = req.params;
    if (req.usuario.rol === "barbero" && Number(req.usuario.id_usuario) !== Number(id_barbero)) {
      return res.status(403).json({ error: "Solo puedes consultar tus propios clientes." });
    }
    const [rows] = await pool.query(`
      SELECT u.id_usuario, u.nombre, u.telefono, COUNT(c.id_cita) AS citas_con_el, MAX(c.fecha) AS ultima_cita
      FROM citas c JOIN usuarios u ON u.id_usuario = c.id_cliente
      WHERE c.id_barbero = ? GROUP BY u.id_usuario, u.nombre, u.telefono ORDER BY ultima_cita DESC
    `, [id_barbero]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los clientes atendidos." });
  }
});

// RF-42 — RN-42: exige consentimiento de datos (Ley 1581 de 2012)
clientesRouter.post("/", requireAuth, requireRole("administrador"), validarRegistroUsuario, async (req, res) => {
  try {
    const { nombre, correo, telefono, contrasena, acepto_tratamiento_datos } = req.body;
    if (!acepto_tratamiento_datos) {
      return res.status(400).json({ error: "El cliente debe autorizar el tratamiento de sus datos personales (Ley 1581 de 2012) antes de registrarse." });
    }
    const [existe] = await pool.query("SELECT id_usuario FROM usuarios WHERE correo = ?", [correo]);
    if (existe.length) return res.status(409).json({ error: "Ese correo ya está registrado." });

    const hash = await bcrypt.hash(contrasena, 10);
    const [result] = await pool.query(
      `INSERT INTO usuarios (nombre, correo, telefono, contrasena, rol, estado, acepto_tratamiento_datos, fecha_aceptacion_datos, version_politica_aceptada)
       VALUES (?, ?, ?, ?, 'cliente', 'activo', '1', NOW(), '1.0')`,
      [nombre, correo, telefono, hash]
    );
    res.status(201).json({ id_usuario: result.insertId, mensaje: "Cliente registrado correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar el cliente." });
  }
});

// RF-49 — editar los datos de un cliente (nombre, correo, teléfono)
clientesRouter.put("/:id", requireAuth, requireRole("administrador"), async (req, res) => {
  try {
    const { nombre, correo, telefono } = req.body;
    if (!nombre || nombre.trim().length < 3) return res.status(400).json({ error: "El nombre debe tener al menos 3 caracteres." });
    if (!correo || !/^\S+@\S+\.\S+$/.test(correo)) return res.status(400).json({ error: "Correo no válido." });
    const [repetido] = await pool.query("SELECT id_usuario FROM usuarios WHERE correo = ? AND id_usuario <> ?", [correo.trim(), req.params.id]);
    if (repetido.length) return res.status(409).json({ error: "Ese correo ya está registrado." });
    const [r] = await pool.query(
      "UPDATE usuarios SET nombre = ?, correo = ?, telefono = ? WHERE id_usuario = ? AND rol = 'cliente'",
      [nombre.trim(), correo.trim(), (telefono || "").trim() || null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Cliente no encontrado." });
    res.json({ mensaje: "Cliente actualizado correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el cliente." });
  }
});

// RF-49 — activar / desactivar una cuenta de cliente (un cliente inactivo no puede iniciar sesión)
clientesRouter.put("/:id/estado", requireAuth, requireRole("administrador"), async (req, res) => {
  try {
    const { estado } = req.body;
    if (!["activo", "inactivo"].includes(estado)) return res.status(400).json({ error: "Estado no válido." });
    const [r] = await pool.query("UPDATE usuarios SET estado = ? WHERE id_usuario = ? AND rol = 'cliente'", [estado, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: "Cliente no encontrado." });
    res.json({ mensaje: `Cliente ${estado === "activo" ? "activado" : "desactivado"} correctamente.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar el estado del cliente." });
  }
});

// RF-53, RN-53 — solo si no tiene citas/suscripciones activas
clientesRouter.delete("/:id", requireAuth, requireRole("administrador"), async (req, res) => {
  try {
    const { id } = req.params;
    const [citasActivas] = await pool.query("SELECT id_cita FROM citas WHERE id_cliente = ? AND estado IN ('pendiente','confirmada') LIMIT 1", [id]);
    if (citasActivas.length) return res.status(409).json({ error: "No se puede eliminar: el cliente tiene citas activas." });

    const [suscripcionesActivas] = await pool.query("SELECT id_suscripcion FROM suscripciones WHERE id_usuario = ? AND estado = 'activa' LIMIT 1", [id]);
    if (suscripcionesActivas.length) return res.status(409).json({ error: "No se puede eliminar: el cliente tiene una suscripción vigente." });

    await pool.query("DELETE FROM usuarios WHERE id_usuario = ? AND rol = 'cliente'", [id]);
    res.json({ mensaje: "Cliente eliminado correctamente." }); // RF-55: quedaría en un log de auditoría aparte
  } catch (err) {
    // 23503: el cliente tiene historial (citas, pagos, reseñas) que no se puede borrar sin perder datos
    if (err.code === "23503") return res.status(409).json({ error: "No se puede eliminar: el cliente tiene historial de citas o pagos. Déjalo inactivo en su lugar." });
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el cliente." });
  }
});

module.exports = { authRouter, barberosRouter, clientesRouter };