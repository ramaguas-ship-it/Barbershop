# Resultados de las pruebas funcionales — Barbershop V1.1

Ejecución: 2026-11-21T21:23:31.230Z · PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · Node v22.23.5

**Resultado: 22 de 22 pruebas aprobadas.**

| ID | Requisito | Datos utilizados | Resultado esperado | Resultado obtenido | Estado |
|---|---|---|---|---|---|
| PF-01 | RF-01 | nombre "Ana Pruebas", tel 0987654321, correo anamwqx0ax3@pruebas.test, clave válida, consentimiento | Cliente registrado (redirige a /login); en BD existe con rol cliente y contraseña con hash bcrypt | HTTP 302 → /login; BD: rol=cliente, hash=$2b$… | Aprobada |
| PF-02 | RF-01 | mismo correo anamwqx0ax3@pruebas.test en mayúsculas | Rechazado (HTTP 409) y sigue habiendo un solo registro | HTTP 409; registros con ese correo en BD: 1 | Aprobada |
| PF-03 | RF-01 | teléfono "abc", contraseña "123", sin consentimiento | Rechazado (HTTP 400) con mensajes de validación; no se inserta | HTTP 400; filas insertadas: 0 | Aprobada |
| PF-04 | RF-02 | credenciales válidas de cliente; luego clave errónea | Válidas: redirige a /citas. Erróneas: HTTP 401 | válidas: HTTP 302 → /citas; erróneas: HTTP 401 | Aprobada |
| PF-05 | RF-02 / RNF-03 | cliente→/admin/servicios; barbero→/admin/barberos; anónimo→/citas | Cliente y barbero: HTTP 403; anónimo: redirige a /login | cliente: 403; barbero: 403; anónimo: 302 → /login | Aprobada |
| PF-06 | RNF-20 | 5 intentos fallidos y luego clave correcta | Cuenta bloqueada: HTTP 423 aun con la clave correcta; bloqueado_hasta definido en BD | HTTP 423; bloqueado_hasta=2026-11-21T21:38:28.215Z | Aprobada |
| PF-07 | Seguridad | correo "' OR '1'='1" en login; POST sin token CSRF | Inyección SQL sin efecto (HTTP 401); POST sin token rechazado (HTTP 403) | login inyectado: HTTP 401; POST sin CSRF: HTTP 403 | Aprobada |
| PF-08 | RF-03 | servicio "PRUEBA Barba", 20 min, $4.50 | Creado; en BD con los valores indicados. Duración 0 y nombre repetido rechazados (400/409) | alta HTTP 302; BD: 20 min, $4.50; duración 0: 400; duplicado: 409 | Aprobada |
| PF-09 | RF-03 / RNF-08 | cambiar precio de $4.50 a $5.25 | Precio actualizado y auditoría con usuario y valor anterior | precio BD $5.25; auditoría: usuario=115, anterior={"precio":4.5,"precio_nuevo":5.25} | Aprobada |
| PF-10 | RF-03 | desactivar servicio y consultar formulario de reserva | Servicio inactivo en BD y ya no aparece en el formulario de reserva | activo=false; aparece en reserva: false | Aprobada |
| PF-11 | RF-03 | registrar barbero "Barbero Nuevo" con correo y clave inicial | Se crean usuario (rol barbero) y perfil de barbero; el barbero puede iniciar sesión | alta HTTP 302; BD rol=barbero, barbero_id=15; login → /agenda | Aprobada |
| PF-12 | RF-04 | cliente B reserva barbero A, servicio 30 min, 2026-11-28 09:00 | Cita en estado «pendiente» asociada al cliente; el formulario no pide nombre, teléfono ni correo | HTTP 302; BD: estado=pendiente, 09:00–09:30; formulario pide datos personales: false | Aprobada |
| PF-13 | RF-05 / RN-01 | cliente C intenta barbero A, 2026-11-28 09:00 (ocupado) | Rechazado; sigue 1 sola cita activa en ese horario; el horario no figura entre los libres | HTTP 302; citas activas en ese horario: 1; 09:00 ofrecido: false; 09:30 ofrecido: true | Aprobada |
| PF-14 | RF-05 | cita de 30 min a las 09:15 (solapa con 09:00–09:30) | Rechazada por solape parcial; 1 sola cita activa en la franja | INSERT directo en SQL: rechazado por restricción EXCLUDE (23P01) | Aprobada |
| PF-15 | RF-06 | cliente B reprograma su cita a 2026-11-29 10:00; luego C reserva el horario anterior | Cita cambia de horario en BD y el horario anterior queda libre (C puede reservarlo) | reprogramación HTTP 302; BD: 2026-11-29 10:00; C reservó el horario liberado: true | Aprobada |
| PF-16 | RF-06 / RNF-08 | cliente B cancela su cita pendiente | Estado «cancelada»; horario libre; auditoría con usuario, fecha y valor anterior | HTTP 302; BD estado=cancelada; auditoría usuario=122, anterior=pendiente; 10:00 libre de nuevo: true | Aprobada |
| PF-17 | RF-06 | cita pendiente a 1 hora (plazo mínimo 2 h) y cancelación del cliente | Rechazada por plazo; la cita sigue «pendiente» en BD | HTTP 302; estado en BD: pendiente; mensaje de plazo mostrado: true | Aprobada |
| PF-18 | RF-06 | cliente C intenta cancelar la cita de otro cliente | No se modifica la cita ajena | estado de la cita ajena en BD: pendiente | Aprobada |
| PF-19 | RF-07 | barbero A consulta su agenda de 2026-11-28; barbero B consulta la suya | A ve la cita del cliente C; B no la ve | A ve la cita: true; B ve la cita: false | Aprobada |
| PF-20 | RF-07 | barbero A: pendiente→confirmada; pendiente→atendida; barbero B intenta cambiar cita de A | Primer cambio guardado; el salto inválido y el cambio ajeno se rechazan | tras confirmar: confirmada; tras salto inválido: confirmada; barbero B: HTTP 403, estado confirmada | Aprobada |
| PF-21 | RF-03 / RN-12 | eliminar servicio con citas y eliminar servicio sin citas | Con citas: no se elimina (se sugiere desactivar). Sin citas: se elimina | con citas: HTTP 302, sigue en BD: true; sin citas: HTTP 302, eliminado: true | Aprobada |
| PF-22 | RNF-13 / RN-01 | 20 clientes reservan a la vez barbero B, 2026-11-30 11:00 | Exactamente 1 solicitud aceptada; 1 sola cita activa en BD | solicitudes aceptadas: 1 de 20; citas activas en BD: 1 | Aprobada |
