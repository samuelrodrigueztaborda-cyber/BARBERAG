// js/api.js
// Helper compartido para admin.html y barbero.html:
// llamadas a la API, manejo de sesión (token) y utilidades comunes.

// En desarrollo local (frontend y backend en puertos distintos) apunta a
// localhost:3000. En producción, si backend y frontend quedan detrás del
// mismo dominio (ej. un reverse proxy nginx), usa una ruta relativa "/api".
// Para forzar otra URL (ej. un backend en un subdominio distinto), define
// `window.BARBERAG_API_BASE = "https://api.tudominio.com/api";` en un
// <script> ANTES de cargar este archivo.
const API_BASE = window.BARBERAG_API_BASE || (
  ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:3000/api"
    : "/api"
);

const Sesion = {
  get token() { return localStorage.getItem("barberag_token"); },
  get usuario() {
    const raw = localStorage.getItem("barberag_usuario");
    return raw ? JSON.parse(raw) : null;
  },
  guardar(token, usuario) {
    localStorage.setItem("barberag_token", token);
    localStorage.setItem("barberag_usuario", JSON.stringify(usuario));
  },
  /** Actualiza los datos guardados del usuario (ej. tras editar el perfil) sin tocar el token */
  actualizarUsuario(datosNuevos) {
    const actual = this.usuario || {};
    localStorage.setItem("barberag_usuario", JSON.stringify({ ...actual, ...datosNuevos }));
  },
  cerrar() {
    localStorage.removeItem("barberag_token");
    localStorage.removeItem("barberag_usuario");
    window.location.href = "index.html";
  },
  /** Exige sesión activa con el rol indicado; si no, redirige a auth.html (modo login) */
  exigir(rolEsperado) {
    const usuario = this.usuario;
    if (!this.token || !usuario) {
      window.location.href = "index.html";
      return null;
    }
    if (rolEsperado && usuario.rol !== rolEsperado) {
      window.location.href = "index.html";
      return null;
    }
    return usuario;
  },
};

/**
 * Llama a la API con el token de sesión incluido automáticamente.
 * Lanza un objeto { status, mensaje } en caso de error para manejarlo con try/catch.
 */
async function apiFetch(ruta, opciones = {}) {
  const headers = { "Content-Type": "application/json", ...(opciones.headers || {}) };
  if (Sesion.token) headers["Authorization"] = `Bearer ${Sesion.token}`;

  let resp;
  try {
    resp = await fetch(`${API_BASE}${ruta}`, { ...opciones, headers });
  } catch (err) {
    throw { status: 0, mensaje: "No se pudo conectar con el servidor. ¿Está corriendo el backend?" };
  }

  // 401 con sesión iniciada = el token venció. Un 401 al hacer login (clave incorrecta) NO cierra nada:
  // solo muestra el mensaje del servidor.
  if (resp.status === 401 && Sesion.token && !ruta.startsWith("/auth/login")) {
    Sesion.cerrar();
    throw { status: 401, mensaje: "Tu sesión expiró. Inicia sesión de nuevo." };
  }

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw { status: resp.status, mensaje: (data.error || `El servidor respondió con un error (${resp.status}). Revisa la consola del backend.`) + (data.detalle ? ` — Causa: ${data.detalle}` : "") };
  }
  return data;
}

