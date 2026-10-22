-- ══════════════════════════════════════════════════════════════
-- BarberAg — Esquema de base de datos (PostgreSQL / Supabase)
--
-- Cómo cargarlo en Supabase:
--   Dashboard > SQL Editor > New query > pegar este archivo > Run.
-- O desde la terminal:
--   psql "TU_DATABASE_URL" -f schema.sql
--
-- Notas de la migración desde MySQL:
--   · AUTO_INCREMENT      -> GENERATED ALWAYS AS IDENTITY
--   · ENUM(...)           -> VARCHAR + CHECK (más simple de versionar que CREATE TYPE)
--   · TINYINT(1)          -> SMALLINT (se conservan los valores 1/0 que ya usa el código)
--   · DATETIME            -> TIMESTAMP
--   · ON UPDATE CURRENT_TIMESTAMP -> trigger (al final del archivo)
-- ══════════════════════════════════════════════════════════════

-- ── USUARIOS (clientes, barberos y administradores) ──
-- RF-41 a RF-55: registro, roles, modificación, eliminación de usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  correo VARCHAR(120) NOT NULL UNIQUE,
  telefono VARCHAR(20),
  contrasena VARCHAR(255) NOT NULL,          -- almacenada con bcrypt (RNF-12)
  rol VARCHAR(20) NOT NULL CHECK (rol IN ('administrador','barbero','cliente')),
  estado VARCHAR(10) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo')),
  -- campos específicos de barbero
  especialidad VARCHAR(150),
  calificacion_promedio DECIMAL(2,1),
  disponible SMALLINT DEFAULT NULL,          -- solo aplica a rol barbero; RF-51 activar/desactivar
  acepto_tratamiento_datos SMALLINT NOT NULL DEFAULT 0,  -- Ley 1581 de 2012 (habeas data)
  fecha_aceptacion_datos TIMESTAMP,
  version_politica_aceptada VARCHAR(10),
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── HORARIOS DE BARBERO (disponibilidad semanal) ──
-- RF-22, RF-23, RF-46, RF-51
CREATE TABLE IF NOT EXISTS horarios_barbero (
  id_horario INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_barbero INT NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  dia_semana VARCHAR(10) NOT NULL CHECK (dia_semana IN ('lunes','martes','miercoles','jueves','viernes','sabado','domingo')),
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  disponible SMALLINT NOT NULL DEFAULT 1
);

