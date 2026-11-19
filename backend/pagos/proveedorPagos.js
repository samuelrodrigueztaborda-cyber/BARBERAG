// backend/pagos/proveedorPagos.js
//
// RF-56 a RF-67: procesamiento de pagos.
//
// Capa que evita acoplar el resto del backend a un proveedor específico.
// Elige el proveedor con la variable PAGOS_PROVEEDOR ("simulado" por defecto):
//
//  - "simulado": resuelve los pagos localmente al instante, sin depender
//    de ningún servicio externo — la que se usa en desarrollo/pruebas.
//
//  - "wompi": integración real con Wompi (Colombia — Nequi, PSE/Bancolombia,
//    tarjetas). El cobro ocurre en el Widget de Wompi dentro del navegador
//    del cliente; el resultado llega después por webhook (ver routes/pagos.js).
//    Verificado contra la documentación oficial (docs.wompi.co). Pruébala
//    primero en el ambiente sandbox antes de pasar a producción real.

const crypto = require("crypto");

// ── utilidades de firma/checksum de Wompi (antes en utils/wompi.js) ──
// Firma de integridad: SHA256(referencia + monto_centavos + moneda + secreto) — la exige el Widget.
function generarFirmaIntegridad({ referencia, montoEnCentavos, moneda = "COP" }) {
  const secreto = process.env.WOMPI_SECRETO_INTEGRIDAD;
  if (!secreto) throw new Error("Falta configurar WOMPI_SECRETO_INTEGRIDAD en el .env");
  return crypto.createHash("sha256").update(`${referencia}${montoEnCentavos}${moneda}${secreto}`).digest("hex");
}

// Checksum de webhook: SHA256(valores_de_signature.properties + timestamp + secreto_de_eventos)
function validarChecksumEvento(evento) {
  const secreto = process.env.WOMPI_SECRETO_EVENTOS;
  if (!secreto) throw new Error("Falta configurar WOMPI_SECRETO_EVENTOS en el .env");
  if (!evento?.signature?.properties || !evento?.signature?.checksum) return false;
  const valores = evento.signature.properties.map((ruta) => ruta.split(".").reduce((o, k) => o?.[k], evento.data));
  const calculado = crypto.createHash("sha256").update(valores.join("") + evento.timestamp + secreto).digest("hex").toUpperCase();
  return calculado === String(evento.signature.checksum).toUpperCase();
}

const mapearEstadoWompi = (estado) => ({ APPROVED: "exitoso", DECLINED: "fallido", ERROR: "fallido", VOIDED: "reembolsado", PENDING: "pendiente" }[estado] || "pendiente");

// ── PROVEEDOR SIMULADO (dev / pruebas) ──
const ProveedorSimulado = {
  nombre: "simulado",
  async crearPago({ referencia, monto, descripcion }) {
    return {
      id_transaccion_externa: `SIM-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      estado: "exitoso", // en el proveedor real esto normalmente empieza en "pendiente"
      url_pago: null,
      mensaje: `Pago simulado de ${monto} procesado para "${descripcion}" (referencia: ${referencia}).`,
    };
  },
  async consultarEstado() { return { estado: "exitoso" }; },
  async reembolsar(id, monto) { return { ok: true, mensaje: `Reembolso simulado de ${monto} para la transacción ${id}.` }; },
};

// ── PROVEEDOR WOMPI (real) ──
// A diferencia de una API puramente servidor-a-servidor, Wompi resuelve el
// cobro dentro de su propio Widget en el navegador del cliente — por eso
// crearPago no devuelve un estado final: devuelve "widget" para que el
// frontend abra ese checkout, y el estado real llega luego por webhook.
const ProveedorWompi = {
  nombre: "wompi",

  async crearPago({ referencia, monto, descripcion }) {
    if (!process.env.WOMPI_LLAVE_PUBLICA || !process.env.WOMPI_SECRETO_INTEGRIDAD) {
      throw new Error("Faltan las credenciales de Wompi (WOMPI_LLAVE_PUBLICA / WOMPI_SECRETO_INTEGRIDAD) en el .env.");
    }
    const montoEnCentavos = Math.round(Number(monto) * 100);
    return {
      id_transaccion_externa: referencia,
      estado: "pendiente",
      widget: {
        publicKey: process.env.WOMPI_LLAVE_PUBLICA,
        currency: "COP",
        amountInCents: montoEnCentavos,
        reference: referencia,
        signature: generarFirmaIntegridad({ referencia, montoEnCentavos, moneda: "COP" }),
        redirectUrl: `${process.env.FRONTEND_URL || "http://localhost:5500"}/auth.html?modo=pago&referencia=${referencia}`,
      },
      mensaje: `Usa los datos de "widget" para abrir el checkout de Wompi (Nequi, PSE/Bancolombia, tarjeta) en el navegador del cliente para "${descripcion}".`,
    };
  },

  /** Consulta directa a la API de Wompi — respaldo si el webhook aún no ha llegado. */
  async consultarEstado(idTransaccionWompi) {
    const base = process.env.WOMPI_AMBIENTE === "produccion" ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1";
    const resp = await fetch(`${base}/transactions/${idTransaccionWompi}`, { headers: { Authorization: `Bearer ${process.env.WOMPI_LLAVE_PRIVADA}` } });
    if (!resp.ok) throw new Error("No se pudo consultar el estado de la transacción en Wompi.");
    const data = await resp.json();
    return { estado: mapearEstadoWompi(data.data?.status), metodo_pago_wompi: data.data?.payment_method_type || null };
  },

  validarEvento: validarChecksumEvento,

  async reembolsar(idTransaccionWompi, monto) {
    // Wompi maneja los reembolsos de tarjeta como anulaciones ("voids") de la transacción original.
    const base = process.env.WOMPI_AMBIENTE === "produccion" ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1";
    const resp = await fetch(`${base}/transactions/${idTransaccionWompi}/void`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WOMPI_LLAVE_PRIVADA}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) return { ok: false, mensaje: "No se pudo procesar el reembolso en Wompi. Algunos métodos (como Nequi) requieren reembolso manual desde el dashboard de Wompi." };
    return { ok: true, mensaje: "Reembolso solicitado en Wompi." };
  },
};

function getProveedor() {
  return process.env.PAGOS_PROVEEDOR === "wompi" ? ProveedorWompi : ProveedorSimulado;
}

module.exports = { getProveedor, ProveedorSimulado, ProveedorWompi, mapearEstadoWompi };
