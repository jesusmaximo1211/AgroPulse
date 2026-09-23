/**
 * AgroPulse — Hook de Estado de Lote (Semáforo)
 *
 * Combina la última lectura de un lote con sus umbrales
 * para calcular el estado semáforo en tiempo real.
 */

import { useMemo } from 'react';
import { Reading, PlotStatusType } from '@/lib/types/database';
import { getPlotStatus, getStatusLabel, getStatusIcon, PlotThresholds } from '@/lib/utils/plotStatus';
import { STATUS_COLORS, STATUS_BG_COLORS } from '@/lib/utils/colors';

interface UsePlotStatusOptions {
  /** Última lectura del sensor */
  latestReading: Reading | null | undefined;
  /** Umbrales del lote */
  thresholds: PlotThresholds;
}

interface UsePlotStatusResult {
  /** Estado del semáforo */
  status: PlotStatusType;
  /** Etiqueta legible */
  label: string;
  /** Icono emoji */
  icon: string;
  /** Color principal */
  color: string;
  /** Color de fondo */
  bgColor: string;
  /** Porcentaje de humedad actual (o null) */
  moisturePct: number | null;
}

export function usePlotStatus({
  latestReading,
  thresholds,
}: UsePlotStatusOptions): UsePlotStatusResult {
  return useMemo(() => {
    const status = getPlotStatus(latestReading, thresholds);

    return {
      status,
      label: getStatusLabel(status),
      icon: getStatusIcon(status),
      color: STATUS_COLORS[status],
      bgColor: STATUS_BG_COLORS[status],
      moisturePct: latestReading?.moisture_pct ?? null,
    };
  }, [latestReading, thresholds?.threshold_min, thresholds?.threshold_max]);
}
