import type { PasskeyRegisteredDto } from '@qemzagram/shared';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { api } from './api';

export const passkeysSupported = () => typeof window !== 'undefined' && browserSupportsWebAuthn();

/** Error del navegador al usar la llave (la persona canceló, se agotó el tiempo, etc.). */
export class PasskeyCancelled extends Error {}

function friendly(error: unknown): never {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') throw new PasskeyCancelled('Se canceló o se agotó el tiempo. Probá de nuevo.');
  if (name === 'InvalidStateError') throw new PasskeyCancelled('Esta llave ya está registrada en tu cuenta.');
  throw new PasskeyCancelled('Tu navegador no pudo usar la llave de acceso.');
}

/** Registra una llave nueva: contraseña → desafío del servidor → el dispositivo crea la clave → el servidor verifica. */
export async function addPasskey(password: string, name: string): Promise<PasskeyRegisteredDto> {
  const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>('/auth/mfa/passkeys/options', { body: { password } });
  let response;
  try {
    response = await startRegistration({ optionsJSON });
  } catch (error) {
    friendly(error);
  }
  // Solo se envían los campos que la API acepta (validación estricta).
  const { id, rawId, type, response: inner, authenticatorAttachment } = response;
  return api<PasskeyRegisteredDto>('/auth/mfa/passkeys', {
    body: {
      name,
      response: {
        id,
        rawId,
        type,
        response: { clientDataJSON: inner.clientDataJSON, attestationObject: inner.attestationObject, transports: inner.transports },
        clientExtensionResults: {},
        ...(authenticatorAttachment ? { authenticatorAttachment } : {}),
      },
    },
  });
}

/** Segundo paso del login con llave: pide el desafío y lo firma con el dispositivo. */
export async function signWithPasskey(): Promise<AuthenticationResponseJSON> {
  const optionsJSON = await api<PublicKeyCredentialRequestOptionsJSON>('/auth/mfa/passkey/options', { body: {} });
  try {
    const signed = await startAuthentication({ optionsJSON });
    const { id, rawId, type, response, authenticatorAttachment } = signed;
    return {
      id,
      rawId,
      type,
      response: {
        clientDataJSON: response.clientDataJSON,
        authenticatorData: response.authenticatorData,
        signature: response.signature,
        ...(response.userHandle ? { userHandle: response.userHandle } : {}),
      },
      clientExtensionResults: {},
      ...(authenticatorAttachment ? { authenticatorAttachment } : {}),
    };
  } catch (error) {
    friendly(error);
  }
}
