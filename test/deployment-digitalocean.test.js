import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const leer = async (ruta) => readFile(new URL(ruta, import.meta.url), 'utf8');

test('Compose de producción usa imagen inmutable y solo publica localhost', async () => {
  const compose = await leer('../docker-compose.production.yml');
  assert.match(compose, /image:\s+\$\{DOWNTIMEOS_IMAGE:/);
  assert.doesNotMatch(compose, /^\s+build:/m);
  assert.match(compose, /127\.0\.0\.1:3000:3000/);
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /cap_drop:\s*\n\s+- ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /\/etc\/downtimeos\/production\.env/);
  assert.match(compose, /max-size:\s*"10m"/);
  assert.match(compose, /NODE_OPTIONS:\s*--max-old-space-size=512/);
  assert.match(compose, /mem_limit:\s*\$\{DOWNTIMEOS_MEMORY_LIMIT:-768m\}/);
  assert.match(compose, /\/tmp:size=48m/);
  assert.match(compose, /\.next\/cache:size=32m/);
});

test('pipeline construye en PR sin publicar y publica a GHCR solo desde main', async () => {
  const workflow = await leer('../.github/workflows/container.yml');
  assert.match(workflow, /pull_request:\s*\n\s+branches:\s*\[main\]/);
  assert.match(workflow, /packages:\s*write/);
  assert.match(workflow, /push:\s*\$\{\{ github\.event_name == 'push' \}\}/);
  assert.match(workflow, /if:\s*github\.event_name == 'push'/);
  assert.match(workflow, /npm audit --omit=dev/);
});

test('despliegue exige aprobación, main, digest verificado y SSH estricto', async () => {
  const workflow = await leer('../.github/workflows/deploy-digitalocean.yml');
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /if:\s*github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /\^sha256:\[0-9a-f\]\{64\}\$/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /sudo \/usr\/local\/sbin\/downtimeos-deploy/);
  assert.doesNotMatch(workflow, /password|DO_DEPLOY_PASSWORD/i);
});

test('comando remoto valida commit/digest, label OCI, health y rollback', async () => {
  const script = await leer('../deploy/digitalocean/downtimeos-deploy');
  assert.match(script, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(script, /\^sha256:\[0-9a-f\]\{64\}\$/);
  assert.match(script, /org\.opencontainers\.image\.revision/);
  assert.match(script, /flock -n/);
  assert.match(script, /healthy/);
  assert.match(script, /previous release restored/);
});
