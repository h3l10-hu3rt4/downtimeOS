import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const logo = await readFile(new URL('../public/images/downtimeos-symbol.svg', import.meta.url), 'utf8');

test('los correos locales de Auth usan plantillas DowntimeOS en español y enlaces seguros de Supabase', async () => {
  const plantillas = [
    { nombre: 'confirmation', asunto: 'Confirma tu correo | DowntimeOS', ruta: '../supabase/templates/confirmation.html', copy: /aceptando una invitación de equipo/ },
    { nombre: 'magic_link', asunto: 'Tu enlace seguro de acceso | DowntimeOS', ruta: '../supabase/templates/magic_link.html', copy: /continuar con tu cuenta o invitación de equipo/ },
    { nombre: 'recovery', asunto: 'Restablece tu contraseña | DowntimeOS', ruta: '../supabase/templates/recovery.html', copy: /recuperar el acceso a tu cuenta/ },
  ];

  assert.match(logo, /d="M4 18h5l3-8 4 14 3-9 2 3h7"/);
  assert.match(logo, /fill="#FFB627"/);

  for (const plantilla of plantillas) {
    const seccion = new RegExp(`\\[auth\\.email\\.template\\.${plantilla.nombre}\\]([\\s\\S]*?)(?=\\n\\[|$)`);
    const configuracion = config.match(seccion)?.[1] || '';
    assert.ok(configuracion.includes(`subject = "${plantilla.asunto}"`), `${plantilla.nombre}: asunto personalizado`);
    assert.ok(configuracion.includes(`./supabase/templates/${plantilla.nombre}.html`), `${plantilla.nombre}: ruta local configurada`);

    const html = await readFile(new URL(plantilla.ruta, import.meta.url), 'utf8');
    assert.match(html, /lang="es"/);
    assert.doesNotMatch(html, /∿/);
    assert.match(html, /src="https:\/\/downtimeos\.tech\/images\/downtimeos-symbol\.png"/);
    assert.match(html, /alt="DowntimeOS"/);
    if (plantilla.nombre === 'confirmation') {
      assert.match(html, /href="\{\{ \.RedirectTo \}\}&amp;token_hash=\{\{ \.TokenHash \}\}&amp;type=email"/);
      assert.doesNotMatch(html, /href="\{\{ \.SiteURL \}\}/);
      assert.doesNotMatch(html, /href="\{\{ \.ConfirmationURL \}\}"/);
    } else {
      assert.match(html, /href="\{\{ \.ConfirmationURL \}\}"/);
    }
    assert.match(html, plantilla.copy);
    const enlacesExternos = html.match(/https?:\/\/[^"'\s)]+/gi) || [];
    assert.ok(enlacesExternos.every((url) => /^https:\/\/downtimeos\.tech(?:\/|$)/i.test(url)), 'solo enlaza al dominio canónico seguro de DowntimeOS');
    assert.doesNotMatch(html, /<link\b[^>]+(?:src|href)="https?:/i, 'la plantilla no carga fuentes ni hojas de estilo externas');
  }
});
