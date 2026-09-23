/**
 * AgroPulse — Tabs Layout
 *
 * 4 pestañas: Mapa | Lotes | Alertas | Cuenta
 * Redirige a login si no hay sesión activa.
 */

import { Redirect, Tabs } from 'expo-router';
import { Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '@/lib/hooks/useAuth';
import { COLORS } from '@/lib/utils/colors';

function EmojiIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
  );
}

export default function TabLayout() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={COLORS.primaryLight} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: {
          backgroundColor: COLORS.background,
        },
        headerTintColor: COLORS.text,
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 18,
        },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 4,
        },
        tabBarActiveTintColor: COLORS.primaryLight,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Mapa',
          tabBarLabel: 'Mapa',
          headerTitle: '🌾 AgroPulse — Mapa',
          tabBarIcon: ({ focused }) => <EmojiIcon emoji="🗺️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="plots"
        options={{
          title: 'Lotes',
          tabBarLabel: 'Lotes',
          headerShown: false,
          tabBarIcon: ({ focused }) => <EmojiIcon emoji="🌿" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alertas',
          tabBarLabel: 'Alertas',
          headerTitle: '🔔 Alertas',
          tabBarIcon: ({ focused }) => <EmojiIcon emoji="🚨" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Cuenta',
          tabBarLabel: 'Cuenta',
          headerTitle: '👤 Cuenta',
          tabBarIcon: ({ focused }) => <EmojiIcon emoji="⚙️" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
});
