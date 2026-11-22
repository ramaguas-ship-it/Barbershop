-- =====================================================================
-- Barbershop V1.1 - Esquema PostgreSQL
-- Requisitos cubiertos: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
-- Reglas: RN-01, RN-12, RN-13 | RNF-04, RNF-08, RNF-13, RNF-20
-- Uso:    psql -U <usuario> -d barbershop -f db/01_schema.sql
-- Es idempotente: se puede ejecutar varias veces sobre una base vacía.
-- =====================================================================

-- Necesaria para combinar igualdad (barbero_id) con rangos en EXCLUDE.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- USUARIOS (administrador, barbero, cliente)  -> RF-01, RF-02
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id                  SERIAL PRIMARY KEY,
    nombre              VARCHAR(100) NOT NULL CHECK (length(trim(nombre)) >= 3),
    telefono            VARCHAR(15)  NOT NULL CHECK (telefono ~ '^[0-9+]{7,15}$'),
    correo              VARCHAR(120) NOT NULL,
    password_hash       VARCHAR(100) NOT NULL,              -- bcrypt (RNF-02)
    rol                 VARCHAR(15)  NOT NULL
                        CHECK (rol IN ('administrador', 'barbero', 'cliente')),
    activo              BOOLEAN      NOT NULL DEFAULT TRUE,
    consentimiento      BOOLEAN      NOT NULL DEFAULT FALSE, -- RNF-11
    intentos_fallidos   SMALLINT     NOT NULL DEFAULT 0,     -- RNF-20
    bloqueado_hasta     TIMESTAMPTZ,                         -- RNF-20
    creado_en           TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- Correo único sin distinguir mayúsculas.
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_correo ON usuarios (lower(correo));

-- ---------------------------------------------------------------------
-- BARBEROS (perfil operativo asociado a un usuario con rol barbero) -> RF-03
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS barberos (
    id          SERIAL PRIMARY KEY,
    usuario_id  INTEGER NOT NULL UNIQUE
                REFERENCES usuarios (id) ON DELETE RESTRICT,
    activo      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- SERVICIOS (catálogo)  -> RF-03
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS servicios (
    id            SERIAL PRIMARY KEY,
    nombre        VARCHAR(80)   NOT NULL CHECK (length(trim(nombre)) >= 3),
    duracion_min  SMALLINT      NOT NULL CHECK (duracion_min BETWEEN 5 AND 480),
    precio        NUMERIC(8,2)  NOT NULL CHECK (precio >= 0),
    activo        BOOLEAN       NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_servicios_nombre ON servicios (lower(nombre));

-- ---------------------------------------------------------------------
-- CITAS  -> RF-04, RF-05, RF-06, RF-07
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citas (
    id            SERIAL PRIMARY KEY,
    cliente_id    INTEGER NOT NULL REFERENCES usuarios  (id) ON DELETE RESTRICT,
    barbero_id    INTEGER NOT NULL REFERENCES barberos  (id) ON DELETE RESTRICT,
    servicio_id   INTEGER NOT NULL REFERENCES servicios (id) ON DELETE RESTRICT,
    inicio        TIMESTAMPTZ NOT NULL,
    fin           TIMESTAMPTZ NOT NULL,
    estado        VARCHAR(12) NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente', 'confirmada', 'en_espera',
                                    'en_atencion', 'atendida', 'ausente', 'cancelada')),
    estado_pago   VARCHAR(10) NOT NULL DEFAULT 'no_pagado'
                  CHECK (estado_pago IN ('no_pagado', 'pagado')),
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_citas_rango CHECK (fin > inicio),

    -- RN-01 / RN-13 / RNF-13: un barbero no puede tener dos citas activas
    -- que se solapen. Las citas canceladas o ausentes liberan el horario.
    -- La regla vive en la base de datos, por lo que resiste solicitudes
    -- simultáneas (no depende de validar antes en la aplicación).
    CONSTRAINT ex_citas_sin_cruce EXCLUDE USING gist (
        barbero_id WITH =,
        tstzrange(inicio, fin, '[)') WITH &&
    ) WHERE (estado NOT IN ('cancelada', 'ausente'))
);
CREATE INDEX IF NOT EXISTS ix_citas_cliente ON citas (cliente_id, inicio);
CREATE INDEX IF NOT EXISTS ix_citas_barbero ON citas (barbero_id, inicio);

-- ---------------------------------------------------------------------
-- AUDITORÍA  -> RNF-08
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria (
    id              BIGSERIAL PRIMARY KEY,
    usuario_id      INTEGER,
    accion          VARCHAR(40) NOT NULL,
    tabla           VARCHAR(30) NOT NULL,
    registro_id     INTEGER     NOT NULL,
    valor_anterior  JSONB,
    fecha           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La aplicación informa quién actúa con: SELECT set_config('app.usuario_id', '<id>', true)
CREATE OR REPLACE FUNCTION fn_auditar_precio_servicio() RETURNS trigger AS $$
BEGIN
    IF NEW.precio IS DISTINCT FROM OLD.precio THEN
        INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, valor_anterior)
        VALUES (NULLIF(current_setting('app.usuario_id', true), '')::int,
                'cambio_precio', 'servicios', OLD.id,
                jsonb_build_object('precio', OLD.precio, 'precio_nuevo', NEW.precio));
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_auditar_precio ON servicios;
CREATE TRIGGER tg_auditar_precio AFTER UPDATE ON servicios
    FOR EACH ROW EXECUTE FUNCTION fn_auditar_precio_servicio();

CREATE OR REPLACE FUNCTION fn_auditar_cancelacion_cita() RETURNS trigger AS $$
BEGIN
    IF NEW.estado = 'cancelada' AND OLD.estado <> 'cancelada' THEN
        INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, valor_anterior)
        VALUES (NULLIF(current_setting('app.usuario_id', true), '')::int,
                'cancelacion_cita', 'citas', OLD.id,
                jsonb_build_object('estado', OLD.estado, 'inicio', OLD.inicio,
                                   'barbero_id', OLD.barbero_id));
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_auditar_cancelacion ON citas;
CREATE TRIGGER tg_auditar_cancelacion AFTER UPDATE ON citas
    FOR EACH ROW EXECUTE FUNCTION fn_auditar_cancelacion_cita();

-- ---------------------------------------------------------------------
-- SESIONES (almacén de express-session / connect-pg-simple)  -> RNF-20
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sesiones (
    sid     VARCHAR NOT NULL PRIMARY KEY,
    sess    JSON    NOT NULL,
    expire  TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sesiones_expire ON sesiones (expire);
