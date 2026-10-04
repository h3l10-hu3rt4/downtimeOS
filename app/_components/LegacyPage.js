import fs from 'node:fs/promises';
import path from 'node:path';
import { LegacyPageClient } from './LegacyPageClient';

function extraerBody(html) {
  const match = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
  if (!match) return { atributos: '', contenido: html, scripts: [] };
  const scripts = [];
  const contenido = match[2].replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (todo, atributosScript, codigo) => {
    const src = atributosScript.match(/src=["']([^"']+)["']/i)?.[1];
    scripts.push(src ? { src } : { codigo });
    return '';
  });
  return { atributos: match[1], contenido, scripts };
}

function extraerEstilosDelHead(html) {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  return [...head.matchAll(/<style(?:[^>]*)>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
}

export async function LegacyPage({ file }) {
  const html = await fs.readFile(path.join(process.cwd(), 'public', file), 'utf8');
  const { atributos, contenido, scripts } = extraerBody(html);
  const estilos = extraerEstilosDelHead(html);
  const clase = atributos.match(/class=["']([^"']+)["']/i)?.[1] || '';
  const carpeta = path.posix.dirname(file.replaceAll('\\', '/'));
  const scriptsConRuta = scripts.map((script) => ({
    ...script,
    src: script.src && (script.src.startsWith('/')
      ? script.src
      : path.posix.join('/', carpeta, script.src)),
  }));
  return <LegacyPageClient contenido={contenido} clase={clase} estilos={estilos} scripts={scriptsConRuta} />;
}
