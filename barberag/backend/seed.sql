-- ══════════════════════════════════════════════════════════════
-- BarberAg — Datos de prueba (seed)
-- Contraseña de todos los usuarios de prueba: "barberag123"
-- (hash bcrypt generado con 10 rondas)
--
-- Cárgalo DESPUÉS de schema.sql:
--   Supabase: SQL Editor > New query > pegar > Run
--   Terminal: psql "TU_DATABASE_URL" -f seed.sql
-- ══════════════════════════════════════════════════════════════

-- ── USUARIOS ──
INSERT INTO usuarios (nombre, correo, telefono, contrasena, rol, estado, especialidad, calificacion_promedio, disponible) VALUES
('Jorge Agudelo',   'jorge.agudelo@barberag.com', '3000000001', '$2b$10$v5vfSmcvv1k6o6Ce7sONs.OzGOi0Cwfbfkx4J6ExFTZdmc.F9SSzW', 'administrador', 'activo', NULL, NULL, 1),
('Carlos Muñoz',    'carlos.munoz@barberag.com',  '3045551234', '$2b$10$v5vfSmcvv1k6o6Ce7sONs.OzGOi0Cwfbfkx4J6ExFTZdmc.F9SSzW', 'barbero',       'activo', 'Degradados, corte + barba, diseño', NULL, 1),
('Miguel Ríos',     'miguel.rios@barberag.com',   '3045551235', '$2b$10$v5vfSmcvv1k6o6Ce7sONs.OzGOi0Cwfbfkx4J6ExFTZdmc.F9SSzW', 'barbero',       'activo', 'Cortes clásicos, afeitado',          NULL, 1),
('Andrés Palacio',  'andres.palacio@barberag.com','3045551236', '$2b$10$v5vfSmcvv1k6o6Ce7sONs.OzGOi0Cwfbfkx4J6ExFTZdmc.F9SSzW', 'barbero',       'activo', 'Wolf cut, tinte',                    NULL, 1),
('Andrés Ruiz',     'andres.ruiz@mail.com',       '3001234567', '$2b$10$v5vfSmcvv1k6o6Ce7sONs.OzGOi0Cwfbfkx4J6ExFTZdmc.F9SSzW', 'cliente',       'activo', NULL, NULL, NULL),
('Felipe Osorio',   'f.osorio@mail.com',          '3014567890', '$2b$10$v5vfSmcvv1k6o6Ce7sONs.OzGOi0Cwfbfkx4J6ExFTZdmc.F9SSzW', 'cliente',       'activo', NULL, NULL, NULL),
('Mateo Correa',    'mateo.c@mail.com',           '3127890123', '$2b$10$v5vfSmcvv1k6o6Ce7sONs.OzGOi0Cwfbfkx4J6ExFTZdmc.F9SSzW', 'cliente',       'activo', NULL, NULL, NULL),
('Pedro Londoño',   'p.londono@mail.com',         '3202223344', '$2b$10$v5vfSmcvv1k6o6Ce7sONs.OzGOi0Cwfbfkx4J6ExFTZdmc.F9SSzW', 'cliente',       'activo', NULL, NULL, NULL),
('Santiago Cardona','s.cardona@mail.com',         '3175556677', '$2b$10$v5vfSmcvv1k6o6Ce7sONs.OzGOi0Cwfbfkx4J6ExFTZdmc.F9SSzW', 'cliente',       'inactivo', NULL, NULL, NULL),
('Julián Vélez',    'julian.velez@mail.com',      '3009998877', '$2b$10$v5vfSmcvv1k6o6Ce7sONs.OzGOi0Cwfbfkx4J6ExFTZdmc.F9SSzW', 'cliente',       'activo', NULL, NULL, NULL),
('Camilo Zapata',   'camilo.zapata@mail.com',     '3011112233', '$2b$10$v5vfSmcvv1k6o6Ce7sONs.OzGOi0Cwfbfkx4J6ExFTZdmc.F9SSzW', 'cliente',       'activo', NULL, NULL, NULL);

