// backend/routes/pagos.js
// RF-56 a RF-67: registrar pagos, comprobantes, conciliación, reembolsos.

const express = require("express");
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware");
const { getProveedor, mapearEstadoWompi } = require("../pagos/proveedorPagos");

const router = express.Router();

// GET /api/pagos — conciliación de pagos (RF-64-ish). Solo admin. Filtros: ?estado=&desde=&hasta=
router.get("/", requireAuth, requireRole("administrador"), async (req, res) => {
  try {
    const { estado, desde, hasta, id_cita } = req.query;
    const condiciones = [];
    const params = [];
    if (estado && estado !== "todos") { condiciones.push("p.estado = ?"); params.push(estado); }
    if (desde) { condiciones.push("DATE(p.fecha) >= ?"); params.push(desde); }
    if (hasta) { condiciones.push("DATE(p.fecha) <= ?"); params.push(hasta); }
    if (id_cita) { condiciones.push("p.id_cita = ?"); params.push(id_cita); }
    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

    const [rows] = await pool.query(`
      SELECT p.id_pago, p.referencia, p.monto, p.estado, p.metodo_pago_wompi, p.fecha,
             mp.tipo AS metodo_pago,
             c.id_cita, cli.nombre AS cliente_cita,
             s.id_suscripcion, cli2.nombre AS cliente_suscripcion, pl.nombre AS plan_nombre
      FROM pagos p
      LEFT JOIN metodos_pago mp ON mp.id_metodo_pago = p.id_metodo_pago
      LEFT JOIN citas c ON c.id_cita = p.id_cita
      LEFT JOIN usuarios cli ON cli.id_usuario = c.id_cliente
      LEFT JOIN suscripciones s ON s.id_suscripcion = p.id_suscripcion
      LEFT JOIN usuarios cli2 ON cli2.id_usuario = s.id_usuario
      LEFT JOIN planes pl ON pl.id_plan = s.id_plan
      ${where}
      ORDER BY p.fecha DESC
    `, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los pagos." });
  }
});

// GET /api/pagos/metodos — catálogo de métodos de pago disponibles
router.get("/metodos", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM metodos_pago ORDER BY id_metodo_pago");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar los métodos de pago." });
  }
});

// GET /api/pagos/estado/:referencia — estado mínimo de un pago, sin exponer datos financieros
// completos. Pública (no requiere sesión): la referencia es un identificador único e
// impredecible, así que funciona como su propio token de acceso — la usa la página de
// confirmación (auth.html?modo=pago) aunque quien pague no tenga una sesión iniciada.
router.get("/estado/:referencia", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT estado, metodo_pago_wompi FROM pagos WHERE referencia = ?",
      [req.params.referencia]
    );
    if (!rows.length) return res.status(404).json({ error: "No se encontró un pago con esa referencia." });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar el estado del pago." });
  }
});

