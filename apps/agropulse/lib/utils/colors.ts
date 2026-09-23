/**
 * AgroPulse — Paleta de Colores del Semáforo
 *
 * Colores consistentes para representar el estado de los lotes
 * en mapas, listas y badges.
 */

import { PlotStatusType } from '@/lib/types/database';

/** Colores primarios del semáforo */
export const STATUS_COLORS: Record<PlotStatusType, string> = {
  stale: '#78909C',   // Gris azulado
  dry: '#EF5350',     // Rojo
  optimal: '#66BB6A', // Verde
  wet: '#42A5F5',     // Azul
};

/** Colores con transparencia para polígonos del mapa (fill) */
export const STATUS_FILL_COLORS: Record<PlotStatusType, string> = {
  stale: 'rgba(120, 144, 156, 0.25)',
  dry: 'rgba(239, 83, 80, 0.30)',
  optimal: 'rgba(102, 187, 106, 0.30)',
  wet: 'rgba(66, 165, 245, 0.30)',
};

/** Colores de fondo para badges/cards */
export const STATUS_BG_COLORS: Record<PlotStatusType, string> = {
  stale: 'rgba(120, 144, 156, 0.15)',
  dry: 'rgba(239, 83, 80, 0.15)',
  optimal: 'rgba(102, 187, 106, 0.15)',
  wet: 'rgba(66, 165, 245, 0.15)',
};

/** Paleta general de la app */
export const COLORS = {
  // Primarios
  primary: '#2E7D32',       // Verde agrícola oscuro
  primaryLight: '#4CAF50',  // Verde agrícola
  primaryDark: '#1B5E20',   // Verde oscuro

  // Fondos
  background: '#0F1A0F',       // Fondo oscuro con tinte verde
  backgroundLight: '#F5F7F5',  // Fondo claro
  surface: '#1A2E1A',          // Superficie oscura
  surfaceLight: '#FFFFFF',     // Superficie clara
  card: '#1E3A1E',             // Cards oscuras
  cardLight: '#FFFFFF',        // Cards claras

  // Texto
  text: '#E8F5E9',           // Texto principal (dark mode)
  textLight: '#1B2E1B',      // Texto principal (light mode)
  textSecondary: '#A5D6A7',  // Texto secundario (dark mode)
  textSecondaryLight: '#6B7B6B', // Texto secundario (light mode)
  textMuted: '#5A7A5A',      // Texto atenuado

  // Bordes
  border: '#2E4A2E',
  borderLight: '#E0E8E0',

  // Semánticos
  error: '#EF5350',
  warning: '#FFA726',
  success: '#66BB6A',
  info: '#42A5F5',

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.5)',
};
