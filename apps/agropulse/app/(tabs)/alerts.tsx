/**
 * AgroPulse — Pantalla de Alertas (Tab 3)
 *
 * Lista de alertas con posibilidad de marcar como reconocidas.
 * Suscripción Realtime para nuevas alertas.
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
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/hooks/useAuth';
import { Alert as AlertType } from '@/lib/types/database';
import { COLORS } from '@/lib/utils/colors';

const ALERT_ICONS: Record<string, string> = {
  dry: '🔴',
  wet: '🔵',
  stale: '⚪',
  command_failed: '⚠️',
};

const ALERT_COLORS: Record<string, string> = {
  dry: COLORS.error,
  wet: COLORS.info,
  stale: '#78909C',
  command_failed: COLORS.warning,
};

export default function AlertsScreen() {
  const { organization, role } = useAuth();
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canAcknowledge = role === 'producer' || role === 'operator';

  const loadAlerts = useCallback(async () => {
    if (!organization) return;

    try {
      // Obtener IDs de plots de la organización
      const { data: plots } = await supabase
        .from('plots')
        .select('id')
        .eq('org_id', organization.id);

      const plotIds = (plots || []).map((p: any) => p.id);

      if (plotIds.length === 0) {
        setAlerts([]);
        return;
      }

      const { data } = await supabase
        .from('alerts')
        .select('*')
        .in('plot_id', plotIds)
        .order('created_at', { ascending: false })
        .limit(50);

      setAlerts(data as AlertType[] || []);
    } catch (err) {
      console.error('Error cargando alertas:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [organization]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // Realtime: nuevas alertas
  useEffect(() => {
    const channel = supabase
      .channel('alerts-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'alerts',
      }, (payload) => {
        setAlerts((prev) => [payload.new as AlertType, ...prev]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const acknowledgeAlert = async (alertId: string) => {
    const { error } = await supabase
      .from('alerts')
      .update({ acknowledged: true })
      .eq('id', alertId);

    if (!error) {
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a))
      );
    }
  };

  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged).length;

  const renderAlert = ({ item }: { item: AlertType }) => {
    const icon = ALERT_ICONS[item.type] || '📢';
    const color = ALERT_COLORS[item.type] || COLORS.textMuted;
    const timeAgo = getTimeAgo(item.created_at);

    return (
      <View style={[
        styles.alertCard,
        item.acknowledged && styles.alertAcknowledged,
      ]}>
        <View style={[styles.alertStripe, { backgroundColor: color }]} />
        <View style={styles.alertContent}>
          <View style={styles.alertHeader}>
            <Text style={styles.alertIcon}>{icon}</Text>
            <Text style={[styles.alertType, { color }]}>
              {item.type.replace('_', ' ').toUpperCase()}
            </Text>
            <Text style={styles.alertTime}>{timeAgo}</Text>
          </View>
          <Text style={[
            styles.alertMessage,
            item.acknowledged && styles.alertMessageAcked,
          ]}>
            {item.message}
          </Text>
          {!item.acknowledged && canAcknowledge && (
            <TouchableOpacity
              style={styles.ackButton}
              onPress={() => acknowledgeAlert(item.id)}
              activeOpacity={0.7}
            >
              <Text style={styles.ackButtonText}>✓ Reconocer</Text>
            </TouchableOpacity>
          )}
          {item.acknowledged && (
            <Text style={styles.ackedLabel}>✓ Reconocida</Text>
          )}
        </View>
      </View>
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
      {/* Resumen */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{alerts.length}</Text>
          <Text style={styles.summaryLabel}>Total</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: COLORS.warning }]}>
            {unacknowledgedCount}
          </Text>
          <Text style={styles.summaryLabel}>Pendientes</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: COLORS.success }]}>
            {alerts.length - unacknowledgedCount}
          </Text>
          <Text style={styles.summaryLabel}>Reconocidas</Text>
        </View>
      </View>

      <FlatList
        data={alerts}
        keyExtractor={(item) => item.id}
        renderItem={renderAlert}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadAlerts(); }}
            tintColor={COLORS.primaryLight}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyText}>No hay alertas</Text>
            <Text style={styles.emptySubtext}>
              El sistema está funcionando correctamente
            </Text>
          </View>
        }
      />
    </View>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
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
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
  },
  summaryLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: COLORS.border,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  alertCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    overflow: 'hidden',
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  alertAcknowledged: {
    opacity: 0.6,
  },
  alertStripe: {
    width: 4,
  },
  alertContent: {
    flex: 1,
    padding: 14,
    gap: 6,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  alertIcon: {
    fontSize: 14,
  },
  alertType: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    flex: 1,
  },
  alertTime: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  alertMessage: {
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 18,
  },
  alertMessageAcked: {
    color: COLORS.textMuted,
  },
  ackButton: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    marginTop: 4,
  },
  ackButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  ackedLabel: {
    fontSize: 11,
    color: COLORS.success,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  emptySubtext: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 4,
  },
});
