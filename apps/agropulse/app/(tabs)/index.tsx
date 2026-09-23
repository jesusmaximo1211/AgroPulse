/**
 * AgroPulse — Pantalla de Mapa (Tab 1)
 *
 * Mapa interactivo nativo (react-native-maps) con polígonos de lotes 
 * coloreados según el estado del semáforo. Incluye geolocalización
 * para detectar si el usuario está dentro de un lote (Point-in-Polygon).
 */

import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert as RNAlert } from 'react-native';
import { useRouter } from 'expo-router';
import MapView, { Polygon, Region } from 'react-native-maps';
import * as Location from 'expo-location';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/hooks/useAuth';
import { Plot, Reading, Station } from '@/lib/types/database';
import { getPlotStatus, getStatusLabel, getStatusIcon } from '@/lib/utils/plotStatus';
import { COLORS, STATUS_COLORS, STATUS_FILL_COLORS } from '@/lib/utils/colors';
import { parseGeoJSONToCoordinates, isPointInPolygon, Coordinate } from '@/lib/utils/geo';

interface PlotData extends Plot {
  stations: (Station & { latestReading?: Reading | null })[];
  coordinates: Coordinate[];
}

// Centro por defecto: Concordia, Entre Ríos
const DEFAULT_REGION: Region = {
  latitude: -31.3930,
  longitude: -58.0170,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function MapScreen() {
  const { organization } = useAuth();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);

  const [plots, setPlots] = useState<PlotData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [currentPlotId, setCurrentPlotId] = useState<string | null>(null);

  // 1. Cargar lotes
  const loadPlots = async () => {
    if (!organization) return;

    try {
      setLoading(true);

      const { data: plotsData, error: plotsError } = await supabase
        .from('plots')
        .select('*, stations(*)')
        .eq('org_id', organization.id);

      if (plotsError) {
        setError(plotsError.message);
        return;
      }

      const enrichedPlots: PlotData[] = [];

      for (const plot of plotsData || []) {
        const stations = (plot as any).stations || [];
        const enrichedStations = [];

        for (const station of stations) {
          const { data: readings } = await supabase
            .from('readings')
            .select('*')
            .eq('station_id', station.id)
            .order('measured_at', { ascending: false })
            .limit(1);

          enrichedStations.push({
            ...station,
            latestReading: readings?.[0] || null,
          });
        }

        enrichedPlots.push({
          ...plot,
          stations: enrichedStations,
          coordinates: parseGeoJSONToCoordinates(plot.boundary),
        });
      }

      setPlots(enrichedPlots);
      
      // Ajustar la cámara si hay polígonos
      if (enrichedPlots.length > 0 && mapRef.current) {
        const allCoords = enrichedPlots.flatMap(p => p.coordinates);
        if (allCoords.length > 0) {
          mapRef.current.fitToCoordinates(allCoords, {
            edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
            animated: true,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando lotes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlots();
  }, [organization]);

  // 2. Suscripción Realtime a nuevas lecturas para actualizar semáforo
  useEffect(() => {
    const channel = supabase
      .channel('map-readings')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'readings' },
        () => {
          loadPlots();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organization]);

  // 3. Geolocalización
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Ubicación no disponible');
        return;
      }

      let loc = await Location.getCurrentPositionAsync({});
      setLocation(loc);

      // Suscribirse a cambios de ubicación
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (newLoc) => setLocation(newLoc)
      );

      return () => subscription.remove();
    })();
  }, []);

  // 4. Point-in-Polygon (Estoy en el lote)
  useEffect(() => {
    if (!location || plots.length === 0) return;

    const userCoord = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };

    const foundPlot = plots.find(plot => isPointInPolygon(userCoord, plot.coordinates));
    setCurrentPlotId(foundPlot ? foundPlot.id : null);
  }, [location, plots]);

  // Centrar en usuario
  const centerOnUser = async () => {
    if (!location && !locationError) {
      // Intentar obtener de nuevo
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        let loc = await Location.getCurrentPositionAsync({});
        setLocation(loc);
        mapRef.current?.animateToRegion({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }
    } else if (location) {
      mapRef.current?.animateToRegion({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
  };

  if (loading && plots.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primaryLight} />
        <Text style={styles.loadingText}>Cargando mapa...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadPlots}>
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentPlot = plots.find(p => p.id === currentPlotId);

  return (
    <View style={styles.container}>
      {/* Banner Superior: Lote actual */}
      <View style={styles.locationBanner}>
        {locationError ? (
          <Text style={styles.bannerText}>🚫 Ubicación no disponible</Text>
        ) : currentPlot ? (
          <Text style={styles.bannerTextSuccess}>📍 Estás en el lote: {currentPlot.name}</Text>
        ) : (
          <Text style={styles.bannerText}>📍 Fuera de los lotes</Text>
        )}
      </View>

      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        showsUserLocation={true}
        showsMyLocationButton={false} // Usamos nuestro FAB custom
        mapType="satellite"
      >
        {plots.map((plot) => {
          const latestReading = plot.stations
            .map((s) => s.latestReading)
            .filter(Boolean)
            .sort((a, b) => new Date(b!.measured_at).getTime() - new Date(a!.measured_at).getTime())[0] || null;

          const status = getPlotStatus(latestReading as Reading | null, {
            threshold_min: plot.threshold_min,
            threshold_max: plot.threshold_max,
          });

          return (
            <Polygon
              key={plot.id}
              coordinates={plot.coordinates}
              fillColor={STATUS_FILL_COLORS[status]}
              strokeColor={STATUS_COLORS[status]}
              strokeWidth={2}
              tappable
              onPress={() => router.push(`/(tabs)/plots/${plot.id}`)}
            />
          );
        })}
      </MapView>

      {/* Leyenda del semáforo flotante */}
      <View style={styles.legendFloat}>
        <Text style={styles.legendTitle}>Estado Humedad</Text>
        {(['optimal', 'dry', 'wet', 'stale'] as const).map((s) => (
          <View key={s} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS[s] }]} />
            <Text style={styles.legendLabel}>{getStatusLabel(s)}</Text>
          </View>
        ))}
      </View>

      {/* FAB: Mi ubicación */}
      <TouchableOpacity style={styles.fabLocation} onPress={centerOnUser}>
        <Text style={styles.fabIcon}>📍</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  loadingText: { color: COLORS.text, marginTop: 12, fontSize: 16 },
  errorIcon: { fontSize: 40, marginBottom: 12 },
  errorText: { color: COLORS.error, fontSize: 16, marginBottom: 20 },
  retryButton: { backgroundColor: COLORS.primary, padding: 12, borderRadius: 8 },
  retryText: { color: '#FFF', fontWeight: 'bold' },
  
  locationBanner: {
    backgroundColor: COLORS.card,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    alignItems: 'center',
    zIndex: 10,
  },
  bannerText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  bannerTextSuccess: { color: COLORS.success, fontSize: 14, fontWeight: '700' },

  map: { flex: 1 },

  legendFloat: {
    position: 'absolute',
    top: 60,
    left: 16,
    backgroundColor: 'rgba(30,30,30,0.85)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  legendTitle: { color: '#FFF', fontSize: 12, fontWeight: 'bold', marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  legendLabel: { color: '#CCC', fontSize: 11 },

  fabLocation: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    backgroundColor: COLORS.card,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fabIcon: { fontSize: 24 },
});
