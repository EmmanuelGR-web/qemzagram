/**
 * Fase 5 — Personas cercanas: grilla de celdas de ~1 km.
 *
 * La ubicación exacta NUNCA sale del dispositivo: el navegador convierte latitud/longitud en una
 * celda (fila, columna) con `toNearbyCell` y solo envía esa celda. La API calcula distancias entre
 * CENTROS de celdas y las muestra por rangos, así que moverse unos metros no cambia nada.
 */

/** Alto de una celda en grados de latitud (~1 km). */
export const NEARBY_CELL_DEGREES = 0.009;
/** Se recorta la latitud para evitar celdas degeneradas cerca de los polos. */
export const NEARBY_MAX_LATITUDE = 85;
export const NEARBY_MAX_ROW = Math.floor((2 * NEARBY_MAX_LATITUDE) / NEARBY_CELL_DEGREES);
/** La visibilidad se apaga sola a los 60 minutos (se puede renovar). */
export const NEARBY_VISIBLE_MINUTES = 60;
/** Distancia máxima de búsqueda. */
export const NEARBY_MAX_KM = 25;
export const NEARBY_RESULTS_MAX = 50;
/** Anti-rastreo: cambios de celda con al menos 2 minutos de diferencia y como mucho 20 por día. */
export const NEARBY_MIN_CHANGE_SECONDS = 120;
export const NEARBY_MAX_CHANGES_PER_DAY = 20;

/** Saludos: como mucho 20 por día; un saludo sin responder vence a las 24 h. */
export const NEARBY_GREETINGS_PER_DAY = 20;
export const NEARBY_GREETING_HOURS = 24;
/** Relación con alguien cercano: nada, saludo enviado, saludo recibido o ya conectados (agenda mutua). */
export const NEARBY_GREETING_STATES = ['none', 'sent', 'received', 'connected'] as const;
export type NearbyGreetingState = (typeof NEARBY_GREETING_STATES)[number];

export const NEARBY_DISTANCES = ['lt2', '2to5', '5to10', '10to25'] as const;
export type NearbyDistance = (typeof NEARBY_DISTANCES)[number];
export const NEARBY_DISTANCE_LABELS: Record<NearbyDistance, string> = {
  lt2: 'A menos de 2 km',
  '2to5': 'Entre 2 y 5 km',
  '5to10': 'Entre 5 y 10 km',
  '10to25': 'Entre 10 y 25 km',
};

export interface NearbyCell {
  row: number;
  col: number;
}

function clampLatitude(lat: number): number {
  return Math.max(-NEARBY_MAX_LATITUDE, Math.min(NEARBY_MAX_LATITUDE, lat));
}

function rowCenterLatitude(row: number): number {
  return -NEARBY_MAX_LATITUDE + (row + 0.5) * NEARBY_CELL_DEGREES;
}

/** Ancho (en grados de longitud) de las celdas de una fila: ~1 km en cualquier latitud. */
function columnDegrees(row: number): number {
  return NEARBY_CELL_DEGREES / Math.cos((rowCenterLatitude(row) * Math.PI) / 180);
}

/** Cantidad de columnas de una fila (las filas cercanas a los polos tienen menos). */
export function nearbyColumns(row: number): number {
  return Math.ceil(360 / columnDegrees(row));
}

export function isValidNearbyCell(cell: NearbyCell): boolean {
  return (
    Number.isInteger(cell.row) &&
    Number.isInteger(cell.col) &&
    cell.row >= 0 &&
    cell.row < NEARBY_MAX_ROW &&
    cell.col >= 0 &&
    cell.col < nearbyColumns(cell.row)
  );
}

/** Convierte una posición en su celda. Se usa EN EL DISPOSITIVO: lo exacto no se envía. */
export function toNearbyCell(lat: number, lng: number): NearbyCell {
  const row = Math.min(NEARBY_MAX_ROW - 1, Math.floor((clampLatitude(lat) + NEARBY_MAX_LATITUDE) / NEARBY_CELL_DEGREES));
  const normalizedLng = ((((lng + 180) % 360) + 360) % 360);
  const col = Math.min(nearbyColumns(row) - 1, Math.floor(normalizedLng / columnDegrees(row)));
  return { row, col };
}

export function nearbyCellCenter(cell: NearbyCell): { lat: number; lng: number } {
  return { lat: rowCenterLatitude(cell.row), lng: -180 + (cell.col + 0.5) * columnDegrees(cell.row) };
}

/** Distancia en km entre los CENTROS de dos celdas (fórmula de haversine). */
export function nearbyCellDistanceKm(a: NearbyCell, b: NearbyCell): number {
  const p = nearbyCellCenter(a);
  const q = nearbyCellCenter(b);
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(q.lat - p.lat);
  const dLng = toRad(q.lng - p.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(p.lat)) * Math.cos(toRad(q.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rango de distancia que se muestra (nunca el número exacto). `null` si está fuera del radio. */
export function nearbyDistanceBucket(km: number): NearbyDistance | null {
  if (km < 2) return 'lt2';
  if (km < 5) return '2to5';
  if (km < 10) return '5to10';
  if (km <= NEARBY_MAX_KM) return '10to25';
  return null;
}
