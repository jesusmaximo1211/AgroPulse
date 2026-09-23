-- ============================================================================
-- AgroPulse — Políticas de Row Level Security (RLS)
-- Archivo: supabase/migrations/02_rls.sql
-- Descripción: Aislamiento por organización + control por rol.
--   - advisor: solo SELECT
--   - producer / operator: SELECT + INSERT/UPDATE según tabla
--   - service_role: bypass total (usado por el worker)
-- ============================================================================

-- ============================================================================
-- 1. FUNCIONES HELPER DE AUTORIZACIÓN
-- ============================================================================

-- Verifica si el usuario autenticado es miembro de la organización dada.
CREATE OR REPLACE FUNCTION is_member_of(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM memberships
         WHERE user_id = auth.uid()
           AND org_id  = p_org_id
    );
$$;

COMMENT ON FUNCTION is_member_of IS
    'Retorna true si auth.uid() es miembro de la organización indicada.';

-- Verifica si el usuario autenticado tiene alguno de los roles indicados
-- en la organización dada.
CREATE OR REPLACE FUNCTION has_role(p_org_id UUID, p_roles membership_role[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM memberships
         WHERE user_id = auth.uid()
           AND org_id  = p_org_id
           AND role    = ANY(p_roles)
    );
$$;

COMMENT ON FUNCTION has_role IS
    'Retorna true si auth.uid() tiene al menos uno de los roles indicados en la organización.';

-- Helper: obtiene el org_id de un plot
CREATE OR REPLACE FUNCTION get_plot_org_id(p_plot_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT org_id FROM plots WHERE id = p_plot_id;
$$;

-- Helper: obtiene el org_id de una estación (via plot)
CREATE OR REPLACE FUNCTION get_station_org_id(p_station_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT p.org_id
      FROM stations s
      JOIN plots p ON p.id = s.plot_id
     WHERE s.id = p_station_id;
$$;

-- Helper: obtiene el org_id de una válvula (via plot)
CREATE OR REPLACE FUNCTION get_valve_org_id(p_valve_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT p.org_id
      FROM valves v
      JOIN plots p ON p.id = v.plot_id
     WHERE v.id = p_valve_id;
$$;

-- ============================================================================
-- 2. HABILITAR RLS EN TODAS LAS TABLAS
-- ============================================================================

ALTER TABLE organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships         ENABLE ROW LEVEL SECURITY;
ALTER TABLE plots               ENABLE ROW LEVEL SECURITY;
ALTER TABLE stations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE readings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE valves              ENABLE ROW LEVEL SECURITY;
ALTER TABLE irrigation_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts              ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. POLÍTICAS — organizations
-- ============================================================================

-- SELECT: solo si el usuario es miembro
CREATE POLICY "organizations_select"
    ON organizations FOR SELECT
    TO authenticated
    USING (is_member_of(id));

-- ============================================================================
-- 4. POLÍTICAS — memberships
-- ============================================================================

-- SELECT: un usuario ve los miembros de sus organizaciones
CREATE POLICY "memberships_select"
    ON memberships FOR SELECT
    TO authenticated
    USING (is_member_of(org_id));

-- ============================================================================
-- 5. POLÍTICAS — plots
-- ============================================================================

-- SELECT: miembros de la organización (cualquier rol)
CREATE POLICY "plots_select"
    ON plots FOR SELECT
    TO authenticated
    USING (is_member_of(org_id));

-- INSERT: solo producer u operator
CREATE POLICY "plots_insert"
    ON plots FOR INSERT
    TO authenticated
    WITH CHECK (has_role(org_id, ARRAY['producer', 'operator']::membership_role[]));

-- UPDATE: solo producer u operator
CREATE POLICY "plots_update"
    ON plots FOR UPDATE
    TO authenticated
    USING (has_role(org_id, ARRAY['producer', 'operator']::membership_role[]))
    WITH CHECK (has_role(org_id, ARRAY['producer', 'operator']::membership_role[]));

-- ============================================================================
-- 6. POLÍTICAS — stations
-- ============================================================================

-- SELECT: miembros de la organización del lote
CREATE POLICY "stations_select"
    ON stations FOR SELECT
    TO authenticated
    USING (is_member_of(get_plot_org_id(plot_id)));

-- INSERT: producer u operator del lote
CREATE POLICY "stations_insert"
    ON stations FOR INSERT
    TO authenticated
    WITH CHECK (has_role(get_plot_org_id(plot_id), ARRAY['producer', 'operator']::membership_role[]));

-- UPDATE: producer u operator del lote
CREATE POLICY "stations_update"
    ON stations FOR UPDATE
    TO authenticated
    USING (has_role(get_plot_org_id(plot_id), ARRAY['producer', 'operator']::membership_role[]))
    WITH CHECK (has_role(get_plot_org_id(plot_id), ARRAY['producer', 'operator']::membership_role[]));

-- ============================================================================
-- 7. POLÍTICAS — readings
-- ============================================================================

-- SELECT: miembros de la organización de la estación
CREATE POLICY "readings_select"
    ON readings FOR SELECT
    TO authenticated
    USING (is_member_of(get_station_org_id(station_id)));

-- INSERT: solo service_role (worker). No se da INSERT a usuarios autenticados.
-- El worker usa la clave service_role que bypasea RLS automáticamente.
-- No se necesita política INSERT para el rol 'authenticated'.

-- ============================================================================
-- 8. POLÍTICAS — valves
-- ============================================================================

-- SELECT: miembros de la organización del lote
CREATE POLICY "valves_select"
    ON valves FOR SELECT
    TO authenticated
    USING (is_member_of(get_plot_org_id(plot_id)));

-- INSERT: producer u operator
CREATE POLICY "valves_insert"
    ON valves FOR INSERT
    TO authenticated
    WITH CHECK (has_role(get_plot_org_id(plot_id), ARRAY['producer', 'operator']::membership_role[]));

-- UPDATE: solo service_role (worker actualiza el estado).
-- No se necesita política UPDATE para 'authenticated'.

-- ============================================================================
-- 9. POLÍTICAS — irrigation_commands
-- ============================================================================

-- SELECT: miembros de la organización de la válvula
CREATE POLICY "commands_select"
    ON irrigation_commands FOR SELECT
    TO authenticated
    USING (is_member_of(get_valve_org_id(valve_id)));

-- INSERT: producer u operator de la organización de la válvula.
-- Además, el user_id debe coincidir con auth.uid().
CREATE POLICY "commands_insert"
    ON irrigation_commands FOR INSERT
    TO authenticated
    WITH CHECK (
        has_role(get_valve_org_id(valve_id), ARRAY['producer', 'operator']::membership_role[])
        AND user_id = auth.uid()
    );

-- UPDATE: solo service_role (worker actualiza status a applied/failed).
-- No se necesita política UPDATE para 'authenticated'.

-- ============================================================================
-- 10. POLÍTICAS — alerts
-- ============================================================================

-- SELECT: miembros de la organización del lote
CREATE POLICY "alerts_select"
    ON alerts FOR SELECT
    TO authenticated
    USING (is_member_of(get_plot_org_id(plot_id)));

-- INSERT: solo service_role (worker genera alertas).
-- No se necesita política INSERT para 'authenticated'.

-- UPDATE: producer u operator puede marcar como acknowledged.
-- Solo permite cambiar el campo 'acknowledged'.
CREATE POLICY "alerts_update_ack"
    ON alerts FOR UPDATE
    TO authenticated
    USING (
        has_role(get_plot_org_id(plot_id), ARRAY['producer', 'operator']::membership_role[])
    )
    WITH CHECK (
        has_role(get_plot_org_id(plot_id), ARRAY['producer', 'operator']::membership_role[])
        AND acknowledged = true
    );