-- ── SERVICIOS ──
-- RF-33 a RF-40
CREATE TABLE IF NOT EXISTS servicios (
  id_servicio INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  precio DECIMAL(10,2) NOT NULL,
  duracion_min INT NOT NULL,
  estado VARCHAR(10) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo')),
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── RELACIÓN BARBERO-SERVICIO (muchos a muchos) ──
-- RF-48
CREATE TABLE IF NOT EXISTS barbero_servicio (
  id_barbero INT NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  id_servicio INT NOT NULL REFERENCES servicios(id_servicio) ON DELETE CASCADE,
  PRIMARY KEY (id_barbero, id_servicio)
);

-- ── CITAS ──
-- RF-01 a RF-32
CREATE TABLE IF NOT EXISTS citas (
  id_cita INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_cliente INT NOT NULL REFERENCES usuarios(id_usuario),
  id_barbero INT NOT NULL REFERENCES usuarios(id_usuario),
  id_servicio INT NOT NULL REFERENCES servicios(id_servicio),
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  estado VARCHAR(12) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','confirmada','cancelada','completada')),
  motivo_cancelacion VARCHAR(255),            -- RF-21
  preferencias_cliente TEXT,                  -- RF-27
  precio DECIMAL(10,2),                       -- RF-30
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── RESEÑAS ──
-- RF-80 a RF-84
CREATE TABLE IF NOT EXISTS resenas (
  id_resena INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_usuario INT NOT NULL REFERENCES usuarios(id_usuario),   -- cliente que escribe
  id_cita INT NOT NULL REFERENCES citas(id_cita),
  id_barbero INT NOT NULL REFERENCES usuarios(id_usuario),
  calificacion SMALLINT NOT NULL CHECK (calificacion BETWEEN 1 AND 5),
  comentario TEXT,
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── PLANES DE SUSCRIPCIÓN ──
-- RF-68, RF-69
CREATE TABLE IF NOT EXISTS planes (
  id_plan INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL,
  descripcion TEXT,
  precio DECIMAL(10,2) NOT NULL,
  duracion_dias INT NOT NULL,
  estado VARCHAR(10) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo'))
);

-- ── SUSCRIPCIONES DE CLIENTES ──
-- RF-70 a RF-79
CREATE TABLE IF NOT EXISTS suscripciones (
  id_suscripcion INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_usuario INT NOT NULL REFERENCES usuarios(id_usuario),
  id_plan INT NOT NULL REFERENCES planes(id_plan),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado VARCHAR(10) NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','vencida','cancelada','pausada'))
);

-- ── MÉTODOS DE PAGO ──
CREATE TABLE IF NOT EXISTS metodos_pago (
  id_metodo_pago INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo VARCHAR(40) NOT NULL,     -- tarjeta, PSE, efectivo, etc.
  descripcion VARCHAR(100)
);

-- ── PAGOS ──
-- RF-56 a RF-67. Integración con Wompi (Nequi, PSE/Bancolombia, tarjetas).
CREATE TABLE IF NOT EXISTS pagos (
  id_pago INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_cita INT REFERENCES citas(id_cita),
  id_suscripcion INT REFERENCES suscripciones(id_suscripcion),
  id_metodo_pago INT REFERENCES metodos_pago(id_metodo_pago),
  referencia VARCHAR(80) NOT NULL UNIQUE,      -- referencia única enviada a Wompi por cada intento de pago
  monto DECIMAL(10,2) NOT NULL,
  estado VARCHAR(12) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','exitoso','fallido','reembolsado')),
  metodo_pago_wompi VARCHAR(40),               -- NEQUI, CARD, PSE, BANCOLOMBIA_TRANSFER, etc. — lo informa Wompi
  wompi_transaction_id VARCHAR(100),
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── CONFIGURACIÓN DEL NEGOCIO ──
-- Para que el sistema sea reutilizable por cualquier barbería sin tocar código
CREATE TABLE IF NOT EXISTS configuracion_negocio (
  clave VARCHAR(50) PRIMARY KEY,
  valor TEXT
);

-- ── Equivalente a "ON UPDATE CURRENT_TIMESTAMP" de MySQL ──
CREATE OR REPLACE FUNCTION tocar_actualizado_en() RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_usuarios_actualizado ON usuarios;
CREATE TRIGGER trg_usuarios_actualizado BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

DROP TRIGGER IF EXISTS trg_citas_actualizado ON citas;
CREATE TRIGGER trg_citas_actualizado BEFORE UPDATE ON citas
  FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

DROP TRIGGER IF EXISTS trg_pagos_actualizado ON pagos;
CREATE TRIGGER trg_pagos_actualizado BEFORE UPDATE ON pagos
  FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

-- ══════════════════════════════════════════════════════════════
-- Agregados de la versión corregida (todo es idempotente: se puede ejecutar varias veces)
-- ══════════════════════════════════════════════════════════════

-- ── Reparación de bases creadas con una versión anterior: agrega solo las columnas que falten ──
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS especialidad VARCHAR(150);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS calificacion_promedio DECIMAL(2,1);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS disponible SMALLINT DEFAULT NULL;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS acepto_tratamiento_datos SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS fecha_aceptacion_datos TIMESTAMP;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS version_politica_aceptada VARCHAR(10);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE horarios_barbero ADD COLUMN IF NOT EXISTS disponible SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE citas ADD COLUMN IF NOT EXISTS motivo_cancelacion VARCHAR(255);
ALTER TABLE citas ADD COLUMN IF NOT EXISTS preferencias_cliente TEXT;
ALTER TABLE citas ADD COLUMN IF NOT EXISTS precio DECIMAL(10,2);
ALTER TABLE citas ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── BLOQUEOS DE HORARIO ──
-- El barbero bloquea un rango de un día (permiso, cita médica…): no se ofrece al agendar (RF-23)
CREATE TABLE IF NOT EXISTS bloqueos_barbero (
  id_bloqueo INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_barbero INT NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Una sola reseña por cita (RN-83) y una sola cita activa por barbero y horario ──
-- Van dentro de DO para que, si la base ya tiene datos que los contradicen, el resto del
-- esquema se cree igual y el servidor no se caiga (el código valida lo mismo antes de guardar).
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS ux_resenas_cita ON resenas(id_cita);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'No se pudo crear ux_resenas_cita: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'citas_sin_cruce') THEN
    -- Dos citas pendientes/confirmadas del mismo barbero no pueden solaparse, ni siquiera
    -- si dos clientes reservan en el mismo instante (RN-02).
    ALTER TABLE citas ADD CONSTRAINT citas_sin_cruce EXCLUDE USING gist (
      id_barbero WITH =,
      tsrange(fecha + hora_inicio, fecha + hora_fin) WITH &&
    ) WHERE (estado IN ('pendiente','confirmada'));
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'No se pudo crear citas_sin_cruce: %', SQLERRM;
END $$;
