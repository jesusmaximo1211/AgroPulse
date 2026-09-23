/**
 * AgroPulse — Hook de Lecturas en Tiempo Real
 *
 * Suscripción Realtime a la tabla `readings` filtrada por estaciones
 * de un lote específico. Mantiene las últimas N lecturas en memoria.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Reading } from '@/lib/types/database';

interface UseRealtimeReadingsOptions {
  /** ID del lote */
  plotId: string;
  /** IDs de estaciones del lote (para filtrar) */
  stationIds: string[];
  /** Ventana de tiempo en horas para carga inicial */
  hoursWindow?: number;
  /** Máximo de lecturas a mantener en memoria */
  maxReadings?: number;
}

interface UseRealtimeReadingsResult {
  /** Lecturas ordenadas por measured_at ASC */
  readings: Reading[];
  /** Última lectura (la más reciente) */
  latestReading: Reading | null;
  /** Estado de carga inicial */
  loading: boolean;
  /** Error si hubo problema */
  error: string | null;
  /** Refrescar datos manualmente */
  refresh: () => Promise<void>;
}

export function useRealtimeReadings({
  plotId,
  stationIds,
  hoursWindow = 6,
  maxReadings = 200,
}: UseRealtimeReadingsOptions): UseRealtimeReadingsResult {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const stationIdsRef = useRef(stationIds);
  stationIdsRef.current = stationIds;
  const stationIdsKey = [...stationIds].sort().join(',');

  // Carga inicial de lecturas
  const loadReadings = useCallback(async () => {
    if (!stationIdsKey) {
      setReadings((prev) => (prev.length === 0 ? prev : []));
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const since = new Date(Date.now() - hoursWindow * 60 * 60 * 1000).toISOString();
      const currentStationIds = stationIdsKey.split(',');

      const { data, error: queryError } = await supabase
        .from('readings')
        .select('*')
        .in('station_id', currentStationIds)
        .gte('measured_at', since)
        .order('measured_at', { ascending: true })
        .limit(maxReadings);

      if (queryError) {
        setError(queryError.message);
        return;
      }

      setReadings(data as Reading[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [stationIdsKey, hoursWindow, maxReadings]);

  // Carga inicial
  useEffect(() => {
    loadReadings();
  }, [loadReadings]);

  // Suscripción Realtime
  useEffect(() => {
    if (!stationIdsKey) return;

    const channel = supabase
      .channel(`readings-plot-${plotId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'readings',
        },
        (payload) => {
          const newReading = payload.new as Reading;

          // Solo procesar si la lectura es de una estación de este lote
          if (stationIdsRef.current.includes(newReading.station_id)) {
            setReadings((prev) => {
              const updated = [...prev, newReading];
              // Mantener límite de lecturas
              if (updated.length > maxReadings) {
                return updated.slice(-maxReadings);
              }
              return updated;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [plotId, stationIdsKey, maxReadings]);

  // Última lectura
  const latestReading = readings.length > 0 ? readings[readings.length - 1] : null;

  return {
    readings,
    latestReading,
    loading,
    error,
    refresh: loadReadings,
  };
}