// ── Formateo ──
function formatoMoneda(valor) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(valor);
}
function formatoHora(horaTexto) {
  // "14:30:00" -> "2:30 p.m."
  const [h, m] = horaTexto.split(":").map(Number);
  const ampm = h >= 12 ? "p.m." : "a.m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
function formatoFecha(fechaTexto) {
  // "2026-08-31" -> "31 ago 2026"
  // un DATE llega como "2026-08-31"; un timestamp ISO se convierte a la hora local (no se corta en UTC)
  let fecha;
  if (fechaTexto.length > 10) fecha = new Date(fechaTexto);
  else { const [y, m, d] = fechaTexto.split("-").map(Number); fecha = new Date(y, m - 1, d); }
  return fecha.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}
function inicialesDe(nombre) {
  return nombre.split(" ").filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join("");
}
function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  // también se escapan las comillas para poder usar el texto dentro de atributos HTML
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Fechas (siempre con el reloj local del navegador, nunca toISOString(), que usa UTC y
//    adelanta el día desde las 7 p.m. en Colombia) ──
const dosDigitos = (n) => String(n).padStart(2, "0");
const aTextoFecha = (d) => `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
/** "2026-10-06" — hoy */
const hoyLocal = () => aTextoFecha(new Date());
/** último día del mes siguiente (límite para agendar) */
const finMesSiguiente = () => { const h = new Date(); return aTextoFecha(new Date(h.getFullYear(), h.getMonth() + 2, 0)); };

/** Descarga una tabla como CSV (abre bien en Excel): filas = array de arrays, la primera es el encabezado */
function descargarCSV(nombreArchivo, filas) {
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "\ufeff" + filas.map((f) => f.map(celda).join(",")).join("\r\n");
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  enlace.download = nombreArchivo;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

/** Estrellas de texto: 4 -> ★★★★☆ */
const estrellasTexto = (n) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));

// ── Configuración del negocio (para que BarberAg sirva a cualquier barbería) ──
/**
 * Carga la configuración del negocio (nombre, dirección, teléfono, horario)
 * y la aplica a cualquier elemento marcado con data-negocio="clave" en la página.
 * Público: no requiere sesión iniciada (auth.html e index.html también la usan).
 */
async function cargarConfiguracionNegocio() {
  try {
    const config = await apiFetch("/configuracion");
    document.querySelectorAll("[data-negocio]").forEach((el) => {
      const clave = el.dataset.negocio;
      if (config[clave]) el.textContent = config[clave];
    });
    return config;
  } catch (err) {
    // si la API no está disponible, la página sigue funcionando con los valores por defecto del HTML
    console.warn("No se pudo cargar la configuración del negocio:", err.mensaje || err);
    return null;
  }
}

// ── Utilidades comunes a los 3 paneles (admin, barbero, cliente) ──
const capitaliza = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function showToast(title, msg, tipo = "ok") {
  const wrap = document.getElementById("toast-wrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "my-toast" + (tipo === "error" ? " error" : "");
  el.innerHTML = `<div class="t-head"><i class="bi bi-${tipo === "error" ? "exclamation-triangle" : "check-circle"}"></i> ${escapeHtml(title)}</div><p>${escapeHtml(msg)}</p>`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .4s"; setTimeout(() => el.remove(), 400); }, 3500);
}
function showErrorToast(err) { showToast("Ocurrió un problema", err.mensaje || "Inténtalo de nuevo.", "error"); }

// ── Contraseñas (mismas reglas que contrasenaError en backend/middleware/index.js) ──
const TEXTO_REGLAS_CLAVE = "De 6 a 15 caracteres, con una mayúscula, una minúscula y un carácter especial.";

/** Devuelve el mensaje del primer error de la contraseña, o null si cumple todas las reglas */
function validarContrasena(c) {
  if (!c) return "Escribe una contraseña.";
  if (c.length < 6) return "La contraseña debe tener al menos 6 caracteres.";
  if (c.length > 15) return "La contraseña no puede tener más de 15 caracteres.";
  if (!/\p{Lu}/u.test(c)) return "La contraseña debe incluir al menos una letra mayúscula.";
  if (!/\p{Ll}/u.test(c)) return "La contraseña debe incluir al menos una letra minúscula.";
  if (!/[^\p{L}\p{N}\s]/u.test(c)) return "La contraseña debe incluir al menos un carácter especial (por ejemplo ! @ # $ %).";
  return null;
}

/** Cambio de contraseña de los 3 paneles: el form debe tener #passwordActual y #passwordNueva */
async function cambiarContrasena(form) {
  const actual = form.querySelector("#passwordActual").value;
  const nueva = form.querySelector("#passwordNueva").value;
  const aviso = (msg) => showToast("Revisa la contraseña", msg, "error");
  if (!actual && !nueva) return aviso("Escribe tu contraseña actual y la nueva.");
  if (!actual) return aviso("Escribe tu contraseña actual.");
  if (!nueva) return aviso("Escribe la nueva contraseña.");
  const errorClave = validarContrasena(nueva);
  if (errorClave) return aviso(errorClave.replace("La contraseña", "La nueva contraseña"));
  if (actual === nueva) return aviso("La nueva contraseña debe ser diferente a la actual.");
  try {
    await apiFetch("/auth/perfil", { method: "PUT", body: JSON.stringify({ contrasena_actual: actual, nueva_contrasena: nueva }) });
    form.reset();
    showToast("Contraseña actualizada", "Úsala la próxima vez que inicies sesión.");
  } catch (err) { showErrorToast(err); }
}

/**
 * Arranca un panel completo (admin/barbero/cliente): exige la sesión del rol
 * indicado, llena el chip de usuario, conecta "cerrar sesión", arma la
 * navegación del sidebar (incluida la versión móvil) y despacha la carga de
 * cada sección la primera vez que se visita. Antes este bloque —idéntico en
 * los 3 paneles— vivía repetido dentro de cada HTML.
 *
 * @param {string} rol - rol exigido ('administrador' | 'barbero' | 'cliente')
 * @param {Object} cargadores - { nombreSeccion: funciónQueLaCarga }
 * @param {string} seccionInicial - sección que se abre al entrar
 * @param {string} [seccionSinTitulo] - sección cuyo <h1> NO se sobreescribe (ej. el saludo "Hola, Nombre" de barbero.html)
 * @returns {{usuarioActivo: object|null, goTo: function}}
 */
function inicializarPanel(rol, cargadores, seccionInicial, seccionSinTitulo = null) {
  const usuarioActivo = Sesion.exigir(rol);
  if (usuarioActivo) {
    document.getElementById("userChipName").textContent = usuarioActivo.nombre;
    document.getElementById("userChipAvatar").textContent = inicialesDe(usuarioActivo.nombre);
  }
  document.getElementById("logoutLink")?.addEventListener("click", (e) => { e.preventDefault(); Sesion.cerrar(); });
  // "Volver al inicio" en el menú lateral de los 3 paneles (si el HTML no lo trae ya)
  const pie = document.querySelector(".sidebar-foot");
  if (pie && !pie.querySelector('a[href="index.html"]')) {
    pie.insertAdjacentHTML("afterbegin", '<a href="index.html" style="margin-bottom:.7rem"><i class="bi bi-house"></i> Volver al inicio</a>');
  }

  const navLinks = document.querySelectorAll(".sidebar-nav a");
  const sections = document.querySelectorAll(".content-section");
  const pageTitle = document.getElementById("pageTitle");
  const pageSub = document.getElementById("pageSub");
  const seccionesCargadas = new Set();

  function goTo(target, forzar = false) {
    const link = document.querySelector(`.sidebar-nav a[data-target="${target}"]`);
    if (!link) return;
    navLinks.forEach((l) => l.classList.remove("active"));
    link.classList.add("active");
    sections.forEach((s) => s.classList.remove("active"));
    document.getElementById("sec-" + target)?.classList.add("active");
    if (target !== seccionSinTitulo) pageTitle.textContent = link.dataset.title;
    pageSub.textContent = link.dataset.sub || "";
    document.getElementById("sidebar")?.classList.remove("show");
    document.getElementById("sidebarOverlay")?.classList.remove("show");
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (!seccionesCargadas.has(target) || forzar) {
      seccionesCargadas.add(target);
      cargadores[target]?.();
    }
  }

  navLinks.forEach((link) => link.addEventListener("click", () => goTo(link.dataset.target)));
  document.querySelectorAll("[data-goto]").forEach((el) => el.addEventListener("click", () => goTo(el.dataset.goto)));

  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  document.getElementById("mobileToggle")?.addEventListener("click", () => { sidebar.classList.add("show"); overlay.classList.add("show"); });
  document.getElementById("sidebarClose")?.addEventListener("click", () => { sidebar.classList.remove("show"); overlay.classList.remove("show"); });
  overlay?.addEventListener("click", () => { sidebar.classList.remove("show"); overlay.classList.remove("show"); });

  cargarConfiguracionNegocio();
  if (usuarioActivo) goTo(seccionInicial);

  return { usuarioActivo, goTo };
}