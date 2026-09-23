-- ============================================================================
-- AgroPulse — Migración Inicial
-- Archivo: supabase/migrations/01_init.sql
-- Descripción: Esquema completo de base de datos para el sistema AgroPulse.
-- ============================================================================

-- ============================================================================
-- 1. EXTENSIONES
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "postgis";      -- Geometrías y funciones geoespaciales
CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- gen_random_uuid()

-- ============================================================================
-- 2. TIPOS ENUM
-- ============================================================================
CREATE TYPE membership_role  AS ENUM ('producer', 'operator', 'advisor');
CREATE TYPE valve_state      AS ENUM ('open', 'closed');
CREATE TYPE command_action   AS ENUM ('open', 'close');
CREATE TYPE command_status   AS ENUM ('pending', 'applied', 'failed');
CREATE TYPE plot_status_type AS ENUM ('stale', 'dry', 'optimal', 'wet');

-- ============================================================================
-- 3. TABLAS
-- ============================================================================

-- ---------------------------------------------------------------------------
-- organizations: Entidad raíz de multi-tenancy
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE organizations IS 'Organización agropecuaria. Entidad raíz de aislamiento multi-tenant.';

-- ---------------------------------------------------------------------------
-- memberships: Relación usuario ↔ organización con rol
-- ---------------------------------------------------------------------------
CREATE TABLE memberships (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    org_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role    membership_role NOT NULL DEFAULT 'operator',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_membership UNIQUE (user_id, org_id)
);

COMMENT ON TABLE memberships IS 'Asocia usuarios de auth.users a organizaciones con un rol específico.';

-- ---------------------------------------------------------------------------
-- plots: Lotes agrícolas con polígono geográfico y umbrales de humedad
-- ---------------------------------------------------------------------------
CREATE TABLE plots (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    boundary      GEOMETRY(Polygon, 4326) NOT NULL,
    threshold_min NUMERIC(5,2) NOT NULL DEFAULT 30.00,
    threshold_max NUMERIC(5,2) NOT NULL DEFAULT 70.00,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_thresholds CHECK (threshold_min < threshold_max),
    CONSTRAINT chk_threshold_min_range CHECK (threshold_min >= 0 AND threshold_min <= 100),
    CONSTRAINT chk_threshold_max_range CHECK (threshold_max >= 0 AND threshold_max <= 100)
);

COMMENT ON TABLE plots IS 'Lote agrícola con polígono PostGIS y umbrales de humedad para la lógica de semáforo.';

-- ---------------------------------------------------------------------------
-- stations: Estaciones de medición IoT dentro de un lote
-- ---------------------------------------------------------------------------
CREATE TABLE stations (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id UUID NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
    label   TEXT NOT NULL,
    lat     DOUBLE PRECISION NOT NULL,
    lng     DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE stations IS 'Estación de medición IoT asociada a un lote. Contiene sensores de humedad y temperatura.';

-- ---------------------------------------------------------------------------
-- readings: Lecturas de sensores (series temporales)
-- ---------------------------------------------------------------------------
CREATE TABLE readings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id    UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    moisture_pct  NUMERIC(5,2) NOT NULL,
    temperature_c NUMERIC(5,2),
    measured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_moisture_range CHECK (moisture_pct >= 0 AND moisture_pct <= 100)
);

COMMENT ON TABLE readings IS 'Lectura individual de un sensor. Serie temporal de humedad y temperatura.';

