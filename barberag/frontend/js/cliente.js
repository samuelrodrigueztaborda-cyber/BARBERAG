// js/cliente.js — lógica del panel de cliente (BarberAg)

// ─── PANEL: sesión, navegación, sidebar móvil y despacho de secciones ───
const { usuarioActivo, goTo } = inicializarPanel('cliente', {
  citas: cargarMisCitas, barberos: cargarBarberos, membresia: cargarMembresia,
  resenas: cargarMisResenas, perfil: cargarPerfilCliente,
}, 'agendar');

const modal = (id) => bootstrap.Modal.getOrCreateInstance(document.getElementById(id));

// ═══════════════════════════════════════════════
// AGENDAR CITA (wizard de 4 pasos)
// ═══════════════════════════════════════════════
const estadoAgenda = { servicio: null, barbero: null, fecha: null, slot: null };
let catalogoServicios = [];
let catalogoBarberos = [];

function irAPaso(n) {
  ['pasoServicio', 'pasoBarbero', 'pasoHorario', 'pasoConfirmar'].forEach((id, i) => {
    document.getElementById(id).style.display = (i === n - 1) ? '' : 'none';
  });
  [1, 2, 3, 4].forEach(i => {
    const pill = document.getElementById('stepPill' + i);
    pill.classList.toggle('active', i === n);
    pill.classList.toggle('done', i < n);
  });
}

async function cargarPasoServicio() {
  const cont = document.getElementById('listaServicios');
  try {
    catalogoServicios = await apiFetch('/servicios?activos=1');
    cont.innerHTML = catalogoServicios.map(s => `
      <div class="servicio-card" data-id="${s.id_servicio}" onclick="seleccionarServicio(${s.id_servicio})">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <div class="nombre">${escapeHtml(s.nombre)}</div>
            <div class="meta">${s.duracion_min} min ${s.descripcion ? '· ' + escapeHtml(s.descripcion) : ''}</div>
          </div>
          <div class="precio">${formatoMoneda(s.precio)}</div>
        </div>
      </div>`).join('') || '<div class="empty-state"><i class="bi bi-scissors"></i>No hay servicios disponibles por ahora.</div>';
  } catch (err) {
    cont.innerHTML = '<div class="empty-state">No se pudieron cargar los servicios.</div>';
    showErrorToast(err);
  }
}

function seleccionarServicio(id) {
  const s = catalogoServicios.find(x => x.id_servicio === id);
  estadoAgenda.servicio = { id, nombre: s.nombre, precio: s.precio, duracion: s.duracion_min };
  document.querySelectorAll('#listaServicios .servicio-card').forEach(el => el.classList.toggle('selected', Number(el.dataset.id) === id));
  cargarPasoBarbero();
  irAPaso(2);
}

async function cargarPasoBarbero() {
  const cont = document.getElementById('listaBarberos');
  cont.innerHTML = '<div class="text-center text-muted py-4">Cargando barberos…</div>';
  try {
    catalogoBarberos = await apiFetch('/barberos');
    const disponibles = catalogoBarberos.filter(b => b.disponible && b.estado === 'activo');
    cont.innerHTML = disponibles.map(b => `
      <div class="barbero-card" data-id="${b.id_usuario}" onclick="seleccionarBarbero(${b.id_usuario})">
        <div class="nombre">${escapeHtml(b.nombre)}</div>
        <div class="meta">${escapeHtml(b.especialidad || 'Barbero')} · ${resumenCalificacion(b)}</div>
      </div>`).join('') || '<div class="empty-state"><i class="bi bi-person-x"></i>No hay barberos disponibles en este momento.</div>';
  } catch (err) {
    cont.innerHTML = '<div class="empty-state">No se pudieron cargar los barberos.</div>';
    showErrorToast(err);
  }
}

/** "★ 4.5 (3 reseñas)" o "Sin reseñas aún" */
function resumenCalificacion(b) {
  return b.total_resenas ? `★ ${b.calificacion_promedio} (${b.total_resenas} reseña${b.total_resenas === 1 ? '' : 's'})` : 'Sin reseñas aún';
}

