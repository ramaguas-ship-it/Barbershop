# Barbershop V1.1 — Sistema de gestión para barbería

Repositorio: https://github.com/ramaguas-ship-it/Barbershop

Aplicación web para gestionar citas, servicios y barberos de una barbería, con **PostgreSQL** como gestor de base de datos.
Proyecto integrador de *Administración de Bases de Datos* (UTEQ, Ingeniería de Software, quinto nivel «A»).

## Tecnologías

| Capa | Tecnología |
|---|---|
| Base de datos | PostgreSQL 18 (contenedor Docker `postgres_abd`); extensión `btree_gist` |
| Servidor | Node.js ≥ 20 + Express 5 |
| Acceso a datos | `pg` (node-postgres) con **consultas parametrizadas** (sin concatenar SQL) |
| Vistas | EJS (renderizado en servidor), CSS responsivo |
| Seguridad | `bcryptjs` (hash de contraseñas), sesiones en PostgreSQL, token CSRF, bloqueo por intentos fallidos |

## Requisitos implementados (primera versión funcional)

| Requisito | Funcionalidad | Dónde verlo |
|---|---|---|
| RF-01 | Registro de cliente y perfil | `/registro`, `/perfil` |
| RF-02 | Inicio de sesión y acceso por rol | `/login` |
| RF-03 | CRUD de servicios y barberos (alta, edición, desactivar, eliminar) | `/admin/servicios`, `/admin/barberos` |
| RF-04 | Reservar cita con los datos del perfil | `/citas/nueva` |
| RF-05 | Validación de disponibilidad sin cruces | restricción `ex_citas_sin_cruce` en `db/01_schema.sql` |
| RF-06 | Reprogramar y cancelar citas pendientes | `/citas` |
| RF-07 | Agenda del barbero y cambio de estado | `/agenda` |

El resto de requisitos de la matriz de la semana 2 sigue pendiente; ver el estado en el informe (`informe/`).

## Puesta en marcha

### 1. Base de datos

Con el contenedor del manual de Docker del equipo (`postgres_abd`), cree la base y aplique los scripts:

```bash
docker exec -it postgres_abd psql -U admin_abd -d postgres -c "CREATE DATABASE barbershop;"
```

Si todavía no tiene el contenedor: `POSTGRES_PASSWORD=<clave> docker compose up -d` (usa `docker-compose.yml`, que crea la base `barbershop`).

### 2. Aplicación

```bash
npm install
cp .env.example .env        # edite DATABASE_URL (usuario, clave, puerto) y SESSION_SECRET
npm run db:init             # aplica db/01_schema.sql y db/02_seed.sql (datos de demostración)
npm start                   # http://localhost:3000
```

Sin datos de demostración: `node scripts/init-db.js --sin-semilla`.
También se pueden ejecutar los scripts a mano desde DBeaver o `psql`: `db/01_schema.sql` y luego `db/02_seed.sql`
(en este último reemplace `__HASH__` por un hash bcrypt, o use `npm run db:init`).

### Usuarios de demostración (contraseña `Barber2026!`)

| Rol | Correo |
|---|---|
| Administrador | admin@barbershop.test |
| Barbero | luis@barbershop.test · marco@barbershop.test |
| Cliente | cliente@barbershop.test (o regístrese en `/registro`) |

### 3. Pruebas funcionales

```bash
npm test                    # usa DATABASE_URL; escribe tests/resultados.md
node tests/run_tests.js --limpiar   # además borra los datos de prueba al terminar
```

Las pruebas arrancan la aplicación, ejecutan 22 casos por HTTP y verifican el efecto en PostgreSQL
(incluye 20 reservas simultáneas del mismo horario). Las filas de prueba usan el dominio `@pruebas.test`.

## Estructura

```
db/                 01_schema.sql (tablas, restricciones, triggers de auditoría) · 02_seed.sql
src/                app.js · config.js · db.js · services.js · routes/ · middleware/ · views/
public/             estilos.css
scripts/init-db.js  aplica los scripts SQL
tests/              run_tests.js · resultados.md (última ejecución)
informe/            informe_semana3.tex y evidencias
```

## Decisiones técnicas relevantes

- **Sin cruces de citas en la base de datos:** `EXCLUDE USING gist (barbero_id WITH =, tstzrange(inicio, fin) WITH &&) WHERE (estado NOT IN ('cancelada','ausente'))`. Cubre RN-01, RN-13 y RNF-13 aunque lleguen solicitudes simultáneas.
- **Sin eliminación con historial (RN-12):** las claves foráneas son `ON DELETE RESTRICT`; la interfaz sugiere desactivar.
- **Auditoría (RNF-08):** triggers registran usuario, fecha y valor anterior en cambios de precio y cancelaciones.
- **Zona horaria:** los horarios se guardan en `timestamptz` y se interpretan en `America/Guayaquil`.

## Limitaciones de esta versión

- Horario de atención global (`HORA_APERTURA`/`HORA_CIERRE`), no por barbero (RF-19 pendiente).
- Sin pago en línea, cobros, caja, inventario, cola de turnos ni correos (RF-08 y siguientes).
- Una cita pagada no se puede modificar hasta implementar devoluciones (RF-68).
- Falta recuperación de contraseña (parte de RNF-20). HTTPS no está configurado en desarrollo (`COOKIE_SECURE=true` al desplegar detrás de HTTPS).
