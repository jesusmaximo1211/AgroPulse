/**
 * AgroPulse — Auth Layout
 */

import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/lib/hooks/useAuth';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { COLORS } from '@/lib/utils/colors';

export default function AuthLayout() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={COLORS.primaryLight} />
      </View>
    );
  }

  // Si ya está autenticado, redirigir a tabs
  if (session) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
    </Stack>
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
