-- ============================================================================
-- AgroPulse — Migración 03: Actualizaciones en Irrigación
-- Archivo: supabase/migrations/03_irrigation_updates.sql
-- Descripción: Agrega el estado 'cancelled' y la duración al comando.
-- ============================================================================

-- 1. Agregar 'cancelled' al tipo ENUM command_status si no existe
ALTER TYPE command_status ADD VALUE IF NOT EXISTS 'cancelled';

-- 2. Agregar la columna duration_min a irrigation_commands
ALTER TABLE irrigation_commands ADD COLUMN IF NOT EXISTS duration_min INTEGER;

-- Comentarios
COMMENT ON COLUMN irrigation_commands.duration_min IS 'Duración del riego en minutos. Solo aplicable si action es open. Si es nulo, queda abierto indefinidamente (hasta cerrar).';
