/**
 * AgroPulse — Lista de Lotes (Tab 2)
 *
 * FlatList de lotes con semáforo, humedad actual y estado de válvula.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/hooks/useAuth';
import { Plot, Reading, Valve } from '@/lib/types/database';
import { getPlotStatus, getStatusLabel, getStatusIcon } from '@/lib/utils/plotStatus';
import { COLORS, STATUS_COLORS, STATUS_BG_COLORS } from '@/lib/utils/colors';

interface PlotListItem extends Plot {
  latestReading: Reading | null;
  valve: Valve | null;
}

export default function PlotsListScreen() {
  const { organization } = useAuth();
  const router = useRouter();
  const [plots, setPlots] = useState<PlotListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPlots = useCallback(async () => {
    if (!organization) return;

    try {
      const { data: plotsData } = await supabase
        .from('plots')
        .select('*, stations(id), valves(*)')
        .eq('org_id', organization.id)
        .order('name');

      const enriched: PlotListItem[] = [];

      for (const plot of plotsData || []) {
        const stationIds = ((plot as any).stations || []).map((s: any) => s.id);
        let latestReading: Reading | null = null;

        if (stationIds.length > 0) {
          const { data: readings } = await supabase
            .from('readings')
            .select('*')
            .in('station_id', stationIds)
            .order('measured_at', { ascending: false })
            .limit(1);

          latestReading = readings?.[0] as Reading || null;
        }

        const valves = (plot as any).valves || [];

        enriched.push({
          ...plot,
          latestReading,
          valve: valves[0] || null,
        });
      }

      setPlots(enriched);
    } catch (err) {
      console.error('Error cargando lotes:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [organization]);

  useEffect(() => {
    loadPlots();
  }, [loadPlots]);

  // Realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('plots-list-readings')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'readings' }, () => {
        loadPlots();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'valves' }, () => {
        loadPlots();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadPlots]);

  const onRefresh = () => {
    setRefreshing(true);
    loadPlots();
  };

  const renderPlot = ({ item }: { item: PlotListItem }) => {
    const status = getPlotStatus(item.latestReading, {
      threshold_min: item.threshold_min,
      threshold_max: item.threshold_max,
    });
    const statusColor = STATUS_COLORS[status];
    const bgColor = STATUS_BG_COLORS[status];

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/(tabs)/plots/${item.id}`)}
        activeOpacity={0.7}
      >
        <View style={styles.cardContent}>
          {/* Semáforo */}
          <View style={[styles.statusIndicator, { backgroundColor: statusColor }]} />

          {/* Info principal */}
          <View style={styles.cardInfo}>
            <Text style={styles.plotName}>{item.name}</Text>
            <View style={styles.cardMeta}>
              <View style={[styles.badge, { backgroundColor: bgColor }]}>
                <Text style={[styles.badgeText, { color: statusColor }]}>
                  {getStatusIcon(status)} {getStatusLabel(status)}
                </Text>
              </View>
              {item.valve && (
                <View style={[styles.badge, {
                  backgroundColor: item.valve.state === 'open'
                    ? 'rgba(102, 187, 106, 0.15)'
                    : 'rgba(120, 144, 156, 0.15)',
                }]}>
                  <Text style={[styles.badgeText, {
                    color: item.valve.state === 'open' ? COLORS.success : COLORS.textMuted,
                  }]}>
                    {item.valve.state === 'open' ? '💧 Abierta' : '🔒 Cerrada'}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Humedad */}
          <View style={styles.moistureContainer}>
            <Text style={[styles.moistureValue, { color: statusColor }]}>
              {item.latestReading ? `${item.latestReading.moisture_pct}%` : '—'}
            </Text>
            <Text style={styles.moistureLabel}>Humedad</Text>
          </View>
        </View>

        {/* Barra de umbrales */}
        <View style={styles.thresholdBar}>
          <View style={styles.thresholdTrack}>
            <View
              style={[
                styles.thresholdOptimal,
                {
                  left: `${item.threshold_min}%`,
                  width: `${item.threshold_max - item.threshold_min}%`,
                },
              ]}
            />
            {item.latestReading && (
              <View
                style={[
                  styles.thresholdMarker,
                  {
                    left: `${Math.min(100, Math.max(0, item.latestReading.moisture_pct))}%`,
                    backgroundColor: statusColor,
                  },
                ]}
              />
            )}
          </View>
          <View style={styles.thresholdLabels}>
            <Text style={styles.thresholdText}>0%</Text>
            <Text style={styles.thresholdText}>{item.threshold_min}%</Text>
            <Text style={styles.thresholdText}>{item.threshold_max}%</Text>
            <Text style={styles.thresholdText}>100%</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primaryLight} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={plots}
        keyExtractor={(item) => item.id}
        renderItem={renderPlot}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primaryLight}
          />
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyText}>No hay lotes registrados</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: 32,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusIndicator: {
    width: 6,
    height: 48,
    borderRadius: 3,
  },
  cardInfo: {
    flex: 1,
    gap: 6,
  },
  plotName: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  cardMeta: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  moistureContainer: {
    alignItems: 'center',
  },
  moistureValue: {
    fontSize: 24,
    fontWeight: '800',
  },
  moistureLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  thresholdBar: {
    marginTop: 12,
  },
  thresholdTrack: {
    height: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 3,
    position: 'relative',
    overflow: 'hidden',
  },
  thresholdOptimal: {
    position: 'absolute',
    top: 0,
    height: 6,
    backgroundColor: 'rgba(102, 187, 106, 0.3)',
    borderRadius: 3,
  },
  thresholdMarker: {
    position: 'absolute',
    top: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5,
  },
  thresholdLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  thresholdText: {
    fontSize: 9,
    color: COLORS.textMuted,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
});