function seleccionarBarbero(id) {
  const b = catalogoBarberos.find(x => x.id_usuario === id);
  estadoAgenda.barbero = { id, nombre: b.nombre };
  estadoAgenda.fecha = estadoAgenda.slot = null;
  document.querySelectorAll('#listaBarberos .barbero-card').forEach(el => el.classList.toggle('selected', Number(el.dataset.id) === id));
  document.getElementById('fechaCita').value = '';
  document.getElementById('slotsContainer').innerHTML = '<div class="text-muted" style="font-size:.85rem">Elige una fecha para ver los horarios disponibles.</div>';
  irAPaso(3);
}

const inputFecha = document.getElementById('fechaCita');
inputFecha.min = hoyLocal();
inputFecha.max = finMesSiguiente();

/** Consulta al servidor los horarios libres del barbero/servicio/fecha elegidos y los dibuja */
async function cargarHorarios() {
  const cont = document.getElementById('slotsContainer');
  const fecha = inputFecha.value;
  estadoAgenda.fecha = fecha;
  estadoAgenda.slot = null;
  if (!fecha) return;
  if (fecha < inputFecha.min || fecha > inputFecha.max) {
    cont.innerHTML = '<div class="empty-state" style="padding:1.5rem"><i class="bi bi-calendar-x"></i>Solo puedes agendar desde hoy hasta el final del mes siguiente.</div>';
    return;
  }
  cont.innerHTML = '<div class="text-center text-muted py-3">Buscando horarios disponibles…</div>';
  try {
    const slots = await apiFetch(`/citas/disponibilidad?id_barbero=${estadoAgenda.barbero.id}&fecha=${fecha}&id_servicio=${estadoAgenda.servicio.id}`);
    if (!slots.length) {
      cont.innerHTML = '<div class="empty-state" style="padding:1.5rem"><i class="bi bi-calendar-x"></i>No hay horarios libres ese día. Prueba con otra fecha.</div>';
      return;
    }
    cont.innerHTML = `<div class="slots-grid">${slots.map(s => `
      <div class="slot-btn" onclick="seleccionarSlot('${s.hora_inicio}','${s.hora_fin}', this)">${formatoHora(s.hora_inicio)}</div>
    `).join('')}</div>`;
  } catch (err) {
    // se muestra el motivo real que devolvió el servidor, no un mensaje genérico
    cont.innerHTML = `<div class="empty-state">No se pudo consultar la disponibilidad.<br><small>${escapeHtml(err.mensaje || '')}</small></div>`;
    showErrorToast(err);
  }
}
inputFecha.addEventListener('change', cargarHorarios);

function seleccionarSlot(inicio, fin, el) {
  estadoAgenda.slot = { inicio, fin };
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  mostrarResumen();
  irAPaso(4);
}

function mostrarResumen() {
  const { servicio, barbero, fecha, slot } = estadoAgenda;
  document.getElementById('resumenCita').innerHTML = `
    <div class="cita-card" style="margin-bottom:0">
      <div class="servicio">${escapeHtml(servicio.nombre)}</div>
      <div class="meta">Con ${escapeHtml(barbero.nombre)}</div>
      <div class="meta">${formatoFecha(fecha)} · ${formatoHora(slot.inicio)} – ${formatoHora(slot.fin)}</div>
      <div class="meta" style="color:var(--gold); font-weight:600; margin-top:.4rem">${formatoMoneda(servicio.precio)}</div>
    </div>`;
}

document.getElementById('btnConfirmarCita').addEventListener('click', async (e) => {
  const { servicio, barbero, fecha, slot } = estadoAgenda;
  if (!servicio || !barbero || !fecha || !slot) { showToast('Faltan datos', 'Elige servicio, barbero, fecha y horario.', 'error'); return; }
  e.target.disabled = true;
  try {
    await apiFetch('/citas', {
      method: 'POST',
      body: JSON.stringify({ id_barbero: barbero.id, id_servicio: servicio.id, fecha, hora_inicio: slot.inicio }),
    });
    showToast('¡Cita agendada!', 'Queda pendiente de confirmación por la barbería.');
    estadoAgenda.servicio = estadoAgenda.barbero = estadoAgenda.fecha = estadoAgenda.slot = null;
    document.querySelectorAll('.servicio-card, .barbero-card, .slot-btn').forEach(el => el.classList.remove('selected'));
    irAPaso(1);
    goTo('citas', true);
  } catch (err) {
    showErrorToast(err);
    if (err.status === 409) { irAPaso(3); cargarHorarios(); } // alguien reservó ese horario antes: se muestran los que quedan
  } finally { e.target.disabled = false; }
});

