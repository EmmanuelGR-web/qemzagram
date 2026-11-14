/**
 * Almacén clave-valor con vencimiento, compartido entre instancias de la API (puerto).
 * Hoy: memoria (una sola instancia). Con REDIS_URL: Redis (varias instancias detrás de un balanceador).
 * Lo usan la prueba de trabajo (desafíos ya usados) y los límites de peticiones.
 */
export abstract class KeyValueStore {
  /** Guarda la clave SOLO si no existía. Devuelve true si la guardó (atómico). */
  abstract setIfAbsent(key: string, ttlMs: number): Promise<boolean>;

  /**
   * Suma 1 al contador de la clave (lo crea con vencimiento `ttlMs` si no existía).
   * Devuelve el valor nuevo y cuánto falta para que venza.
   */
  abstract increment(key: string, ttlMs: number): Promise<{ count: number; msLeft: number }>;
}