// POST /api/pagos — registrar y procesar un pago para una cita o una suscripción (RF-56)
// id_metodo_pago es opcional: solo se usa si quieres dejar constancia de un
// método elegido manualmente (ej. efectivo). Con "wompi", el método real
// lo informa Wompi automáticamente por webhook al finalizar el pago.
router.post("/", requireAuth, async (req, res) => {
  try {
    const { id_cita, id_suscripcion, id_metodo_pago } = req.body;
    let { monto } = req.body;

    // RN-56: un pago debe pertenecer exactamente a una cita O a una suscripción, no ambas ni ninguna
    if ((!id_cita && !id_suscripcion) || (id_cita && id_suscripcion)) {
      return res.status(400).json({ error: "Un pago debe asociarse a una cita o a una suscripción, no a ambas." });
    }

    // el monto NUNCA se confía tal cual venga del navegador — se recalcula
    // siempre del lado del servidor a partir del precio real registrado.
    if (id_cita) {
      const [[cita]] = await pool.query(
        `SELECT c.id_cliente, c.precio, c.estado, s.precio AS precio_servicio
         FROM citas c JOIN servicios s ON s.id_servicio = c.id_servicio
         WHERE c.id_cita = ?`,
        [id_cita]
      );
      if (!cita) return res.status(404).json({ error: "Cita no encontrada." });
      if (cita.estado === "cancelada") return res.status(409).json({ error: "No se puede cobrar una cita cancelada." });
      const [yaPagada] = await pool.query("SELECT 1 FROM pagos WHERE id_cita = ? AND estado = 'exitoso' LIMIT 1", [id_cita]);
      if (yaPagada.length) return res.status(409).json({ error: "Esta cita ya fue pagada." });

      // un cliente solo puede pagar SU PROPIA cita, nunca la de otro
      if (req.usuario.rol === "cliente" && cita.id_cliente !== req.usuario.id_usuario) {
        return res.status(403).json({ error: "No puedes pagar la cita de otro cliente." });
      }
      monto = Number(cita.precio ?? cita.precio_servicio);
    } else {
      const [[suscripcion]] = await pool.query(
        `SELECT s.id_usuario, s.estado, p.precio FROM suscripciones s JOIN planes p ON p.id_plan = s.id_plan WHERE s.id_suscripcion = ?`,
        [id_suscripcion]
      );
      if (!suscripcion) return res.status(404).json({ error: "Suscripción no encontrada." });
      if (suscripcion.estado === "cancelada") return res.status(409).json({ error: "No se puede cobrar una suscripción cancelada." });
      if (req.usuario.rol === "cliente" && suscripcion.id_usuario !== req.usuario.id_usuario) {
        return res.status(403).json({ error: "No puedes pagar la suscripción de otro cliente." });
      }
      monto = Number(suscripcion.precio);
    }

    if (!monto || monto <= 0) {
      return res.status(400).json({ error: "El monto a cobrar no es válido." });
    }

    const proveedor = getProveedor();

    if (id_metodo_pago) {
      const [metodo] = await pool.query("SELECT * FROM metodos_pago WHERE id_metodo_pago = ?", [id_metodo_pago]);
      if (!metodo.length) return res.status(404).json({ error: "El método de pago indicado no existe." });
    }
    // id_metodo_pago es opcional: con Wompi el método real llega por webhook;
    // en modo simulado tampoco es necesario. Si se envía, queda registrado igual.

    const referencia = `BARBERAG-${id_cita ? "CITA" : "SUS"}-${id_cita || id_suscripcion}-${Date.now()}`;
    const descripcion = id_cita ? `Pago de cita #${id_cita}` : `Pago de suscripción #${id_suscripcion}`;

    // 1. registrar el pago en estado "pendiente", ya con su referencia única
    const [insert] = await pool.query(
      `INSERT INTO pagos (id_cita, id_suscripcion, id_metodo_pago, referencia, monto, estado)
       VALUES (?, ?, ?, ?, ?, 'pendiente')`,
      [id_cita || null, id_suscripcion || null, id_metodo_pago || null, referencia, monto]
    );
    const idPago = insert.insertId;

    // 2. procesar el cobro con el proveedor configurado (simulado o wompi)
    let resultado;
    try {
      resultado = await proveedor.crearPago({ referencia, monto, descripcion });
    } catch (errorProveedor) {
      await pool.query("UPDATE pagos SET estado = 'fallido' WHERE id_pago = ?", [idPago]);
      return res.status(502).json({ error: `No se pudo procesar el pago con ${proveedor.nombre}: ${errorProveedor.message}` });
    }

    // 3. actualizar el estado según la respuesta del proveedor (con Wompi sigue "pendiente" hasta el webhook)
    await pool.query("UPDATE pagos SET estado = ? WHERE id_pago = ?", [resultado.estado, idPago]);

    res.status(201).json({
      id_pago: idPago,
      referencia,
      estado: resultado.estado,
      url_pago: resultado.url_pago || null, // algunos proveedores redirigen en vez de usar widget
      widget: resultado.widget || null,     // con Wompi: datos para abrir el Widget en el navegador
      mensaje: resultado.mensaje || "Pago registrado correctamente.",
      proveedor: proveedor.nombre,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar el pago." });
  }
});

// GET /api/pagos/mias — historial de pagos del cliente que inició sesión
router.get("/mias", requireAuth, requireRole("cliente"), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.id_pago, p.referencia, p.monto, p.estado, p.metodo_pago_wompi, p.fecha, p.id_cita
      FROM pagos p
      LEFT JOIN citas c ON c.id_cita = p.id_cita
      LEFT JOIN suscripciones s ON s.id_suscripcion = p.id_suscripcion
      WHERE c.id_cliente = ? OR s.id_usuario = ?
      ORDER BY p.fecha DESC
    `, [req.usuario.id_usuario, req.usuario.id_usuario]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar tus pagos." });
  }
});

// GET /api/pagos/webhook-info — endpoint informativo para configurar el webhook en el dashboard de Wompi
router.get("/webhook-info", requireAuth, requireRole("administrador"), (req, res) => {
  res.json({
    url_webhook: `${req.protocol}://${req.get("host")}/api/pagos/webhook`,
    instrucciones: "Pega esta URL en el dashboard de Wompi: Desarrollo > Programadores > Eventos.",
  });
});