// ═══════════════════════════════════════════════
// MIS CITAS
// ═══════════════════════════════════════════════
let citasCache = [];
function pagarCita(idCita) {
  const c = citasCache.find(x => x.id_cita === idCita);
  abrirPago({ id_cita: idCita }, 'Pagar cita', `${c.servicio_nombre} — ${formatoMoneda(c.precio)}`);
}

async function cargarMisCitas() {
  const cont = document.getElementById('listaCitas');
  try {
    const citas = citasCache = await apiFetch('/citas/mias');
    if (!citas.length) {
      cont.innerHTML = '<div class="empty-state"><i class="bi bi-calendar-plus"></i>Todavía no tienes citas. ¡Agenda la primera!</div>';
      return;
    }
    cont.innerHTML = citas.map(c => {
      let acciones = '';
      if (['pendiente', 'confirmada'].includes(c.estado)) {
        acciones += `<button class="btn-outline-gold btn-sm-gold" onclick="abrirCancelarCliente(${c.id_cita})">Cancelar</button>`;
      }
      if (c.estado !== 'cancelada') {
        acciones += c.pagada
          ? `<span class="badge-status exitoso"><i class="bi bi-check-circle"></i> Pagada</span>`
          : `<button class="btn-gold btn-sm-gold" onclick="pagarCita(${c.id_cita})"><i class="bi bi-credit-card"></i> Pagar</button>`;
      }
      if (c.estado === 'completada') {
        acciones += c.resenada
          ? `<span class="badge-status completada"><i class="bi bi-star-fill"></i> Ya reseñaste</span>`
          : `<button class="btn-outline-gold btn-sm-gold" onclick="resenarCita(${c.id_cita})"><i class="bi bi-star"></i> Dejar reseña</button>`;
      }
      return `
        <div class="cita-card">
          <div class="top-row">
            <div>
              <div class="servicio">${escapeHtml(c.servicio_nombre)} · ${formatoMoneda(c.precio)}</div>
              <div class="meta">Con ${escapeHtml(c.barbero_nombre)} · ${formatoFecha(c.fecha)} · ${formatoHora(c.hora_inicio)}</div>
              ${c.estado === 'cancelada' && c.motivo_cancelacion ? `<div class="meta">Motivo: ${escapeHtml(c.motivo_cancelacion)}</div>` : ''}
            </div>
            <span class="badge-status ${c.estado}">${capitaliza(c.estado)}</span>
          </div>
          ${acciones ? `<div class="acciones">${acciones}</div>` : ''}
        </div>`;
    }).join('');
  } catch (err) {
    cont.innerHTML = '<div class="empty-state">No se pudieron cargar tus citas.</div>';
    showErrorToast(err);
  }
}

