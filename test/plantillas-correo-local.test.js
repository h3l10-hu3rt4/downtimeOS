import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');

test('los correos locales de Auth usan plantillas DowntimeOS en español y enlaces seguros de Supabase', async () => {
  const plantillas = [
    { nombre: 'confirmation', asunto: 'Confirma tu correo | DowntimeOS', ruta: '../supabase/templates/confirmation.html', copy: /aceptando una invitación de equipo/ },
    { nombre: 'magic_link', asunto: 'Tu enlace seguro de acceso | DowntimeOS', ruta: '../supabase/templates/magic_link.html', copy: /continuar con tu cuenta o invitación de equipo/ },
    { nombre: 'recovery', asunto: 'Restablece tu contraseña | DowntimeOS', ruta: '../supabase/templates/recovery.html', copy: /recuperar el acceso a tu cuenta/ },
  ];

  for (const plantilla of plantillas) {
    const seccion = new RegExp(`\\[auth\\.email\\.template\\.${plantilla.nombre}\\]([\\s\\S]*?)(?=\\n\\[|$)`);
    const configuracion = config.match(seccion)?.[1] || '';
    assert.ok(configuracion.includes(`subject = "${plantilla.asunto}"`), `${plantilla.nombre}: asunto personalizado`);
    assert.ok(configuracion.includes(`./supabase/templates/${plantilla.nombre}.html`), `${plantilla.nombre}: ruta local configurada`);

    const html = await readFile(new URL(plantilla.ruta, import.meta.url), 'utf8');
    assert.match(html, /lang="es"/);
    assert.match(html, /href="\{\{ \.ConfirmationURL \}\}"/);
    assert.match(html, plantilla.copy);
    assert.doesNotMatch(html, /https?:\/\/(?!localhost)/i, 'la plantilla no carga recursos externos');
  }
});