-- ── HORARIOS (lunes a sábado 9am-7pm para los barberos) ──
INSERT INTO horarios_barbero (id_barbero, dia_semana, hora_inicio, hora_fin, disponible)
SELECT id_usuario, dia, '09:00:00', '19:00:00', 1
FROM usuarios
CROSS JOIN unnest(ARRAY['lunes','martes','miercoles','jueves','viernes','sabado']) AS dia
WHERE rol = 'barbero';

-- ── SERVICIOS ──
INSERT INTO servicios (nombre, descripcion, precio, duracion_min, estado) VALUES
('Corte clásico',    'Corte tradicional a tijera y máquina', 28000, 30, 'activo'),
('Corte + Barba',    'Corte completo con arreglo de barba',  40000, 45, 'activo'),
('Degradado',        'Degradado moderno personalizado',      32000, 35, 'activo'),
('Wolf Cut',         'Corte texturizado en capas',           45000, 50, 'activo'),
('Corte + Tinte',    'Corte con aplicación de tinte',         65000, 70, 'activo'),
('Afeitado clásico', 'Afeitado con navaja y toalla caliente', 22000, 25, 'activo');

-- ── BARBERO_SERVICIO (todos los barberos activos hacen todos los servicios, por simplicidad) ──
INSERT INTO barbero_servicio (id_barbero, id_servicio)
SELECT u.id_usuario, s.id_servicio FROM usuarios u CROSS JOIN servicios s WHERE u.rol = 'barbero';

-- ── PLANES ──
INSERT INTO planes (nombre, descripcion, precio, duracion_dias, estado) VALUES
('Básico',  'Un corte al mes con 10% de descuento',        60000, 30, 'activo'),
('Plus',    'Dos servicios al mes con 15% de descuento',   110000, 30, 'activo'),
('Premium', 'Servicios ilimitados con 20% de descuento',   180000, 30, 'activo');

-- ── CITAS (ejemplo del día actual) ──
INSERT INTO citas (id_cliente, id_barbero, id_servicio, fecha, hora_inicio, hora_fin, estado, precio) VALUES
((SELECT id_usuario FROM usuarios WHERE correo='andres.ruiz@mail.com'),   (SELECT id_usuario FROM usuarios WHERE correo='carlos.munoz@barberag.com'),  2, CURRENT_DATE, '14:00:00', '14:45:00', 'confirmada', 40000),
((SELECT id_usuario FROM usuarios WHERE correo='f.osorio@mail.com'),     (SELECT id_usuario FROM usuarios WHERE correo='miguel.rios@barberag.com'),   3, CURRENT_DATE, '14:30:00', '15:05:00', 'pendiente',  32000),
((SELECT id_usuario FROM usuarios WHERE correo='julian.velez@mail.com'), (SELECT id_usuario FROM usuarios WHERE correo='andres.palacio@barberag.com'),2, CURRENT_DATE, '15:00:00', '15:45:00', 'confirmada', 40000),
((SELECT id_usuario FROM usuarios WHERE correo='s.cardona@mail.com'),    (SELECT id_usuario FROM usuarios WHERE correo='jorge.agudelo@barberag.com'), 4, CURRENT_DATE, '15:30:00', '16:20:00', 'cancelada',  45000),
((SELECT id_usuario FROM usuarios WHERE correo='mateo.c@mail.com'),      (SELECT id_usuario FROM usuarios WHERE correo='carlos.munoz@barberag.com'),  1, CURRENT_DATE, '17:00:00', '17:30:00', 'pendiente',  28000);

-- ── MÉTODOS DE PAGO ──
INSERT INTO metodos_pago (tipo, descripcion) VALUES
('efectivo', 'Pago en efectivo en la barbería'),
('tarjeta', 'Tarjeta débito o crédito (vía Wompi)'),
('pse', 'Transferencia PSE (vía Wompi)'),
('nequi', 'Pago con Nequi (vía Wompi)');

-- ── CONFIGURACIÓN DEL NEGOCIO (para hacerlo reutilizable por cualquier barbería) ──
INSERT INTO configuracion_negocio (clave, valor) VALUES
('nombre_negocio', 'BarberAg'),
('direccion', 'Manrique Jardín, Medellín'),
('telefono', '300 000 0000'),
('horario_lun_vie', '09:00-19:00'),
('horario_sabado', '09:00-17:00'),
('horario_domingo', 'Cerrado');
