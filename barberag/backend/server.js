// backend/server.js
// Servidor principal de BarberAg

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { authRouter, barberosRouter, clientesRouter } = require("./routes/usuarios");
const { serviciosRouter, configuracionRouter, resenasRouter, reportesRouter } = require("./routes/negocio");
const { planesRouter, suscripcionesRouter } = require("./routes/membresias");
const { iniciarEsquema, contexto } = require("./db");
const citasRoutes = require("./routes/citas");
const pagosRoutes = require("./routes/pagos");

const app = express();

// RNF-13/RNF-18: cabeceras HTTP de seguridad (evita clickjacking, sniffing de tipo MIME, etc.)
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "100kb" })); // limita el tamaño del body para evitar abuso

// Fuera de producción, un error 500 de base de datos incluye `detalle` con la causa real (ej. "column x does not exist"),
// para que se vea en pantalla qué falló. Con NODE_ENV=production no se envía.
app.use((req, res, next) => contexto.run({}, () => {
  const ctx = contexto.getStore();
  const json = res.json.bind(res);
  res.json = (cuerpo) => json(res.statusCode === 500 && ctx.error && process.env.NODE_ENV !== "production" ? { ...cuerpo, detalle: ctx.error.message } : cuerpo);
  next();
}));

// RNF-16: límite de intentos de inicio de sesión para frenar ataques de fuerza bruta
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // máximo 10 intentos por IP en la ventana
  message: { error: "Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/login", limitadorLogin);

// límite general para el resto de la API (evita abuso/DoS básico)
const limitadorGeneral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limitadorGeneral);

// ── Rutas de la API (mismas URLs de siempre) ──
app.use("/api/auth", authRouter);
app.use("/api/citas", citasRoutes);
app.use("/api/barberos", barberosRouter);
app.use("/api/servicios", serviciosRouter);
app.use("/api/clientes", clientesRouter);
app.use("/api/configuracion", configuracionRouter);
app.use("/api/pagos", pagosRoutes);
app.use("/api/resenas", resenasRouter);
app.use("/api/planes", planesRouter);
app.use("/api/suscripciones", suscripcionesRouter);
app.use("/api/reportes", reportesRouter);

// Chequeo de salud del servidor
app.get("/api/health", (req, res) => res.json({ ok: true, servicio: "BarberAg API" }));

// Manejo de rutas no encontradas
app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada." }));

// Manejo centralizado de errores
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor." });
});

const PORT = process.env.PORT || 3000;
// Antes de atender peticiones se asegura que las tablas existan (schema.sql es idempotente).
iniciarEsquema()
  .catch((err) => {
    // algunos errores de conexión llegan con el mensaje vacío: se muestra el código y la causa real
    const causa = err.message || err.code || (err.errors && err.errors[0] && (err.errors[0].message || err.errors[0].code)) || String(err);
    console.error("⚠️  No se pudo preparar la base de datos:", causa);
    console.error(process.env.DATABASE_URL ? "   Usando DATABASE_URL del .env. Revisa la URI y la contraseña." : "   DATABASE_URL está vacío o no se leyó el .env: se intentó conectar a un Postgres local.");
  })
  .finally(() => app.listen(PORT, () => console.log(`✅ BarberAg API corriendo en http://localhost:${PORT}`)));