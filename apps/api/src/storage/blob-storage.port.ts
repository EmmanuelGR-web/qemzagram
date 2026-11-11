/**
 * Puerto de almacenamiento de archivos privados (adjuntos y stickers propios).
 *
 * Los servicios dependen de esta abstracción y no del disco ni de un proveedor concreto:
 * hoy se usa `LocalBlobStorage` (disco local) y, cuando se elija proveedor, se agrega un
 * adaptador S3/R2 sin tocar el resto del código (principio de inversión de dependencias).
 *
 * Los datos que recibe YA están cifrados (ver `CryptoService.encryptBlob`): el almacenamiento
 * nunca ve el contenido real de los archivos.
 */
export abstract class BlobStorage {
  /** Guarda un archivo con una clave nueva (UUID). */
  abstract put(key: string, data: Buffer): Promise<void>;
  /** Lee un archivo; `null` si no existe. */
  abstract get(key: string): Promise<Buffer | null>;
  /** Borra un archivo; no falla si ya no existía. */
  abstract delete(key: string): Promise<void>;
}

/** Las claves son siempre UUID generados por el servidor: nunca se arman con datos del cliente. */
export const BLOB_KEY_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function assertBlobKey(key: string): void {
  if (!BLOB_KEY_REGEX.test(key)) throw new Error('Clave de almacenamiento inválida');
}
