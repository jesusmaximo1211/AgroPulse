/**
 * AgroPulse — Lotes Stack Layout
 */

import { Stack } from 'expo-router';
import { COLORS } from '@/lib/utils/colors';

export default function PlotsLayout() {
  return (
    <Stack
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
      }}
    >
      <Stack.Screen
        name="index"
        options={{ headerTitle: '🌿 Lotes' }}
      />
      <Stack.Screen
        name="[id]"
        options={{ headerTitle: 'Detalle del Lote' }}
      />
    </Stack>
  );
}
