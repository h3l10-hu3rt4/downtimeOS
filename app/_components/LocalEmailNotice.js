'use client';

import { useEffect, useState } from 'react';
import { urlMailpitLocal } from '../../lib/mailpit-local.js';

export default function LocalEmailNotice() {
  const [mailpitUrl, setMailpitUrl] = useState('');

  useEffect(() => {
    let cancelado = false;
    fetch('/api/config')
      .then((respuesta) => respuesta.ok ? respuesta.json() : null)
      .then((configuracion) => {
        if (!cancelado) setMailpitUrl(urlMailpitLocal(configuracion?.supabase_url));
      })
      .catch(() => {});
    return () => { cancelado = true; };
  }, []);

  if (!mailpitUrl) return null;

  return <aside className="auth-local-email-note" role="note">
    <strong>Prueba local: los correos no llegan a Gmail ni Outlook.</strong>
    Las confirmaciones y recuperaciones aparecen en Mailpit.
    <a href={mailpitUrl} target="_blank" rel="noreferrer">Abrir Mailpit</a>
  </aside>;
}
