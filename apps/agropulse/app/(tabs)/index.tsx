/**
 * AgroPulse — Pantalla de Mapa (Tab 1)
 *
 * Mapa interactivo nativo (react-native-maps) con polígonos de lotes 
 * coloreados según el estado del semáforo. Incluye geolocalización
 * para detectar si el usuario está dentro de un lote (Point-in-Polygon).
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert as RNAlert } from 'react-native';
import { useRouter } from 'expo-router';
import MapView, { Polygon, Marker, Region } from 'react-native-maps';
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

// Centro por defecto: Concordia, Entre Ríos (centrado sobre los 3 lotes)
const DEFAULT_REGION: Region = {
  latitude: -31.3825,
  longitude: -58.0275,
  latitudeDelta: 0.03,
  longitudeDelta: 0.03,
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

  // Ajustar la cámara para mostrar todos los polígonos
  const fitPlotsOnMap = useCallback((plotList: PlotData[]) => {
    if (plotList.length > 0 && mapRef.current) {
      const allCoords = plotList.flatMap(p => p.coordinates);
      if (allCoords.length > 0) {
        mapRef.current.fitToCoordinates(allCoords, {
          edgePadding: { top: 70, right: 70, bottom: 70, left: 70 },
          animated: true,
        });
      }
    }
  }, []);

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
      
      // Ajustar cámara con un leve retardo para asegurar que MapView esté listo
      setTimeout(() => {
        fitPlotsOnMap(enrichedPlots);
      }, 400);
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

  // Centrar en los lotes
  const centerOnPlots = () => {
    fitPlotsOnMap(plots);
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
        showsMyLocationButton={false}
        mapType="satellite"
        onMapReady={() => {
          if (plots.length > 0) {
            fitPlotsOnMap(plots);
          }
        }}
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

          const centerCoord = plot.coordinates.length > 0 ? {
            latitude: plot.coordinates.reduce((sum, c) => sum + c.latitude, 0) / plot.coordinates.length,
            longitude: plot.coordinates.reduce((sum, c) => sum + c.longitude, 0) / plot.coordinates.length,
          } : DEFAULT_REGION;

          return (
            <React.Fragment key={plot.id}>
              <Polygon
                coordinates={plot.coordinates}
                fillColor={STATUS_FILL_COLORS[status]}
                strokeColor={STATUS_COLORS[status]}
                strokeWidth={3}
                tappable
                onPress={() => router.push(`/(tabs)/plots/${plot.id}`)}
              />
              <Marker
                coordinate={centerCoord}
                title={plot.name}
                description={`Humedad: ${latestReading ? `${latestReading.moisture_pct}%` : 'Sin datos'} • ${getStatusLabel(status)}`}
                onCalloutPress={() => router.push(`/(tabs)/plots/${plot.id}`)}
              >
                <View style={[styles.plotMarkerBadge, { borderColor: STATUS_COLORS[status] }]}>
                  <Text style={styles.plotMarkerIcon}>{getStatusIcon(status)}</Text>
                  <Text style={styles.plotMarkerText}>{plot.name}</Text>
                </View>
              </Marker>
            </React.Fragment>
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

      {/* FABs de navegación */}
      <View style={styles.fabContainer}>
        <TouchableOpacity style={styles.fabButton} onPress={centerOnPlots} activeOpacity={0.8}>
          <Text style={styles.fabIcon}>🌾</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.fabButton} onPress={centerOnUser} activeOpacity={0.8}>
          <Text style={styles.fabIcon}>📍</Text>
        </TouchableOpacity>
      </View>
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

  plotMarkerBadge: {
    backgroundColor: 'rgba(20, 30, 20, 0.90)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
  plotMarkerIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  plotMarkerText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },

  legendFloat: {
    position: 'absolute',
    top: 60,
    left: 16,
    backgroundColor: 'rgba(20,30,20,0.90)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  legendTitle: { color: '#FFF', fontSize: 12, fontWeight: 'bold', marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  legendLabel: { color: '#CCC', fontSize: 11 },

  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    flexDirection: 'column',
    gap: 12,
  },
  fabButton: {
    backgroundColor: COLORS.card,
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fabIcon: { fontSize: 22 },
});
