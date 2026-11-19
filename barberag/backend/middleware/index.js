// backend/middleware/index.js
// Autenticación/roles (RNF-14, RNF-15) + validaciones de servidor (RNF-18).
// Antes eran auth.js y validar.js por separado; se unieron porque siempre
// se importan juntos y son pequeños — un solo archivo, mismo comportamiento.

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "cambia-esto-en-produccion";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── auth ──
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autenticado. Falta el token de acceso." });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET); // { id_usuario, nombre, rol }
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado. Inicia sesión de nuevo." });
  }
}

/** Uso: requireRole('administrador') — solo deja pasar a los roles indicados */
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: "No autenticado." });
    if (!rolesPermitidos.includes(req.usuario.rol)) return res.status(403).json({ error: "No tienes permiso para realizar esta acción." });
    next();
  };
}

// ── validaciones ──
const correoValido = (correo) => typeof correo === "string" && EMAIL_REGEX.test(correo.trim());
const contrasenaValida = (c) => typeof c === "string" && c.length >= 6;

function validarRegistroUsuario(req, res, next) {
  const { nombre, correo, contrasena, telefono } = req.body;
  if (!nombre || nombre.trim().length < 3) return res.status(400).json({ error: "El nombre debe tener al menos 3 caracteres." });
  if (!correoValido(correo)) return res.status(400).json({ error: "El correo no tiene un formato válido." });
  if (!contrasenaValida(contrasena)) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
  if (telefono && !/^[0-9+\s()-]{7,20}$/.test(telefono)) return res.status(400).json({ error: "El teléfono no tiene un formato válido." });
  next();
}

function validarServicio(req, res, next) {
  const { nombre, precio, duracion_min } = req.body;
  if (req.method === "POST" && (!nombre || nombre.trim().length < 3)) {
    return res.status(400).json({ error: "El nombre del servicio debe tener al menos 3 caracteres." });
  }
  if (precio !== undefined && (isNaN(precio) || Number(precio) <= 0)) return res.status(400).json({ error: "El precio debe ser un número mayor a cero." });
  if (duracion_min !== undefined && (isNaN(duracion_min) || Number(duracion_min) <= 0)) return res.status(400).json({ error: "La duración debe ser un número mayor a cero (en minutos)." });
  next();
}

// ── fecha y hora del negocio ──
// El servidor puede estar en otra zona horaria (la nube suele usar UTC). Si se usara new Date().toISOString()
// "hoy" cambiaría a las 7 p.m. en Colombia. Por eso todo se calcula en la zona del negocio.
const ZONA_HORARIA = process.env.ZONA_HORARIA || "America/Bogota";

/** Fecha (AAAA-MM-DD) y minutos transcurridos del día, según el reloj del negocio. */
function ahoraNegocio() {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_HORARIA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return { fecha: `${partes.year}-${partes.month}-${partes.day}`, minutos: Number(partes.hour) * 60 + Number(partes.minute) };
}

/** true si es una fecha real con formato AAAA-MM-DD (rechaza 2026-02-31, por ejemplo) */
const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f || "") && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f;
const horaValida = (h) => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(h || "");

function validarCita(req, res, next) {
  const { fecha, hora_inicio } = req.body;
  if (!fechaValida(fecha)) return res.status(400).json({ error: "La fecha debe tener el formato AAAA-MM-DD." });
  if (!horaValida(hora_inicio)) return res.status(400).json({ error: "La hora debe tener el formato HH:MM." });
  if (fecha < ahoraNegocio().fecha) return res.status(400).json({ error: "No se pueden agendar citas en una fecha pasada." }); // RN-02
  next(); // la hora de fin NO se recibe: el servidor la calcula con la duración del servicio
}

module.exports = { requireAuth, requireRole, JWT_SECRET, correoValido, contrasenaValida, validarRegistroUsuario, validarServicio, validarCita, ahoraNegocio, fechaValida, horaValida };
