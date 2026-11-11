import { Injectable } from '@nestjs/common';
import { CryptoService } from '../common/crypto.service';

/** "a" = adjunto de un chat, "s" = sticker propio. */
export type MediaScope = 'a' | 's';

/** Vida útil de una URL firmada. */
const URL_TTL_SECONDS = 60 * 60;
/**
 * El vencimiento se redondea a bloques de 15 minutos: así la misma imagen tiene la misma URL
 * durante un rato y el navegador puede reutilizar su caché en vez de descargarla otra vez.
 */
const BUCKET_SECONDS = 15 * 60;

export interface SignedUrl {
  url: string;
  expiresAt: string;
}

/**
 * URLs firmadas con vencimiento para servir archivos privados.
 * La firma (HMAC) cubre el tipo, el id y el vencimiento: cambiar cualquiera la invalida.
 * Es una capa EXTRA: además, la API exige sesión y permiso sobre el archivo en cada descarga.
 */
@Injectable()
export class MediaUrlService {
  constructor(private readonly crypto: CryptoService) {}

  sign(scope: MediaScope, id: string, now = Date.now()): SignedUrl {
    const nowSeconds = Math.floor(now / 1000);
    const exp = Math.ceil(nowSeconds / BUCKET_SECONDS) * BUCKET_SECONDS + URL_TTL_SECONDS;
    const sig = this.crypto.signUrl(`${scope}:${id}:${exp}`);
    return { url: `/media/${scope}/${id}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Verifica firma y vencimiento. Rechaza vencimientos absurdamente lejanos. */
  verify(scope: MediaScope, id: string, exp: number, sig: string, now = Date.now()): boolean {
    const nowSeconds = Math.floor(now / 1000);
    if (!Number.isSafeInteger(exp) || exp <= nowSeconds || exp > nowSeconds + URL_TTL_SECONDS + BUCKET_SECONDS) return false;
    return this.crypto.verifyUrlSignature(`${scope}:${id}:${exp}`, sig);
  }
}