// POST /api/pagos/webhook — Wompi llama aquí automáticamente cuando cambia el
// estado de una transacción. Pública (Wompi no manda nuestro JWT), pero se
// valida el checksum criptográfico del evento para evitar eventos falsificados.
router.post("/webhook", async (req, res) => {
  try {
    const evento = req.body;
    if (evento?.event !== "transaction.updated") {
      return res.status(200).json({ recibido: true }); // otros tipos de evento: se ignoran sin error
    }

    const proveedor = getProveedor();
    let checksumValido;
    try {
      checksumValido = proveedor.nombre === "wompi" ? proveedor.validarEvento(evento) : false;
    } catch (err) {
      console.error("No se pudo validar el checksum del webhook:", err.message);
      return res.status(500).json({ error: "Configuración de Wompi incompleta en el servidor." });
    }

    if (!checksumValido) {
      console.warn("⚠️ Webhook de Wompi con checksum inválido — posible evento falsificado. Ignorado.");
      return res.status(401).json({ error: "Checksum inválido." });
    }

    const transaccion = evento.data.transaction;
    const estadoInterno = mapearEstadoWompi(transaccion.status);

    await pool.query(
      `UPDATE pagos SET estado = ?, metodo_pago_wompi = ?, wompi_transaction_id = ?
       WHERE referencia = ?`,
      [estadoInterno, transaccion.payment_method_type || null, transaccion.id, transaccion.reference]
    );

    res.status(200).json({ recibido: true });
  } catch (err) {
    console.error(err);
    // 200 igual, para que Wompi no reintente indefinidamente por un error ya logueado de nuestro lado
    res.status(200).json({ recibido: true, error: "procesado con advertencias" });
  }
});

// PUT /api/pagos/:id/reembolso — solo admin (RF-67)
router.put("/:id/reembolso", requireAuth, requireRole("administrador"), async (req, res) => {
  try {
    const { id } = req.params;
    const [pagos] = await pool.query("SELECT * FROM pagos WHERE id_pago = ?", [id]);
    if (!pagos.length) return res.status(404).json({ error: "Pago no encontrado." });
    const pago = pagos[0];

    if (pago.estado !== "exitoso") {
      return res.status(409).json({ error: "Solo se pueden reembolsar pagos en estado exitoso." });
    }

    const proveedor = getProveedor();
    let resultado;
    if (proveedor.nombre === "wompi") {
      if (!pago.wompi_transaction_id) {
        return res.status(409).json({ error: "Este pago no tiene un ID de transacción de Wompi registrado todavía; espera a que llegue la confirmación por webhook." });
      }
      resultado = await proveedor.reembolsar(pago.wompi_transaction_id, pago.monto);
    } else {
      resultado = await proveedor.reembolsar(pago.referencia, pago.monto);
    }

    if (!resultado.ok) {
      return res.status(502).json({ error: resultado.mensaje || "No se pudo procesar el reembolso." });
    }

    await pool.query("UPDATE pagos SET estado = 'reembolsado' WHERE id_pago = ?", [id]);
    res.json({ mensaje: "Pago reembolsado correctamente." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al procesar el reembolso." });
  }
});

module.exports = router;
