/**
 * AgroPulse — Tipos TypeScript del esquema de base de datos Supabase
 */

// ============================================================================
// Enums (coinciden con los tipos ENUM de PostgreSQL)
// ============================================================================

export type MembershipRole = 'producer' | 'operator' | 'advisor';
export type ValveState = 'open' | 'closed';
export type CommandAction = 'open' | 'close';
export type CommandStatus = 'pending' | 'applied' | 'failed' | 'cancelled';
export type PlotStatusType = 'stale' | 'dry' | 'optimal' | 'wet';

// ============================================================================
// Tablas
// ============================================================================

export interface Organization {
  id: string;
  name: string;
  created_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  org_id: string;
  role: MembershipRole;
  joined_at: string;
}

export interface Plot {
  id: string;
  org_id: string;
  name: string;
  boundary: GeoJSONPolygon;
  threshold_min: number;
  threshold_max: number;
  created_at: string;
}

export interface Station {
  id: string;
  plot_id: string;
  label: string;
  lat: number;
  lng: number;
  created_at: string;
}

export interface Reading {
  id: string;
  station_id: string;
  moisture_pct: number;
  temperature_c: number | null;
  measured_at: string;
}

export interface Valve {
  id: string;
  plot_id: string;
  label: string;
  state: ValveState;
  updated_at: string;
}

export interface IrrigationCommand {
  id: string;
  valve_id: string;
  user_id: string;
  action: CommandAction;
  status: CommandStatus;
  duration_min?: number | null;
  client_request_id: string;
  created_at: string;
  resolved_at: string | null;
}

export interface Alert {
  id: string;
  plot_id: string;
  type: string;
  message: string;
  acknowledged: boolean;
  created_at: string;
}

// ============================================================================
// GeoJSON
// ============================================================================

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

// ============================================================================
// Tipos compuestos (para queries con joins)
// ============================================================================

/** Plot con su última lectura y estado semáforo */
export interface PlotWithStatus extends Plot {
  status: PlotStatusType;
  latest_reading?: Reading | null;
  valve?: Valve | null;
}

/** Membership con datos de la organización */
export interface MembershipWithOrg extends Membership {
  organizations: Organization;
}

/** Station con sus readings */
export interface StationWithReadings extends Station {
  readings: Reading[];
}