-- ---------------------------------------------------------------------------
-- valves: Válvulas de riego asociadas a un lote
-- ---------------------------------------------------------------------------
CREATE TABLE valves (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id UUID NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
    label   TEXT NOT NULL,
    state   valve_state NOT NULL DEFAULT 'closed',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE valves IS 'Válvula de riego física. Su estado se actualiza mediante comandos de riego.';

-- ---------------------------------------------------------------------------
-- irrigation_commands: Comandos de riego asíncronos e idempotentes
-- ---------------------------------------------------------------------------
CREATE TABLE irrigation_commands (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    valve_id          UUID NOT NULL REFERENCES valves(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES auth.users(id),
    action            command_action NOT NULL,
    status            command_status NOT NULL DEFAULT 'pending',
    client_request_id UUID NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at       TIMESTAMPTZ,

    -- Idempotencia: un solo client_request_id global
    CONSTRAINT uq_client_request UNIQUE (client_request_id)
);

COMMENT ON TABLE irrigation_commands IS
    'Comando de riego asíncrono. El client_request_id garantiza idempotencia. '
    'El partial index impide dos comandos pending simultáneos para la misma válvula.';

-- Partial unique index: impide 2 comandos "pending" para la misma válvula
CREATE UNIQUE INDEX uq_valve_pending
    ON irrigation_commands (valve_id)
    WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- alerts: Alertas generadas por el sistema
-- ---------------------------------------------------------------------------
CREATE TABLE alerts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id      UUID NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
    type         TEXT NOT NULL,            -- e.g. 'dry', 'wet', 'stale', 'command_failed'
    message      TEXT NOT NULL,
    acknowledged BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE alerts IS 'Alerta generada automáticamente cuando se detecta una condición anómala en un lote.';

-- ============================================================================
-- 4. ÍNDICES DE RENDIMIENTO
-- ============================================================================

-- Lecturas: consultas frecuentes por estación ordenadas por fecha
CREATE INDEX idx_readings_station_time
    ON readings (station_id, measured_at DESC);

-- Comandos: búsqueda por válvula y estado
CREATE INDEX idx_commands_valve_status
    ON irrigation_commands (valve_id, status);

-- Membresías: búsqueda por usuario
CREATE INDEX idx_memberships_user
    ON memberships (user_id);

-- Membresías: búsqueda por organización
CREATE INDEX idx_memberships_org
    ON memberships (org_id);

-- Alertas: por lote y sin acknowledge
CREATE INDEX idx_alerts_plot_unack
    ON alerts (plot_id, created_at DESC)
    WHERE acknowledged = false;

-- Plots: por organización
CREATE INDEX idx_plots_org
    ON plots (org_id);

-- Stations: por lote
CREATE INDEX idx_stations_plot
    ON stations (plot_id);

-- ============================================================================
-- 5. FUNCIÓN DE SEMÁFORO (plot_status)
-- ============================================================================

-- Función que calcula el estado semáforo de un lote basado en la lectura
-- más reciente de cualquiera de sus estaciones.
CREATE OR REPLACE FUNCTION get_plot_status(p_plot_id UUID)
RETURNS plot_status_type
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_moisture    NUMERIC;
    v_measured_at TIMESTAMPTZ;
    v_min         NUMERIC;
    v_max         NUMERIC;
BEGIN
    -- Obtener umbrales del lote
    SELECT threshold_min, threshold_max
      INTO v_min, v_max
      FROM plots
     WHERE id = p_plot_id;

    IF NOT FOUND THEN
        RETURN 'stale';
    END IF;

    -- Obtener la lectura más reciente de todas las estaciones del lote
    SELECT r.moisture_pct, r.measured_at
      INTO v_moisture, v_measured_at
      FROM readings r
      JOIN stations s ON s.id = r.station_id
     WHERE s.plot_id = p_plot_id
     ORDER BY r.measured_at DESC
     LIMIT 1;

    -- Sin datos → stale
    IF NOT FOUND THEN
        RETURN 'stale';
    END IF;

    -- Dato antiguo (> 15 minutos) → stale
    IF (now() - v_measured_at) > INTERVAL '15 minutes' THEN
        RETURN 'stale';
    END IF;

    -- Evaluar humedad contra umbrales
    IF v_moisture < v_min THEN
        RETURN 'dry';
    ELSIF v_moisture >= v_min AND v_moisture < v_max THEN
        RETURN 'optimal';
    ELSE
        RETURN 'wet';
    END IF;
END;
$$;

COMMENT ON FUNCTION get_plot_status IS
    'Calcula el estado semáforo de un lote: stale (gris), dry (rojo), optimal (verde), wet (azul).';

-- ============================================================================
-- 6. FUNCIÓN AUXILIAR: Última lectura de un lote
-- ============================================================================

CREATE OR REPLACE FUNCTION get_latest_reading(p_plot_id UUID)
RETURNS TABLE (
    station_id    UUID,
    moisture_pct  NUMERIC,
    temperature_c NUMERIC,
    measured_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT r.station_id, r.moisture_pct, r.temperature_c, r.measured_at
      FROM readings r
      JOIN stations s ON s.id = r.station_id
     WHERE s.plot_id = p_plot_id
     ORDER BY r.measured_at DESC
     LIMIT 1;
$$;

COMMENT ON FUNCTION get_latest_reading IS
    'Retorna la lectura más reciente de cualquier estación del lote indicado.';

-- ============================================================================
-- 7. HABILITAR REALTIME EN TABLAS CLAVE
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE readings;
ALTER PUBLICATION supabase_realtime ADD TABLE irrigation_commands;
ALTER PUBLICATION supabase_realtime ADD TABLE alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE valves;
