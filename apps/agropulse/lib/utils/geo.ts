/**
 * AgroPulse — Utilidades Geométricas
 */

import { GeoJSONPolygon } from '@/lib/types/database';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * Convierte un GeoJSONPolygon (donde coord es [lng, lat]) 
 * a un arreglo de objetos Coordinate para react-native-maps.
 */
export function parseGeoJSONToCoordinates(polygon: GeoJSONPolygon | null | undefined): Coordinate[] {
  if (!polygon || !polygon.coordinates || polygon.coordinates.length === 0) {
    return [];
  }
  
  // Extraemos el anillo exterior del polígono
  const outerRing = polygon.coordinates[0];
  
  return outerRing.map(coord => ({
    latitude: coord[1],
    longitude: coord[0],
  }));
}

/**
 * Determina si una coordenada dada cae dentro de un polígono 
 * usando el algoritmo Ray-casting.
 * 
 * @param point Coordenada a evaluar (GPS del usuario)
 * @param polygonCoords Vértices del polígono
 */
export function isPointInPolygon(point: Coordinate, polygonCoords: Coordinate[]): boolean {
  const x = point.longitude;
  const y = point.latitude;
  
  let inside = false;
  for (let i = 0, j = polygonCoords.length - 1; i < polygonCoords.length; j = i++) {
    const xi = polygonCoords[i].longitude;
    const yi = polygonCoords[i].latitude;
    const xj = polygonCoords[j].longitude;
    const yj = polygonCoords[j].latitude;

    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}
