/**
 * AgroPulse — Detalle de Lote
 *
 * Pantalla con:
 * - Estado semáforo grande
 * - Gráfico de humedad de 6h (simplificado con barras)
 * - Control de válvula (abrir/cerrar)
 * - Historial de comandos de riego
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert as RNAlert,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRealtimeReadings } from '@/lib/hooks/useRealtimeReadings';
import { useRealtimeCommands } from '@/lib/hooks/useRealtimeCommands';
import { usePlotStatus } from '@/lib/hooks/usePlotStatus';
import { Plot, Station, Valve, Reading, CommandStatus } from '@/lib/types/database';
import { COLORS, STATUS_COLORS } from '@/lib/utils/colors';

export default function PlotDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { role } = useAuth();
  const [plot, setPlot] = useState<Plot | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [valve, setValve] = useState<Valve | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canCommand = role === 'producer' || role === 'operator';

  // Cargar datos del lote
  const loadPlotData = useCallback(async () => {
    if (!id) return;

    try {
      const { data: plotData } = await supabase
        .from('plots')
        .select('*, stations(*), valves(*)')
        .eq('id', id)
        .single();

      if (plotData) {
        const p = plotData as any;
        setPlot(p);
        setStations(p.stations || []);
        setValve(p.valves?.[0] || null);
      }
    } catch (err) {
      console.error('Error cargando lote:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    loadPlotData();
  }, [loadPlotData]);

  // Suscripción Realtime a válvulas
  useEffect(() => {
    if (!valve?.id) return;

    const channel = supabase
      .channel(`valve-${valve.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'valves',
        filter: `id=eq.${valve.id}`,
      }, (payload) => {
        setValve(payload.new as Valve);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [valve?.id]);

  // Hooks de Realtime
  const stationIds = useMemo(() => stations.map((s) => s.id), [stations]);

  const { readings, latestReading, loading: readingsLoading } = useRealtimeReadings({
    plotId: id || '',
    stationIds,
    hoursWindow: 6,
  });

  const {
    commands,
    hasPending,
    sendCommand,
    cancelCommand,
    loading: commandsLoading,
  } = useRealtimeCommands({
    valveId: valve?.id || '',
  });

  const thresholds = useMemo(
    () => ({
      threshold_min: plot?.threshold_min ?? 30,
      threshold_max: plot?.threshold_max ?? 70,
    }),
    [plot?.threshold_min, plot?.threshold_max]
  );

  const plotStatus = usePlotStatus({
    latestReading,
    thresholds,
  });

  const handleCommand = async (action: 'open' | 'close') => {
    if (!canCommand) {
      RNAlert.alert('Acceso Denegado', 'Tu rol no tiene permisos para accionar válvulas.');
      return;
    }

    if (action === 'open') {
      RNAlert.alert(
        'Configurar Riego',
        `¿Por cuánto tiempo querés abrir la válvula "${valve?.label}"?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: '15 Minutos', onPress: () => executeCommand('open', 15) },
          { text: '30 Minutos', onPress: () => executeCommand('open', 30) },
          { text: '60 Minutos', onPress: () => executeCommand('open', 60) },
          { text: 'Manual (Indefinido)', onPress: () => executeCommand('open') },
        ]
      );
    } else {
      RNAlert.alert(
        'Confirmar Comando',
        `¿Estás seguro que querés cerrar la válvula "${valve?.label}"?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Confirmar', onPress: () => executeCommand('close') },
        ]
      );
    }
  };

  const executeCommand = async (action: 'open' | 'close', durationMin?: number) => {
    const { error } = await sendCommand(action, durationMin);
    if (error) {
      RNAlert.alert('Error', error);
    }
  };

  const handleCancelCommand = (commandId: string) => {
    RNAlert.alert(
      'Cancelar Comando',
      '¿Estás seguro que querés cancelar este comando en vuelo?',
      [
        { text: 'No', style: 'cancel' },
        { text: 'Sí, cancelar', onPress: async () => {
          const { error } = await cancelCommand(commandId);
          if (error) RNAlert.alert('Error', error);
        }},
      ]
    );
  };

  const handleAdjustThreshold = async (type: 'min' | 'max', delta: number) => {
    if (!canCommand || !plot) return;
    
    let newMin = plot.threshold_min;
    let newMax = plot.threshold_max;

    if (type === 'min') {
      newMin = Math.max(0, Math.min(100, plot.threshold_min + delta));
      if (newMin >= newMax) return; // Validación básica
    } else {
      newMax = Math.max(0, Math.min(100, plot.threshold_max + delta));
      if (newMax <= newMin) return;
    }

    const { error } = await supabase
      .from('plots')
      .update({ threshold_min: newMin, threshold_max: newMax })
      .eq('id', plot.id);

    if (error) {
      RNAlert.alert('Error actualizando umbral', error.message);
    } else {
      setPlot({ ...plot, threshold_min: newMin, threshold_max: newMax });
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primaryLight} />
      </View>
    );
  }

  if (!plot) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Lote no encontrado</Text>
      </View>
    );
  }

  // Preparar datos del gráfico (últimas 6h, agrupadas por hora)
  const chartData = prepareChartData(readings);

  return (
    <>
      <Stack.Screen options={{ headerTitle: `🌿 ${plot.name}` }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadPlotData(); }}
            tintColor={COLORS.primaryLight}
          />
        }
      >
        {/* === Estado Semáforo === */}
        <View style={[styles.statusCard, { borderColor: plotStatus.color }]}>
          <View style={[styles.statusBadge, { backgroundColor: plotStatus.color }]}>
            <Text style={styles.statusBadgeText}>
              {plotStatus.icon} {plotStatus.label}
            </Text>
          </View>
          <Text style={[styles.statusMoisture, { color: plotStatus.color }]}>
            {plotStatus.moisturePct !== null ? `${plotStatus.moisturePct}%` : '—'}
          </Text>
          <Text style={styles.statusLabel}>Humedad actual</Text>
          {latestReading?.temperature_c != null && (
            <Text style={styles.statusTemp}>
              🌡️ {latestReading.temperature_c}°C
            </Text>
          )}
          <Text style={styles.statusTime}>
            Umbrales: {plot.threshold_min}% — {plot.threshold_max}%
          </Text>
          {canCommand && (
            <View style={{ gap: 8, marginTop: 10 }}>
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center' }}>
                <TouchableOpacity onPress={() => handleAdjustThreshold('min', -5)} style={styles.thresholdBtn}>
                  <Text style={styles.thresholdBtnText}>-5% Mínimo</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleAdjustThreshold('min', 5)} style={styles.thresholdBtn}>
                  <Text style={styles.thresholdBtnText}>+5% Mínimo</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center' }}>
                <TouchableOpacity onPress={() => handleAdjustThreshold('max', -5)} style={styles.thresholdBtn}>
                  <Text style={styles.thresholdBtnText}>-5% Máximo</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleAdjustThreshold('max', 5)} style={styles.thresholdBtn}>
                  <Text style={styles.thresholdBtnText}>+5% Máximo</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* === Gráfico de Humedad 6h === */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📊 Humedad — Últimas 6 Horas</Text>
          <View style={styles.chartContainer}>
            {chartData.length === 0 ? (
              <Text style={styles.emptyText}>Sin datos en las últimas 6 horas</Text>
            ) : (
              <View style={styles.chart}>
                {/* Líneas de referencia */}
                <View style={styles.chartRefLines}>
                  <View style={[styles.chartRefLine, {
                    bottom: `${plot.threshold_max}%`,
                  }]}>
                    <Text style={[styles.chartRefLabel, { color: COLORS.info }]}>
                      {plot.threshold_max}%
                    </Text>
                  </View>
                  <View style={[styles.chartRefLine, {
                    bottom: `${plot.threshold_min}%`,
                  }]}>
                    <Text style={[styles.chartRefLabel, { color: COLORS.error }]}>
                      {plot.threshold_min}%
                    </Text>
                  </View>
                </View>

                {/* Barras */}
                <View style={styles.chartBars}>
                  {chartData.map((point, i) => {
                    const status = point.moisture < plot.threshold_min
                      ? 'dry'
                      : point.moisture >= plot.threshold_max
                        ? 'wet'
                        : 'optimal';

                    return (
                      <View key={i} style={styles.chartBarGroup}>
                        <View
                          style={[
                            styles.chartBar,
                            {
                              height: `${Math.max(2, point.moisture)}%`,
                              backgroundColor: STATUS_COLORS[status],
                            },
                          ]}
                        />
                        <Text style={styles.chartBarLabel}>{point.label}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        </View>

        {/* === Control de Válvula === */}
        {valve && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>💧 Control de Riego</Text>
            <View style={styles.valveCard}>
              <View style={styles.valveInfo}>
                <Text style={styles.valveLabel}>{valve.label}</Text>
                <View style={[styles.valveStatus, {
                  backgroundColor: valve.state === 'open'
                    ? 'rgba(102, 187, 106, 0.2)'
                    : 'rgba(120, 144, 156, 0.2)',
                }]}>
                  <Text style={[styles.valveStatusText, {
                    color: valve.state === 'open' ? COLORS.success : COLORS.textMuted,
                  }]}>
                    {valve.state === 'open' ? '💧 Abierta' : '🔒 Cerrada'}
                  </Text>
                </View>
              </View>

              {canCommand && (
                <View style={styles.valveButtons}>
                  <TouchableOpacity
                    style={[
                      styles.valveButton,
                      styles.valveButtonOpen,
                      (valve.state === 'open' || hasPending) && styles.valveButtonDisabled,
                    ]}
                    onPress={() => handleCommand('open')}
                    disabled={valve.state === 'open' || hasPending}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.valveButtonText}>
                      {hasPending ? '⏳ Procesando...' : '💧 Abrir'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.valveButton,
                      styles.valveButtonClose,
                      (valve.state === 'closed' || hasPending) && styles.valveButtonDisabled,
                    ]}
                    onPress={() => handleCommand('close')}
                    disabled={valve.state === 'closed' || hasPending}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.valveButtonText}>
                      {hasPending ? '⏳ Procesando...' : '🔒 Cerrar'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {!canCommand && (
                <Text style={styles.advisorNote}>
                  👁️ Modo lectura — Rol advisor no puede enviar comandos
                </Text>
              )}
            </View>
          </View>
        )}

        {/* === Historial de Comandos === */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📋 Historial de Comandos</Text>
          {commands.length === 0 ? (
            <Text style={styles.emptyText}>Sin comandos registrados</Text>
          ) : (
            <View style={styles.commandsList}>
              {commands.map((cmd) => (
                <View key={cmd.id} style={styles.commandCard}>
                  <View style={[styles.commandDot, {
                    backgroundColor: getCommandColor(cmd.status),
                  }]} />
                  <View style={styles.commandInfo}>
                    <Text style={styles.commandAction}>
                      {cmd.action === 'open' ? '💧 Abrir' : '🔒 Cerrar'} válvula
                      {cmd.duration_min ? ` (${cmd.duration_min} min)` : ''}
                    </Text>
                    <Text style={styles.commandTime}>
                      {new Date(cmd.created_at).toLocaleString('es-AR')}
                    </Text>
                  </View>
                  <View style={styles.commandRight}>
                    <View style={[styles.commandStatus, {
                      backgroundColor: getCommandBgColor(cmd.status),
                    }]}>
                      <Text style={[styles.commandStatusText, {
                        color: getCommandColor(cmd.status),
                      }]}>
                        {getCommandLabel(cmd.status)}
                      </Text>
                    </View>
                    {cmd.status === 'pending' && canCommand && (
                      <TouchableOpacity
                        style={{ marginTop: 4, alignSelf: 'flex-end' }}
                        onPress={() => handleCancelCommand(cmd.id)}
                      >
                        <Text style={{ color: COLORS.error, fontSize: 12, fontWeight: '600' }}>Cancelar</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}

// ============================================================================
// Funciones auxiliares
// ============================================================================

function prepareChartData(readings: Reading[]): { moisture: number; label: string }[] {
  if (readings.length === 0) return [];

  // Agrupar lecturas por intervalos de ~30 min
  const grouped: Map<string, number[]> = new Map();

  for (const r of readings) {
    const date = new Date(r.measured_at);
    const hour = date.getHours();
    const halfHour = date.getMinutes() < 30 ? '00' : '30';
    const key = `${hour}:${halfHour}`;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(r.moisture_pct);
  }

  return Array.from(grouped.entries()).map(([label, values]) => ({
    label,
    moisture: values.reduce((a, b) => a + b, 0) / values.length,
  }));
}

function getCommandColor(status: CommandStatus): string {
  switch (status) {
    case 'pending': return COLORS.warning;
    case 'applied': return COLORS.success;
    case 'failed': return COLORS.error;
    case 'cancelled': return COLORS.textMuted;
    default: return COLORS.text;
  }
}

function getCommandBgColor(status: CommandStatus): string {
  switch (status) {
    case 'pending': return 'rgba(255, 167, 38, 0.15)';
    case 'applied': return 'rgba(102, 187, 106, 0.15)';
    case 'failed': return 'rgba(239, 83, 80, 0.15)';
    case 'cancelled': return 'rgba(120, 144, 156, 0.15)';
    default: return 'transparent';
  }
}

function getCommandLabel(status: CommandStatus): string {
  switch (status) {
    case 'pending': return '⏳ Pendiente';
    case 'applied': return '✅ Aplicado';
    case 'failed': return '❌ Fallido';
    case 'cancelled': return '🚫 Cancelado';
    default: return 'Desconocido';
  }
}

// ============================================================================
// Estilos
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 20,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 14,
  },

  // Status Card
  statusCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusBadgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  statusMoisture: {
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -2,
  },
  statusLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  statusTemp: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  statusTime: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },

  // Sections
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 20,
  },

  // Chart
  chartContainer: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chart: {
    height: 160,
    position: 'relative',
  },
  chartRefLines: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 20,
  },
  chartRefLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  chartRefLabel: {
    fontSize: 9,
    position: 'absolute',
    right: 0,
    top: -12,
  },
  chartBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    height: 140,
    paddingTop: 10,
  },
  chartBarGroup: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  chartBar: {
    width: 14,
    borderRadius: 7,
    minHeight: 4,
  },
  chartBarLabel: {
    fontSize: 8,
    color: COLORS.textMuted,
    marginTop: 4,
  },

  // Valve Control
  valveCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 14,
  },
  valveInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  valveLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  valveStatus: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  valveStatusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  valveButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  valveButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  valveButtonOpen: {
    backgroundColor: COLORS.primary,
  },
  valveButtonClose: {
    backgroundColor: '#455A64',
  },
  valveButtonDisabled: {
    opacity: 0.4,
  },
  valveButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  advisorNote: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },

  // Commands History
  commandsList: {
    gap: 8,
  },
  commandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  commandDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  commandInfo: {
    flex: 1,
  },
  commandAction: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  commandTime: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  commandStatus: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  commandStatusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  thresholdBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  thresholdBtnText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '600',
  },
  commandRight: {
    alignItems: 'flex-end',
  },
});
