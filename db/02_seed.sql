-- =====================================================================
-- Datos de demostración (solo para el entorno académico)
-- Contraseña de TODOS los usuarios de prueba: Barber2026!
-- (hash bcrypt de 10 rondas, generado con scripts/hash.js)
-- =====================================================================
INSERT INTO usuarios (nombre, telefono, correo, password_hash, rol, consentimiento) VALUES
 ('Administrador Barbershop', '0990000001', 'admin@barbershop.test',   '__HASH__', 'administrador', TRUE),
 ('Luis Barbero',             '0990000002', 'luis@barbershop.test',    '__HASH__', 'barbero',       TRUE),
 ('Marco Barbero',            '0990000003', 'marco@barbershop.test',   '__HASH__', 'barbero',       TRUE),
 ('Cliente Demo',             '0990000004', 'cliente@barbershop.test', '__HASH__', 'cliente',       TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO barberos (usuario_id)
SELECT id FROM usuarios WHERE rol = 'barbero'
ON CONFLICT DO NOTHING;

INSERT INTO servicios (nombre, duracion_min, precio) VALUES
 ('Corte clásico',    30,  6.00),
 ('Corte y barba',    60, 10.00),
 ('Perfilado de barba', 30, 4.50),
 ('Corte infantil',   30,  5.00)
ON CONFLICT DO NOTHING;
