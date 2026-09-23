-- ============================================================================
-- AgroPulse — Datos de Semilla (Seed)
-- Archivo: supabase/seed.sql
-- Descripción: Datos iniciales para desarrollo y testing.
--   - 1 organización: "Estancia Didáctica Concordia"
--   - 3 lotes con polígonos reales (Concordia, Entre Ríos, Argentina)
--   - 3 estaciones (una por lote)
--   - 3 válvulas (una por lote)
--   - Lecturas iniciales de ejemplo
--
-- NOTA: Este script debe ejecutarse DESPUÉS de las migraciones.
--       Los usuarios deben crearse previamente en Supabase Auth.
--       Los UUIDs son fijos para facilitar el desarrollo.
-- ============================================================================

-- ============================================================================
-- 1. ORGANIZACIÓN
-- ============================================================================
INSERT INTO organizations (id, name) VALUES
    ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Estancia Didáctica Concordia');

-- ============================================================================
-- 2. LOTES (PLOTS) — Polígonos cerca de Concordia, Entre Ríos (-31.39, -58.02)
-- ============================================================================

-- Costa 1: Lote ribereño norte (umbral humedad 30-70%)
INSERT INTO plots (id, org_id, name, boundary, threshold_min, threshold_max) VALUES
(
    '11111111-1111-1111-1111-111111111111',
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'Costa 1',
    ST_GeomFromGeoJSON('{
        "type": "Polygon",
        "coordinates": [[
            [-58.0300, -31.3800],
            [-58.0250, -31.3800],
            [-58.0250, -31.3850],
            [-58.0300, -31.3850],
            [-58.0300, -31.3800]
        ]]
    }'),
    30.00,
    70.00
);

-- Costa 2: Lote ribereño sur (umbral humedad 25-65%)
INSERT INTO plots (id, org_id, name, boundary, threshold_min, threshold_max) VALUES
(
    '22222222-2222-2222-2222-222222222222',
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'Costa 2',
    ST_GeomFromGeoJSON('{
        "type": "Polygon",
        "coordinates": [[
            [-58.0250, -31.3850],
            [-58.0200, -31.3850],
            [-58.0200, -31.3900],
            [-58.0250, -31.3900],
            [-58.0250, -31.3850]
        ]]
    }'),
    25.00,
    65.00
);

-- Monte A: Lote interior con monte (umbral humedad 35-75%)
INSERT INTO plots (id, org_id, name, boundary, threshold_min, threshold_max) VALUES
(
    '33333333-3333-3333-3333-333333333333',
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'Monte A',
    ST_GeomFromGeoJSON('{
        "type": "Polygon",
        "coordinates": [[
            [-58.0350, -31.3750],
            [-58.0280, -31.3750],
            [-58.0280, -31.3820],
            [-58.0350, -31.3820],
            [-58.0350, -31.3750]
        ]]
    }'),
    35.00,
    75.00
);

-- ============================================================================
-- 3. ESTACIONES (una por lote)
-- ============================================================================

INSERT INTO stations (id, plot_id, label, lat, lng) VALUES
    ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Estación Costa 1-A', -31.3825, -58.0275),
    ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Estación Costa 2-A', -31.3875, -58.0225),
    ('cccc3333-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'Estación Monte A-1', -31.3785, -58.0315);

-- ============================================================================
-- 4. VÁLVULAS (una por lote)
-- ============================================================================

INSERT INTO valves (id, plot_id, label, state) VALUES
    ('dd001111-dd00-dd00-dd00-dd0011111111', '11111111-1111-1111-1111-111111111111', 'Válvula Costa 1', 'closed'),
    ('dd002222-dd00-dd00-dd00-dd0022222222', '22222222-2222-2222-2222-222222222222', 'Válvula Costa 2', 'closed'),
    ('dd003333-dd00-dd00-dd00-dd0033333333', '33333333-3333-3333-3333-333333333333', 'Válvula Monte A', 'closed');

-- ============================================================================
-- 5. LECTURAS INICIALES DE EJEMPLO
-- Simula lecturas de las últimas horas para que la app tenga datos al arrancar.
-- ============================================================================

-- Costa 1: humedad óptima (50%) — Estado esperado: optimal ✅
INSERT INTO readings (station_id, moisture_pct, temperature_c, measured_at) VALUES
    ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 48.50, 22.3, now() - INTERVAL '6 hours'),
    ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 49.10, 23.1, now() - INTERVAL '5 hours'),
    ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 50.30, 24.5, now() - INTERVAL '4 hours'),
    ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 51.20, 25.0, now() - INTERVAL '3 hours'),
    ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 50.80, 24.8, now() - INTERVAL '2 hours'),
    ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 50.00, 23.5, now() - INTERVAL '1 hour'),
    ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 50.50, 22.8, now() - INTERVAL '5 minutes');

-- Costa 2: humedad baja (20%) — Estado esperado: dry 🔴
INSERT INTO readings (station_id, moisture_pct, temperature_c, measured_at) VALUES
    ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 35.00, 26.0, now() - INTERVAL '6 hours'),
    ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 32.00, 27.5, now() - INTERVAL '5 hours'),
    ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 28.50, 28.0, now() - INTERVAL '4 hours'),
    ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 25.00, 29.2, now() - INTERVAL '3 hours'),
    ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 22.30, 30.0, now() - INTERVAL '2 hours'),
    ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 20.80, 30.5, now() - INTERVAL '1 hour'),
    ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 19.50, 31.0, now() - INTERVAL '3 minutes');

-- Monte A: humedad alta (80%) — Estado esperado: wet 🔵
INSERT INTO readings (station_id, moisture_pct, temperature_c, measured_at) VALUES
    ('cccc3333-cccc-cccc-cccc-cccccccccccc', 65.00, 20.0, now() - INTERVAL '6 hours'),
    ('cccc3333-cccc-cccc-cccc-cccccccccccc', 68.50, 19.5, now() - INTERVAL '5 hours'),
    ('cccc3333-cccc-cccc-cccc-cccccccccccc', 72.00, 19.0, now() - INTERVAL '4 hours'),
    ('cccc3333-cccc-cccc-cccc-cccccccccccc', 75.50, 18.5, now() - INTERVAL '3 hours'),
    ('cccc3333-cccc-cccc-cccc-cccccccccccc', 78.00, 18.0, now() - INTERVAL '2 hours'),
    ('cccc3333-cccc-cccc-cccc-cccccccccccc', 80.20, 17.5, now() - INTERVAL '1 hour'),
    ('cccc3333-cccc-cccc-cccc-cccccccccccc', 81.00, 17.0, now() - INTERVAL '2 minutes');

-- ============================================================================
-- NOTA SOBRE USUARIOS
-- ============================================================================
-- Para completar el seed, crear usuarios en Supabase Auth (Dashboard o CLI)
-- y luego insertar memberships. Ejemplo:
--
-- INSERT INTO memberships (user_id, org_id, role) VALUES
--   ('<UUID-del-usuario>', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'producer');
--
-- Usuarios sugeridos para testing:
--   - producer@agropulse.test  → role: producer
--   - operator@agropulse.test  → role: operator
--   - advisor@agropulse.test   → role: advisor
-- ============================================================================
