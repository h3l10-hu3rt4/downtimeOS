import { existsSync } from 'node:fs';
import path from 'node:path';
import { verificarNavegacionConSesiones } from './e2e-browser-roles.mjs';

const ejecutableEdge = process.env.MVP_E2E_BROWSER_EXECUTABLE || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].find((candidato) => existsSync(candidato));

if (!ejecutableEdge) {
  throw new Error('No se encontró Microsoft Edge. Define MVP_E2E_BROWSER_EXECUTABLE con la ruta absoluta de msedge.exe.');
}

process.env.MVP_E2E_BROWSER_EXECUTABLE = ejecutableEdge;
const appUrl = process.env.MVP_E2E_APP_URL || 'http://127.0.0.1:3000';
const resultado = await verificarNavegacionConSesiones({ appUrl, soloPublicas: true });
console.log(`[e2e-public-ui] ${resultado.checks} comprobaciones correctas. Capturas: ${resultado.screenshots}`);
