'use client';

import { useEffect, useRef } from 'react';

/**
 * Muestra el HTML legacy sin modificarlo durante la hidratación de React.
 * Algunos scripts antiguos reemplazan nodos del documento (por ejemplo appBar),
 * así que deben ejecutarse después de que React haya conectado sus handlers.
 */
export function LegacyPageClient({ contenido, clase, estilos, scripts }) {
  const rootRef = useRef(null);

  useEffect(() => {
    let cancelado = false;
    const elementos = [];

    async function ejecutarScripts() {
      for (const descriptor of scripts) {
        if (cancelado) return;
        const script = document.createElement('script');
        elementos.push(script);

        if (descriptor.src) {
          script.src = descriptor.src;
          script.async = false;
          document.body.appendChild(script);
          await new Promise((resolve) => {
            script.addEventListener('load', resolve, { once: true });
            script.addEventListener('error', resolve, { once: true });
          });
        } else {
          script.textContent = descriptor.codigo;
          (rootRef.current || document.body).appendChild(script);
        }
      }

      if (!cancelado && rootRef.current) rootRef.current.dataset.legacyScriptsReady = 'true';

      // Scripts legacy attach their handlers and build the dashboard during
      // their first execution. In the Next dev server, Fast Refresh can replace
      // these external files while the tab is already open; the original
      // permission guards must still be reapplied after the full script bundle.
      if (!cancelado && rootRef.current?.querySelector('#appBar') && window.Sesion?.actual) {
        const usuario = window.Sesion.actual();
        if (usuario) {
          const mostrarEquipo = Boolean(usuario.puedeAdministrarEquipo);
          const mostrarFacturacion = Boolean(usuario.puedeVerFacturacion);
          const raiz = rootRef.current;
          raiz.querySelectorAll('.direction-account-links').forEach((nav) => {
            const equipo = nav.querySelector('a[href="/equipo"]');
            const facturacion = nav.querySelector('a[href="/suscripcion"]');
            if (equipo) equipo.hidden = !mostrarEquipo;
            if (facturacion) facturacion.hidden = !mostrarFacturacion;
            nav.hidden = !mostrarEquipo && !mostrarFacturacion;
          });
          const titulo = raiz.querySelector('#tituloTableroDireccion');
          if (titulo && usuario.rol === 'finanzas') titulo.textContent = 'Tablero de Finanzas';
        }
      }
    }

    ejecutarScripts();
    return () => {
      cancelado = true;
      elementos.forEach((script) => script.remove());
    };
  }, [scripts]);

  return <>
    {estilos.map((css, index) => <style key={`legacy-style-${index}`} dangerouslySetInnerHTML={{ __html: css }} />)}
    <div
      ref={rootRef}
      className={`next-legacy-page ${clase}`.trim()}
      dangerouslySetInnerHTML={{ __html: contenido }}
    />
  </>;
}
