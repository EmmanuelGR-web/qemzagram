import { toNearbyCell, type NearbyCell, type NearbyStatusDto } from '@qemzagram/shared';
import { api } from './api';

export class LocationError extends Error {}

/**
 * Pide la ubicación al navegador y la convierte EN EL DISPOSITIVO en una celda de ~1 km.
 * Las coordenadas exactas nunca se envían ni se guardan: solo salen la fila y la columna de la celda.
 * Se pide baja precisión (sin GPS fino) porque no hace falta más.
 */
export function currentCell(): Promise<NearbyCell> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new LocationError('Este navegador no permite obtener la ubicación.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(toNearbyCell(position.coords.latitude, position.coords.longitude)),
      (error) =>
        reject(
          new LocationError(
            error.code === error.PERMISSION_DENIED
              ? 'Bloqueaste el permiso de ubicación. Habilitalo desde la configuración del navegador.'
              : 'No pudimos obtener tu ubicación. Probá de nuevo.',
          ),
        ),
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 15_000 },
    );
  });
}

/** Activa o renueva la visibilidad (1 hora) con la zona actual. */
export async function showMe(): Promise<NearbyStatusDto> {
  const cell = await currentCell();
  return api<NearbyStatusDto>('/nearby/me', { method: 'PUT', body: { cell, consent: true } });
}

export async function hideMe(): Promise<void> {
  await api('/nearby/me', { method: 'DELETE' });
}