// ── cancelar ──
function abrirCancelarCliente(idCita) {
  document.getElementById('cancelarCitaIdCliente').value = idCita;
  document.getElementById('cancelarMotivoCliente').value = '';
  modal('cancelarModal').show();
}
document.getElementById('btnConfirmarCancelacion').addEventListener('click', async () => {
  const id = document.getElementById('cancelarCitaIdCliente').value;
  const motivo = document.getElementById('cancelarMotivoCliente').value.trim();
  if (!motivo) { showToast('Falta el motivo', 'Escribe brevemente por qué cancelas la cita.', 'error'); return; }
  try {
    await apiFetch(`/citas/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado: 'cancelada', motivo_cancelacion: motivo }) });
    modal('cancelarModal').hide();
    showToast('Cita cancelada', 'Tu cita fue cancelada correctamente.');
    cargarMisCitas();
  } catch (err) { showErrorToast(err); }
});

// ── pagar (sirve para una cita o para una suscripción) ──
let pollingPago = null;
async function abrirPago(payload, titulo, detalle) {
  document.getElementById('pagoModalTitulo').textContent = titulo;
  document.getElementById('pagoClienteInfo').textContent = detalle;
  document.getElementById('pagoClienteWidget').innerHTML = '<div class="text-center text-muted py-3">Generando cobro…</div>';
  document.getElementById('pagoClienteEstado').innerHTML = '';
  modal('pagoModalCliente').show();

  try {
    const data = await apiFetch('/pagos', { method: 'POST', body: JSON.stringify(payload) });

    if (data.widget) {
      const cont = document.getElementById('pagoClienteWidget');
      cont.innerHTML = '<form id="wompiFormCliente"></form>';
      const script = document.createElement('script');
      script.src = 'https://checkout.wompi.co/widget.js';
      script.setAttribute('data-render', 'button');
      script.setAttribute('data-public-key', data.widget.publicKey);
      script.setAttribute('data-currency', data.widget.currency);
      script.setAttribute('data-amount-in-cents', data.widget.amountInCents);
      script.setAttribute('data-reference', data.widget.reference);
      script.setAttribute('data-signature:integrity', data.widget.signature);
      script.setAttribute('data-redirect-url', data.widget.redirectUrl);
      document.getElementById('wompiFormCliente').appendChild(script);

      clearInterval(pollingPago);
      let intentos = 0;
      pollingPago = setInterval(async () => {
        intentos++;
        try {
          const pago = await apiFetch(`/pagos/estado/${data.referencia}`);
          if (pago.estado !== 'pendiente') {
            clearInterval(pollingPago);
            const ok = pago.estado === 'exitoso';
            document.getElementById('pagoClienteEstado').innerHTML = `<div style="font-size:.85rem;color:${ok ? '#4caf6d' : '#f28b8b'}">Pago ${pago.estado}${pago.metodo_pago_wompi ? ' vía ' + escapeHtml(pago.metodo_pago_wompi) : ''}.</div>`;
            showToast(ok ? 'Pago confirmado' : 'Pago no exitoso', `Estado: ${pago.estado}`, ok ? 'ok' : 'error');
            recargarPagos();
          }
        } catch { /* reintenta en el siguiente ciclo */ }
        if (intentos >= 40) clearInterval(pollingPago);
      }, 3000);
    } else {
      document.getElementById('pagoClienteWidget').innerHTML = `<div class="text-center py-3"><i class="bi bi-check-circle" style="font-size:2rem;color:#4caf6d"></i><div class="mt-2">Pago registrado: <b>${data.estado}</b></div></div>`;
      recargarPagos();
    }
  } catch (err) {
    document.getElementById('pagoClienteWidget').innerHTML = `<div class="text-center text-muted py-3">No se pudo generar el cobro.<br><small>${escapeHtml(err.mensaje || '')}</small></div>`;
    showErrorToast(err);
  }
}
/** Después de un pago se actualizan las citas y la membresía */
function recargarPagos() { cargarMisCitas(); cargarMembresia(); }

// ═══════════════════════════════════════════════
// BARBEROS: ver al equipo, leer reseñas y dejar la tuya
// ═══════════════════════════════════════════════
async function cargarBarberos() {
  const cont = document.getElementById('listaBarberosCliente');
  try {
    catalogoBarberos = await apiFetch('/barberos');
    const activos = catalogoBarberos.filter(b => b.estado === 'activo');
    cont.innerHTML = activos.map(b => `
      <div class="col-md-6 col-lg-4">
        <div class="team-card">
          <div class="avatar">${inicialesDe(b.nombre)}</div>
          <h5>${escapeHtml(b.nombre)}</h5>
          <div class="role">${escapeHtml(b.especialidad || 'Barbero')}</div>
          <div class="stars">${b.total_resenas ? estrellasTexto(b.calificacion_promedio) + ' ' + b.calificacion_promedio : '☆☆☆☆☆'}</div>
          <div class="text-muted" style="font-size:.78rem">${resumenCalificacion(b)}${b.disponible ? '' : ' · No disponible'}</div>
          <div class="d-flex justify-content-center gap-2 mt-3 flex-wrap">
            <button class="btn-outline-gold btn-sm-gold" onclick="verResenasBarbero(${b.id_usuario})">Ver reseñas</button>
            <button class="btn-gold btn-sm-gold" onclick="resenarBarbero(${b.id_usuario})"><i class="bi bi-star"></i> Dejar reseña</button>
          </div>
        </div>
      </div>`).join('') || '<div class="col-12 empty-state"><i class="bi bi-person-x"></i>No hay barberos registrados.</div>';
  } catch (err) {
    cont.innerHTML = '<div class="col-12 empty-state">No se pudieron cargar los barberos.</div>';
    showErrorToast(err);
  }
}

async function verResenasBarbero(idBarbero) {
  const barbero = catalogoBarberos.find(b => b.id_usuario === idBarbero);
  document.getElementById('verResenasBarbero').textContent = barbero ? barbero.nombre : '';
  const lista = document.getElementById('verResenasLista');
  lista.innerHTML = '<div class="text-center text-muted py-3">Cargando…</div>';
  modal('verResenasModal').show();
  try {
    const resenas = await apiFetch(`/resenas/barbero/${idBarbero}`);
    lista.innerHTML = resenas.map(r => `
      <div class="review-card mb-2">
        <div class="reviewer"><div class="av">${inicialesDe(r.cliente_nombre)}</div><div><div class="name">${escapeHtml(r.cliente_nombre)}</div><div class="date">${formatoFecha(aTextoFecha(new Date(r.fecha)))} · ${escapeHtml(r.servicio_nombre)}</div></div></div>
        <div class="stars">${estrellasTexto(r.calificacion)}</div>
        ${r.comentario ? `<p>${escapeHtml(r.comentario)}</p>` : '<p>(sin comentario)</p>'}
      </div>`).join('') || '<div class="empty-state"><i class="bi bi-star"></i>Este barbero todavía no tiene reseñas.</div>';
  } catch (err) {
    lista.innerHTML = '<div class="empty-state">No se pudieron cargar las reseñas.</div>';
    showErrorToast(err);
  }
}

// ═══════════════════════════════════════════════
// RESEÑAS
// ═══════════════════════════════════════════════
let estrellaSeleccionada = 0;
document.querySelectorAll('#estrellasInput i').forEach(estrella => {
  estrella.addEventListener('click', function () {
    estrellaSeleccionada = Number(this.dataset.valor);
    document.querySelectorAll('#estrellasInput i').forEach(e => e.classList.toggle('activa', Number(e.dataset.valor) <= estrellaSeleccionada));
  });
});

/** Abre el formulario con las citas completadas (y aún sin reseñar) entre las que se puede elegir */
function abrirResenar(citas) {
  document.getElementById('resenarBarberoNombre').textContent = citas[0].barbero_nombre;
  document.getElementById('resenarCitaSelect').innerHTML = citas.map(c =>
    `<option value="${c.id_cita}">${formatoFecha(c.fecha)} — ${escapeHtml(c.servicio_nombre)}</option>`).join('');
  document.getElementById('resenarComentario').value = '';
  estrellaSeleccionada = 0;
  document.querySelectorAll('#estrellasInput i').forEach(e => e.classList.remove('activa'));
  modal('resenarModal').show();
}

/** Desde "Mis citas": reseñar esa cita en concreto */
async function resenarCita(idCita) {
  try {
    const cita = (await apiFetch('/citas/mias')).find(c => c.id_cita === idCita);
    abrirResenar([cita]);
  } catch (err) { showErrorToast(err); }
}

/** Desde "Barberos": reseñar a ese barbero, si tiene citas completadas contigo que aún no reseñaste */
async function resenarBarbero(idBarbero) {
  try {
    const citas = (await apiFetch('/citas/mias')).filter(c => c.id_barbero === idBarbero && c.estado === 'completada' && !c.resenada);
    if (!citas.length) {
      showToast('Aún no puedes reseñar', 'Necesitas una cita completada con este barbero que todavía no hayas reseñado.', 'error');
      return;
    }
    abrirResenar(citas);
  } catch (err) { showErrorToast(err); }
}

document.getElementById('btnEnviarResena').addEventListener('click', async (e) => {
  if (!estrellaSeleccionada) { showToast('Falta la calificación', 'Elige de 1 a 5 estrellas.', 'error'); return; }
  const idCita = Number(document.getElementById('resenarCitaSelect').value);
  const comentario = document.getElementById('resenarComentario').value.trim();
  e.target.disabled = true;
  try {
    await apiFetch('/resenas', { method: 'POST', body: JSON.stringify({ id_cita: idCita, calificacion: estrellaSeleccionada, comentario }) });
    modal('resenarModal').hide();
    showToast('¡Gracias por tu reseña!', 'Tu opinión ayuda a otros clientes.');
    cargarMisCitas(); cargarBarberos(); cargarMisResenas();
  } catch (err) { showErrorToast(err); }
  finally { e.target.disabled = false; }
});

async function cargarMisResenas() {
  const cont = document.getElementById('listaResenas');
  try {
    const resenas = await apiFetch('/resenas/mias');
    if (!resenas.length) {
      cont.innerHTML = '<div class="empty-state"><i class="bi bi-star"></i>Todavía no has dejado ninguna reseña. Puedes hacerlo desde "Mis citas" o "Barberos" cuando una cita esté completada.</div>';
      return;
    }
    cont.innerHTML = resenas.map(r => `
      <div class="review-card mb-2">
        <div class="stars">${estrellasTexto(r.calificacion)}</div>
        <div style="font-weight:600; font-size:.88rem; margin-top:.3rem">Con ${escapeHtml(r.barbero_nombre)} · ${escapeHtml(r.servicio_nombre)}</div>
        <div class="date" style="font-size:.73rem;color:var(--muted)">${formatoFecha(aTextoFecha(new Date(r.fecha)))}</div>
        ${r.comentario ? `<p style="margin:.4rem 0 0">${escapeHtml(r.comentario)}</p>` : ''}
      </div>`).join('');
  } catch (err) {
    cont.innerHTML = '<div class="empty-state">No se pudieron cargar tus reseñas.</div>';
    showErrorToast(err);
  }
}

// ═══════════════════════════════════════════════
// MEMBRESÍA Y PAGOS
// ═══════════════════════════════════════════════
let planesCache = [];

async function cargarMembresia() {
  try {
    const [planes, suscripciones, pagos] = await Promise.all([apiFetch('/planes'), apiFetch('/suscripciones/mias'), apiFetch('/pagos/mias')]);
    planesCache = planes;
    const vigente = suscripciones.find(s => ['activa', 'pausada'].includes(s.estado));

    document.getElementById('miSuscripcion').innerHTML = vigente ? `
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
        <div>
          <div style="font-weight:600">Plan ${escapeHtml(vigente.plan_nombre)} · ${formatoMoneda(vigente.precio)}</div>
          <div class="text-muted" style="font-size:.82rem">Del ${formatoFecha(vigente.fecha_inicio)} al ${formatoFecha(vigente.fecha_fin)}</div>
        </div>
        <div class="d-flex gap-2 align-items-center flex-wrap">
          <span class="badge-status ${vigente.estado}">${capitaliza(vigente.estado)}</span>
          <span class="badge-status ${vigente.pagada ? 'exitoso' : 'pendiente'}">${vigente.pagada ? 'Pagada' : 'Pago pendiente'}</span>
        </div>
      </div>
      <div class="acciones d-flex gap-2 mt-3 flex-wrap">
        ${vigente.pagada ? '' : `<button class="btn-gold btn-sm-gold" onclick="pagarSuscripcion(${vigente.id_suscripcion})"><i class="bi bi-credit-card"></i> Pagar</button>`}
        <button class="btn-outline-gold btn-sm-gold" onclick="renovarSuscripcion(${vigente.id_suscripcion})"><i class="bi bi-arrow-repeat"></i> Renovar</button>
        <button class="btn-outline-gold btn-sm-gold" onclick="cancelarSuscripcion(${vigente.id_suscripcion})">Cancelar suscripción</button>
      </div>`
      : '<div class="text-muted" style="font-size:.88rem">No tienes una suscripción vigente. Elige un plan abajo para empezar.</div>';

    document.getElementById('listaPlanes').innerHTML = planes.map(p => `
      <div class="col-md-6 col-lg-4">
        <div class="plan-card-cli">
          <div class="plan-name">${escapeHtml(p.nombre)}</div>
          <div class="price">${formatoMoneda(p.precio)}</div>
          <p>${escapeHtml(p.descripcion || '')}<br><small>Vigencia: ${p.duracion_dias} días</small></p>
          <div class="acciones">
            ${vigente ? '<span class="text-muted" style="font-size:.78rem">Ya tienes una suscripción vigente</span>'
                      : `<button class="btn-gold btn-sm-gold" onclick="suscribirme(${p.id_plan})">Suscribirme</button>`}
          </div>
        </div>
      </div>`).join('') || '<div class="col-12 empty-state">No hay planes disponibles por ahora.</div>';

    document.getElementById('pagosTbody').innerHTML = pagos.map(p => `
      <tr>
        <td>${new Date(p.fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
        <td>${p.id_cita ? 'Cita #' + p.id_cita : 'Suscripción'}</td>
        <td>${formatoMoneda(p.monto)}</td>
        <td><span class="badge-status ${p.estado === 'exitoso' ? 'exitoso' : p.estado === 'fallido' ? 'fallido' : p.estado === 'reembolsado' ? 'reembolsado' : 'pendiente'}">${capitaliza(p.estado)}</span></td>
      </tr>`).join('') || '<tr><td colspan="4" class="text-center text-muted py-3">Todavía no has realizado pagos.</td></tr>';
  } catch (err) {
    document.getElementById('miSuscripcion').innerHTML = '<div class="empty-state">No se pudo cargar tu membresía.</div>';
    showErrorToast(err);
  }
}

async function suscribirme(idPlan) {
  const plan = planesCache.find(p => p.id_plan === idPlan);
  if (!confirm(`¿Suscribirte al plan ${plan.nombre} por ${formatoMoneda(plan.precio)}?`)) return;
  try {
    const data = await apiFetch('/suscripciones', { method: 'POST', body: JSON.stringify({ id_plan: idPlan }) });
    showToast('Suscripción creada', 'Ahora realiza el pago para activarla del todo.');
    await cargarMembresia();
    pagarSuscripcion(data.id_suscripcion);
  } catch (err) { showErrorToast(err); }
}

function pagarSuscripcion(idSuscripcion) {
  abrirPago({ id_suscripcion: idSuscripcion }, 'Pagar suscripción', 'Pago de tu plan de membresía');
}

async function renovarSuscripcion(id) {
  try {
    await apiFetch(`/suscripciones/${id}/renovar`, { method: 'POST' });
    showToast('Suscripción renovada', 'Se extendió la vigencia de tu plan. Recuerda pagar la renovación.');
    cargarMembresia();
  } catch (err) { showErrorToast(err); }
}

async function cancelarSuscripcion(id) {
  if (!confirm('¿Cancelar tu suscripción? Esta acción no se puede deshacer.')) return;
  try {
    await apiFetch(`/suscripciones/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado: 'cancelada' }) });
    showToast('Suscripción cancelada', 'Ya no tienes un plan vigente.');
    cargarMembresia();
  } catch (err) { showErrorToast(err); }
}

