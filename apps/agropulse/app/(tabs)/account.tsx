/**
 * AgroPulse — Pantalla de Cuenta / Diagnóstico (Tab 4)
 *
 * Muestra información del usuario, rol, organización.
 * Incluye pantalla de diagnóstico con estado de conectividad.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert as RNAlert,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/hooks/useAuth';
import { COLORS } from '@/lib/utils/colors';

export default function AccountScreen() {
  const { user, organization, role, signOut } = useAuth();
  const [diagnostics, setDiagnostics] = useState({
    supabaseConnected: false,
    lastReadingTime: '—',
    totalReadings: 0,
    realtimeStatus: 'Desconocido',
    checking: true,
  });

  useEffect(() => {
    runDiagnostics();
  }, [organization]);

  const runDiagnostics = async () => {
    setDiagnostics((prev) => ({ ...prev, checking: true }));

    try {
      // Test conexión a Supabase
      const { error: pingError } = await supabase
        .from('organizations')
        .select('id')
        .limit(1);

      const supabaseConnected = !pingError;

      // Última lectura global
      let lastReadingTime = '—';
      let totalReadings = 0;

      if (organization) {
        const { data: plots } = await supabase
          .from('plots')
          .select('id')
          .eq('org_id', organization.id);

        const plotIds = (plots || []).map((p: any) => p.id);

        if (plotIds.length > 0) {
          const { data: stations } = await supabase
            .from('stations')
            .select('id')
            .in('plot_id', plotIds);

          const stationIds = (stations || []).map((s: any) => s.id);

          if (stationIds.length > 0) {
            const { data: lastReading } = await supabase
              .from('readings')
              .select('measured_at')
              .in('station_id', stationIds)
              .order('measured_at', { ascending: false })
              .limit(1);

            if (lastReading?.[0]) {
              lastReadingTime = new Date(lastReading[0].measured_at).toLocaleString('es-AR');
            }

            const { count } = await supabase
              .from('readings')
              .select('*', { count: 'exact', head: true })
              .in('station_id', stationIds);

            totalReadings = count || 0;
          }
        }
      }

      setDiagnostics({
        supabaseConnected,
        lastReadingTime,
        totalReadings,
        realtimeStatus: supabaseConnected ? 'Activo' : 'Inactivo',
        checking: false,
      });
    } catch (err) {
      setDiagnostics({
        supabaseConnected: false,
        lastReadingTime: '—',
        totalReadings: 0,
        realtimeStatus: 'Error',
        checking: false,
      });
    }
  };

  const handleSignOut = () => {
    RNAlert.alert(
      'Cerrar Sesión',
      '¿Estás seguro que querés cerrar tu sesión?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar Sesión',
          style: 'destructive',
          onPress: signOut,
        },
      ]
    );
  };

  const getRoleLabel = (r: string | null): string => {
    switch (r) {
      case 'producer': return '👨‍🌾 Productor';
      case 'operator': return '🔧 Operador';
      case 'advisor': return '👁️ Asesor';
      default: return '—';
    }
  };

  const getRoleDescription = (r: string | null): string => {
    switch (r) {
      case 'producer': return 'Acceso total: ver datos, controlar válvulas, gestionar alertas';
      case 'operator': return 'Acceso operativo: ver datos, controlar válvulas, gestionar alertas';
      case 'advisor': return 'Solo lectura: puede ver datos pero no enviar comandos';
      default: return '';
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* === Perfil === */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.email?.[0]?.toUpperCase() || '?'}
          </Text>
        </View>
        <Text style={styles.email}>{user?.email || '—'}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{getRoleLabel(role)}</Text>
        </View>
        <Text style={styles.roleDesc}>{getRoleDescription(role)}</Text>
      </View>

      {/* === Organización === */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🏢 Organización</Text>
        <View style={styles.infoCard}>
          <InfoRow label="Nombre" value={organization?.name || '—'} />
          <InfoRow label="ID" value={organization?.id?.slice(0, 8) || '—'} />
          <InfoRow
            label="Miembro desde"
            value={organization?.created_at
              ? new Date(organization.created_at).toLocaleDateString('es-AR')
              : '—'}
          />
        </View>
      </View>

      {/* === Diagnóstico === */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🔍 Diagnóstico</Text>
          <TouchableOpacity onPress={runDiagnostics} style={styles.refreshButton}>
            <Text style={styles.refreshText}>
              {diagnostics.checking ? '⏳' : '🔄'} Actualizar
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoCard}>
          <InfoRow
            label="Conexión Supabase"
            value={diagnostics.supabaseConnected ? '✅ Conectado' : '❌ Sin conexión'}
          />
          <InfoRow
            label="Realtime"
            value={diagnostics.realtimeStatus === 'Activo' ? '✅ Activo' : '❌ ' + diagnostics.realtimeStatus}
          />
          <InfoRow
            label="Última lectura"
            value={diagnostics.lastReadingTime}
          />
          <InfoRow
            label="Total lecturas"
            value={diagnostics.totalReadings.toLocaleString()}
          />
        </View>
      </View>

      {/* === Info de la App === */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ℹ️ Acerca de</Text>
        <View style={styles.infoCard}>
          <InfoRow label="App" value="AgroPulse v1.0.0" />
          <InfoRow label="Materia" value="Desarrollo de Apps Móviles" />
          <InfoRow label="TP" value="Trabajo Práctico N° 4" />
          <InfoRow label="Stack" value="Expo + Supabase + Redpanda" />
        </View>
      </View>

      {/* === Cerrar Sesión === */}
      <TouchableOpacity
        style={styles.logoutButton}
        onPress={handleSignOut}
        activeOpacity={0.7}
      >
        <Text style={styles.logoutText}>🚪 Cerrar Sesión</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 20,
  },

  // Profile
  profileCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  avatarText: {
    fontSize: 30,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  email: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  roleBadge: {
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primaryLight,
  },
  roleDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },

  // Sections
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  refreshButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  refreshText: {
    fontSize: 12,
    color: COLORS.primaryLight,
    fontWeight: '600',
  },

  // Info Card
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  infoLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    maxWidth: '60%',
    textAlign: 'right',
  },

  // Logout
  logoutButton: {
    backgroundColor: 'rgba(239, 83, 80, 0.15)',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239, 83, 80, 0.3)',
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.error,
  },
});
