'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';

function VerifyContent() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // evita doble ejecución en desarrollo (el token es de un solo uso)
    started.current = true;
    if (!token) {
      setState('error');
      setMessage('El enlace no es válido.');
      return;
    }
    api<{ message: string }>('/auth/verify-email', { body: { token } })
      .then((result) => {
        setState('ok');
        setMessage(result.message);
      })
      .catch((caught: unknown) => {
        setState('error');
        setMessage(errorMessage(caught));
      });
  }, [token]);

  return (
    <div className="center-stack">
      <div className="big-emoji" aria-hidden="true">
        {state === 'loading' ? '⏳' : state === 'ok' ? '✅' : '⚠️'}
      </div>
      <h2>{state === 'loading' ? 'Verificando…' : state === 'ok' ? '¡Correo verificado!' : 'No pudimos verificar'}</h2>
      <p className="muted">{message}</p>
      <Link href="/login" className="btn btn-primary">
        Ir a iniciar sesión
      </Link>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="muted">Cargando…</p>}>
      <VerifyContent />
    </Suspense>
  );
}
