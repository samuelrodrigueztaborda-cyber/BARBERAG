# BarberAg — Guía de instalación y uso

Esta entrega conecta los paneles de administrador y barbero a un backend
real (Node.js + Express + PostgreSQL/Supabase), reemplazando los datos de ejemplo que
tenían antes las páginas.

## Estructura del proyecto

```
barberag/
├── backend/              → API REST (Node.js + Express + PostgreSQL/Supabase)
│   ├── server.js
│   ├── db.js
│   ├── schema.sql        → estructura de la base de datos
│   ├── seed.sql          → datos de prueba
│   ├── middleware/auth.js
│   ├── routes/           → auth, citas, barberos, servicios, clientes
│   ├── package.json
│   └── .env.example
└── frontend/              → páginas web (abrir con Live Server o similar)
    ├── index.html         → landing pública
    ├── login.html         → inicio de sesión
    ├── admin.html          → panel de administrador
    ├── barbero.html         → panel de barbero
    ├── js/api.js           → helper compartido de sesión y llamadas a la API
    └── img/
```

## 1. Requisitos

- Node.js 18 o superior
- Una cuenta gratuita en [Supabase](https://supabase.com) (la base de datos)
- Un navegador moderno

## 2. Configurar la base de datos en Supabase

La base de datos es **PostgreSQL alojado en Supabase**. No hay que instalar
nada localmente.

1. Entra a [supabase.com](https://supabase.com) y crea un proyecto nuevo
   (plan gratuito). Anota la contraseña que definas: la vas a necesitar.
2. En el Dashboard, abre **SQL Editor > New query**, pega el contenido de
   `backend/schema.sql` y dale **Run**. Eso crea las 10 tablas.
3. Repite el paso anterior con `backend/seed.sql` para cargar los datos de
   prueba (barberos, servicios, citas de ejemplo).
4. Ve a **Project Settings > Database > Connection string > URI**, copia la
   cadena y reemplaza `[YOUR-PASSWORD]` por tu contraseña.
   👉 Usa el puerto **6543** (Transaction Pooler), que es el recomendado
   para aplicaciones como esta.

Si prefieres trabajar con un PostgreSQL local en lugar de Supabase, también
funciona: deja `DATABASE_URL` vacío en el `.env` y llena `DB_HOST`,
`DB_USER`, `DB_PASSWORD`, `DB_NAME` y `DB_PORT`. Para cargar los scripts:

```bash
psql -U postgres -d barberia_db -f backend/schema.sql
psql -U postgres -d barberia_db -f backend/seed.sql
```

## 3. Configurar y levantar el backend

```bash
cd backend
cp .env.example .env
# pega tu DATABASE_URL de Supabase dentro del .env
npm install
node test-db.js   # comprueba que la conexión funciona antes de arrancar
npm start
```

Deberías ver: `✅ BarberAg API corriendo en http://localhost:3000`

Verifica que responde: abre `http://localhost:3000/api/health` en el navegador.

## 4. Levantar el frontend

El frontend son archivos estáticos. La forma más simple:

- **VS Code + extensión "Live Server"**: clic derecho en `frontend/login.html` → "Open with Live Server".
- **O con Node**, desde la carpeta `frontend`:
  ```bash
  npx serve .
  ```

No abras los `.html` con doble clic directo (`file://`) porque algunos
navegadores bloquean las peticiones `fetch` en ese modo.

## 5. Iniciar sesión

Ve a `login.html`. Cuentas de prueba (contraseña para todas: `barberag123`):

| Rol | Correo |
|---|---|
| Administrador | jorge.agudelo@barberag.com |
| Barbero | carlos.munoz@barberag.com |

## Qué quedó conectado a la API real

- **Login** con JWT y contraseñas hasheadas (bcrypt)
- **Admin → Dashboard**: citas de hoy, ingresos, calificación promedio, barberos activos
- **Admin → Citas**: listar, filtrar, confirmar, cancelar (con motivo obligatorio), completar
- **Admin → Barberos**: listar, registrar nuevo, activar/desactivar disponibilidad
- **Admin → Servicios**: listar, crear, activar/desactivar, eliminar
- **Admin → Clientes**: listar, registrar nuevo, eliminar (solo si no tiene citas activas)
- **Admin → Configuración**: nombre del negocio, dirección, teléfono y horario — con persistencia real (ver siguiente sección)
- **Admin → Citas → Cobrar**: pagos reales vía Wompi (Nequi, PSE/Bancolombia, tarjetas) o modo simulado para pruebas (ver sección de Pagos)
- **Barbero → Mi agenda**: citas del día, aceptar, marcar como completada
- **Barbero → Disponibilidad**: ver y guardar horario semanal por día
- **Barbero → Historial**: citas completadas/canceladas
- **Barbero → Mis clientes**: clientes que ha atendido
- **Barbero → Mis reseñas**: reseñas reales que ha recibido, con promedio calculado
- **Admin → Reseñas**: todas las reseñas del negocio (solo lectura)
- **Cliente (nuevo)**: registro público (`registro.html`), agendar cita con disponibilidad real en 4 pasos, ver y cancelar sus propias citas, pagar con Wompi, dejar reseñas de citas completadas, ver su historial de pagos y reseñas — panel completo en `cliente.html`

## Sistema configurable (para reutilizar con cualquier barbería)

El nombre del negocio, dirección, teléfono y horario ya no están escritos
en el HTML — viven en la tabla `configuracion_negocio` y se sirven desde
`GET /api/configuracion` (público) / `PUT /api/configuracion` (solo admin).

Esto significa que:

- `login.html`, `admin.html` y `barbero.html` muestran el nombre del
  negocio configurado (junto al logo "BarberAg", que es el nombre del
  *software*, no del negocio — esa distinción se mantiene a propósito).
- Cambiar el nombre/dirección/teléfono/horario desde **Admin →
  Configuración** se refleja de inmediato en todas las páginas, sin
  tocar código.
- Para desplegar el sistema en otra barbería: se crea una base de datos
  nueva con el mismo `schema.sql`, se actualizan los valores en
  `configuracion_negocio` (o se cambian desde el panel), y listo — no
  hace falta duplicar ni modificar el frontend.

`index.html` (la landing pública) ya lee el nombre del negocio, la
dirección y el teléfono desde `/api/configuracion` — deja de ser un
pendiente.

## Seguridad mínima añadida en esta fase

- **Cabeceras de seguridad HTTP** con `helmet` (protección básica contra
  clickjacking, sniffing de tipo MIME, etc.)
- **Límite de intentos de login**: 10 intentos fallidos por IP cada 15
  minutos — después de eso, la API responde 429 y bloquea temporalmente
  (frena ataques de fuerza bruta).
- **Límite general de peticiones** a la API (300 cada 15 min por IP) para
  frenar abuso básico.
- **Validación real en el servidor** (no solo en el formulario del
  navegador): formato de correo, contraseña mínima de 6 caracteres,
  nombre mínimo de 3 caracteres, precios y duraciones positivos, formato
  de fecha/hora en citas, y que no se puedan agendar citas en el pasado.
- Body de las peticiones limitado a 100kb para evitar abuso.

Todas las consultas SQL ya usaban *prepared statements* (parámetros `?`
con `pg`), así que la inyección SQL clásica ya estaba cubierta desde
la primera versión del backend.

## Pagos: Nequi, PSE/Bancolombia y tarjetas (Wompi)

El sistema tiene un módulo de pagos con dos "proveedores" intercambiables
(variable `PAGOS_PROVEEDOR` en el `.env`):

- **`simulado`** (por defecto): resuelve cualquier cobro como exitoso al
  instante, sin depender de ningún servicio externo. Es lo que usa el
  proyecto tal como se entrega, para que puedas probar todo el flujo
  (Admin → Citas → botón "Cobrar" 💳) sin necesidad de credenciales.
- **`wompi`**: integración real con [Wompi](https://wompi.co), la pasarela
  de pagos de Bancolombia. Con una sola integración cubre **Nequi, PSE
  (incluye Bancolombia), botón Bancolombia, Bancolombia QR y tarjetas** —
  los métodos que se usan en Colombia.

### Cómo funciona el cobro con Wompi

1. Desde **Admin → Citas**, el botón 💳 "Cobrar" llama a `POST /api/pagos`,
   que genera una referencia única y la firma de integridad que exige Wompi.
2. El navegador abre el **Widget de Wompi** (una ventana propia de Wompi
   donde el cliente elige Nequi, PSE, tarjeta, etc. y completa el pago) —
   en ningún momento el sistema toca datos de tarjeta directamente.
3. Wompi confirma el resultado llamando a `POST /api/pagos/webhook` en tu
   servidor. Esa llamada se valida criptográficamente (checksum SHA-256)
   para que nadie pueda falsificar una confirmación de pago falsa.
4. El panel actualiza el estado del pago automáticamente (sondeo cada 3s
   mientras el modal de cobro está abierto).

### Para activar pagos reales con Wompi

1. Regístrate gratis en [comercios.wompi.co](https://comercios.wompi.co)
   y activa el **ambiente sandbox** (pruebas, sin dinero real).
2. Copia tus llaves de prueba (empiezan con `pub_test_` y `prv_test_`) y
   el **Secreto de Integridad** al `.env`:
   ```
   PAGOS_PROVEEDOR=wompi
   WOMPI_LLAVE_PUBLICA=pub_test_...
   WOMPI_LLAVE_PRIVADA=prv_test_...
   WOMPI_SECRETO_INTEGRIDAD=...
   ```
3. En el dashboard de Wompi, ve a **Desarrollo → Programadores → Eventos**
   y registra la URL de tu webhook (puedes obtenerla llamando a
   `GET /api/pagos/webhook-info` autenticado como admin). Copia el
   **Secreto de Eventos** al `.env` como `WOMPI_SECRETO_EVENTOS`.
   ⚠️ Mientras desarrollas en `localhost`, Wompi no puede alcanzar tu
   webhook — usa una herramienta como [ngrok](https://ngrok.com) para
   exponerlo temporalmente a internet durante las pruebas.
4. Prueba con las tarjetas de prueba oficiales de Wompi:
   `4242 4242 4242 4242` → pago aprobado · `4111 1111 1111 1111` → pago
   rechazado (cualquier fecha futura y CVC de 3 dígitos sirven). Para
   Nequi/PSE, el propio ambiente sandbox de Wompi te deja elegir el
   resultado final dentro de su simulador.
5. Solo cuando todo funcione en sandbox, cambia a llaves `pub_prod_`/
   `prv_prod_` y `WOMPI_AMBIENTE=produccion` para cobrar con dinero real.

No cambies a `wompi` sin haber completado estos pasos: sin las llaves
correctas, los cobros fallarán.

## Si algo falla al arrancar

- `EADDRINUSE ... port 3000`: ya hay un backend corriendo (una copia vieja). En Windows: `netstat -ano | findstr :3000`
  y luego `taskkill /PID <número> /F`; después `npm start`.
- `password authentication failed`: la contraseña de `DATABASE_URL` en `backend/.env` es incorrecta.
- El servidor crea y repara las tablas solo al arrancar; si alguna sentencia falla, la consola dice cuál.

## Cambios de la auditoría (octubre 2026)

- **Esquema automático**: al arrancar, el servidor ejecuta `schema.sql` (es idempotente), así que
  tablas e índices nuevos se crean solos. No hace falta correrlo a mano en una BD ya existente.
- **Zona horaria del negocio**: variable `ZONA_HORARIA` (por defecto `America/Bogota`). Las
  disponibilidades y el "hoy" se calculan con ella, no con la hora UTC del servidor.
- **Disponibilidad**: `GET /api/citas/disponibilidad` y `POST /api/citas` usan la misma función; el
  servidor calcula la hora final con la duración del servicio. Un índice de exclusión en la BD
  (`citas_sin_cruce`) impide doble reserva aunque dos personas reserven a la vez.
- **Reseñas**: el cliente solo reseña citas *completadas y suyas*; el barbero sale de la cita.
  Una reseña por cita. El promedio se calcula de la tabla `resenas` (no se guarda).
  Endpoints: `POST /api/resenas`, `GET /api/resenas/mias | /barbero/:id | /publicas`.
- **Barberos públicos**: `GET /api/barberos/publicos` (sin login) alimenta la página principal.
- **Admin completo**: reprogramar citas (`PUT /api/citas/:id`, valida que el horario esté libre) y editar clientes (`PUT /api/clientes/:id`).
- **Nuevos paneles reales**: suscripciones/planes, pagos (con reembolso), reportes, bloqueo de
  horarios del barbero, ganancias del barbero, membresía del cliente.

## Qué queda pendiente

- Notificaciones por correo/WhatsApp (se quitaron los interruptores de interfaz; no hay servicio de envío).
- Recuperar contraseña.
- Cobros reales con Wompi: solo se probó el proveedor simulado.

## Sobre la base de datos: migración de MySQL a Supabase

El proyecto nació usando MySQL y se migró a **PostgreSQL (Supabase)**.
Qué cambió y qué no:

**Cambió:**
- `backend/db.js` ahora usa el driver `pg` en vez de `mysql2`, y se conecta
  por `DATABASE_URL` (con TLS, como exige Supabase).
- `schema.sql` y `seed.sql` se reescribieron en dialecto PostgreSQL
  (`GENERATED AS IDENTITY` en vez de `AUTO_INCREMENT`, `CHECK` en vez de
  `ENUM`, triggers en vez de `ON UPDATE CURRENT_TIMESTAMP`, etc.).

**No cambió:** el código de las rutas (`routes/*.js`), ni una sola URL de la
API, ni nada del frontend.

Eso último es gracias a un pequeño adaptador dentro de `db.js`: traduce al
vuelo los marcadores `?` de MySQL a los `$1, $2...` de Postgres y devuelve
las filas con la misma forma que antes (`const [filas] = await pool.query(...)`).
Se hizo así a propósito: reescribir a mano las ~150 consultas del proyecto
habría sido largo y muy fácil de romper en alguna. Si algún día quieres
consultas 100% nativas de Postgres, puedes ir migrándolas de a poco — el
adaptador no estorba.

Si necesitas escribir SQL específico de Postgres en alguna consulta nueva,
también puedes usar `$1, $2...` directamente: el adaptador solo toca los `?`.

## Panel de cliente (el flujo que faltaba)

Hasta antes de esta fase, solo existían paneles para administrador y
barbero — el cliente no tenía ninguna pantalla funcional (el botón
"Reservar" de la landing era decorativo). Ahora:

- **`registro.html`**: cualquier persona puede crear su cuenta (con la
  casilla de autorización de datos personales obligatoria).
- **`cliente.html`**: agendar cita en 4 pasos (servicio → barbero →
  fecha/hora con disponibilidad real → confirmar), ver "Mis citas"
  (cancelar las propias, pagar con Wompi), "Mis reseñas" (dejar reseña
  de una cita completada) y "Mi perfil".
- Todos los botones "Reservar"/"Agendar" de `index.html` ahora llevan a
  `registro.html` en vez de abrir el modal decorativo que había antes
  (se eliminó ese modal, junto con los de login/registro falsos que
  tampoco estaban conectados).

### Seguridad del flujo de cliente (verificada con pruebas automatizadas)

- Un cliente **nunca** puede agendar, pagar, cancelar o reseñar en
  nombre de otro cliente — cada intento de hacerlo se rechaza con 403.
- Un cliente puede **cancelar** su propia cita, pero no puede
  confirmarla ni marcarla como completada (eso le corresponde al
  negocio).
- El **monto a pagar nunca se confía desde el navegador**: siempre se
  recalcula en el servidor a partir del precio real de la cita. Se
  probó explícitamente que un intento de pagar $1 en vez del precio
  real queda ignorado y se cobra el monto correcto.
- Solo se pueden reseñar citas propias y ya completadas, y solo una vez
  por cita.

Se probó el recorrido completo de un cliente real (registro → agendar →
pagar → la barbería confirma y completa → reseñar → la reseña aparece
en el panel del barbero y del admin, y la calificación promedio del
barbero se actualiza sola) — los 16 pasos pasaron sin fallos.

## Despliegue en producción

Hay dos caminos, de más simple a más control:

### Opción A — Docker (recomendada si ya conoces Docker)

Desde la raíz del proyecto:

```bash
docker compose up -d --build
# la base de datos ya vive en Supabase: solo necesitas el DATABASE_URL en backend/.env
```

Esto levanta el backend y el frontend (servido por nginx) con un
solo comando. Frontend en `http://localhost:8080`, API en
`http://localhost:3000`.

⚠️ No se pudo probar la construcción de las imágenes Docker en este
entorno de desarrollo (no tiene Docker instalado) — el `Dockerfile` y el
`docker-compose.yml` siguen patrones estándar y bien establecidos, pero
verifícalos tú mismo con `docker compose up` antes de confiar en ellos
para producción.

### Opción B — VPS tradicional (Ubuntu) sin Docker

1. Instala Node.js y nginx en el servidor (la base de datos ya está en Supabase).
2. Sigue los pasos 2 y 3 de este README para la base de datos y el backend.
3. Mantén el backend corriendo con PM2 (`backend/ecosystem.config.js`):
   ```bash
   cd backend
   npm install -g pm2
   pm2 start ecosystem.config.js
   pm2 startup && pm2 save   # para que arranque solo si el servidor se reinicia
   ```
4. Sirve el frontend y expón la API bajo el mismo dominio con nginx —
   usa `nginx.ejemplo.conf` como punto de partida, y activa HTTPS gratis
   con `certbot` (Let's Encrypt).
5. Con esto, `js/api.js` detecta automáticamente que no estás en
   `localhost` y usa la ruta relativa `/api` — no hace falta tocar nada
   en el frontend.

### Opción C — Hosting gestionado (más simple para empezar)

Si no quieres administrar un servidor, plataformas como **Railway** o
**Render** permiten desplegar el backend con un par de clics
(conectas el repositorio, defines las variables de entorno del `.env`, y
listo). El frontend, al ser archivos estáticos, se puede desplegar aparte
en **Netlify**, **Vercel** o GitHub Pages — solo recuerda definir
`window.BARBERAG_API_BASE` con la URL de tu backend si backend y
frontend terminan en dominios distintos.

## Respaldos automáticos de la base de datos (RNF-27)

```bash
cd backend/scripts
bash backup.sh              # genera un respaldo comprimido en backend/backups/
bash restore.sh archivo.sql.gz   # restaura desde un respaldo (pide confirmación)
```

`backup.sh` también borra automáticamente los respaldos con más de 30
días. Para que corra solo todos los días, instala la tarea programada de
`backend/scripts/crontab.ejemplo` (instrucciones dentro del archivo).

Probado de punta a punta en este entorno: se generó un respaldo, se
simuló un desastre total (`DROP DATABASE`) y se restauró exitosamente
—los 11 usuarios y 5 citas de prueba volvieron intactos.

## Lo legal mínimo para cobrar en Colombia (Ley 1581 de 2012)

Se agregaron dos documentos base en `frontend/legal/`:

- `politica-tratamiento-datos.html` — política de tratamiento de datos personales (Habeas Data).
- `terminos-condiciones.html` — términos y condiciones de uso del servicio.

Ambos toman el nombre/dirección/teléfono del negocio automáticamente
desde `/api/configuracion` (igual que el resto del sitio). Al registrar
un cliente nuevo desde **Admin → Clientes**, el formulario ahora exige
marcar una casilla de autorización de tratamiento de datos antes de
guardar — el backend rechaza el registro si no viene marcada, y guarda
la fecha y versión de la política aceptada en la base de datos
(columnas `acepto_tratamiento_datos`, `fecha_aceptacion_datos`,
`version_politica_aceptada` en la tabla `usuarios`).

⚠️ **Estos documentos son una plantilla de partida, no asesoría legal.**
Antes de usarlos con clientes reales, hazlos revisar por un abogado —
cada negocio puede tener condiciones particulares (política de
cancelación, franjas horarias, etc.) que vale la pena reflejar con
precisión.



1. Cambia `JWT_SECRET` en `.env` por una cadena larga y aleatoria.
2. Nunca subas el archivo `.env` real a un repositorio.
3. Sirve todo por HTTPS en producción.
4. Cambia las contraseñas de las cuentas de prueba antes de usarlo con clientes reales.
