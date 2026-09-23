/**
 * AgroPulse — Utilidad de Semáforo (Plot Status)
 *
 * Función pura que calcula el estado semáforo de un lote
 * basado en la última lectura y los umbrales configurados.
 */

import { PlotStatusType, Reading } from '@/lib/types/database';

export interface PlotThresholds {
  threshold_min: number;
  threshold_max: number;
}

/** Tiempo máximo en minutos antes de considerar datos como "stale" */
const STALE_THRESHOLD_MINUTES = 15;

/**
 * Calcula el estado semáforo de un lote.
 *
 * @param reading - Última lectura del sensor (null si no hay datos)
 * @param thresholds - Umbrales min/max del lote
 * @returns PlotStatusType: 'stale' | 'dry' | 'optimal' | 'wet'
 */
export function getPlotStatus(
  reading: Reading | null | undefined,
  thresholds: PlotThresholds
): PlotStatusType {
  // Sin datos → stale
  if (!reading) {
    return 'stale';
  }

  // Dato antiguo (> 15 minutos) → stale
  const measuredAt = new Date(reading.measured_at).getTime();
  const now = Date.now();
  const diffMinutes = (now - measuredAt) / (1000 * 60);

  if (diffMinutes > STALE_THRESHOLD_MINUTES) {
    return 'stale';
  }

  // Evaluar humedad contra umbrales
  const moisture = reading.moisture_pct;
  const { threshold_min, threshold_max } = thresholds;

  if (moisture < threshold_min) {
    return 'dry';
  } else if (moisture >= threshold_min && moisture < threshold_max) {
    return 'optimal';
  } else {
    return 'wet';
  }
}

/**
 * Retorna una etiqueta legible para el estado del semáforo.
 */
export function getStatusLabel(status: PlotStatusType): string {
  const labels: Record<PlotStatusType, string> = {
    stale: 'Sin datos',
    dry: 'Seco',
    optimal: 'Óptimo',
    wet: 'Húmedo',
  };
  return labels[status];
}

/**
 * Retorna un icono emoji para el estado del semáforo.
 */
export function getStatusIcon(status: PlotStatusType): string {
  const icons: Record<PlotStatusType, string> = {
    stale: '⚪',
    dry: '🔴',
    optimal: '🟢',
    wet: '🔵',
  };
  return icons[status];
}