// ═══════════════════════════════════════════════
// MI PERFIL
// ═══════════════════════════════════════════════
async function cargarPerfilCliente() {
  try {
    const perfil = await apiFetch('/auth/perfil');
    document.getElementById('perfilNombre').value = perfil.nombre;
    document.getElementById('perfilCorreo').value = perfil.correo;
    document.getElementById('perfilTelefono').value = perfil.telefono || '';
  } catch (err) { showErrorToast(err); }
}

document.getElementById('formPerfilCliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await apiFetch('/auth/perfil', {
      method: 'PUT',
      body: JSON.stringify({
        nombre: document.getElementById('perfilNombre').value.trim(),
        correo: document.getElementById('perfilCorreo').value.trim(),
        telefono: document.getElementById('perfilTelefono').value.trim(),
      }),
    });
    Sesion.actualizarUsuario({ nombre: data.usuario.nombre, correo: data.usuario.correo });
    document.getElementById('userChipName').textContent = data.usuario.nombre;
    document.getElementById('userChipAvatar').textContent = inicialesDe(data.usuario.nombre);
    showToast('Perfil actualizado', 'Tus cambios se guardaron correctamente.');
  } catch (err) { showErrorToast(err); }
});

document.getElementById('formPasswordCliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  const actual = document.getElementById('passwordActual').value;
  const nueva = document.getElementById('passwordNueva').value;
  if (!actual || !nueva) { showToast('Faltan datos', 'Escribe tu contraseña actual y la nueva.', 'error'); return; }
  try {
    await apiFetch('/auth/perfil', { method: 'PUT', body: JSON.stringify({ contrasena_actual: actual, nueva_contrasena: nueva }) });
    document.getElementById('formPasswordCliente').reset();
    showToast('Contraseña actualizada', 'Úsala la próxima vez que inicies sesión.');
  } catch (err) { showErrorToast(err); }
});

// ─── CARGA INICIAL ───
// "agendar" no tiene loader en inicializarPanel porque su paso 1 (elegir
// servicio) se muestra por defecto sin pasar por goTo.
if (usuarioActivo) cargarPasoServicio();
