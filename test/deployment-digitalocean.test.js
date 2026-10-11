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

test('imagen de producción excluye dotenv y ejecuta con archivos legibles no modificables por la app', async () => {
  const dockerignore = await leer('../.dockerignore');
  const dockerfile = await leer('../Dockerfile');
  const compose = await leer('../docker-compose.production.yml');
  assert.match(dockerignore, /^\.env\*$/m);
  assert.match(dockerignore, /^\.git$/m);
  assert.match(dockerfile, /^USER nextjs$/m);
  assert.doesNotMatch(dockerfile, /chown\s+-R/);
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /\.next\/cache:size=32m,uid=1001,gid=1001/);
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
  assert.match(workflow, /packages:\s*read/);
  assert.match(workflow, /secrets\.GITHUB_TOKEN/);
  assert.match(workflow, /printf '%s\\n' "\$GHCR_TOKEN" \| ssh/);
  assert.match(workflow, /sudo(?: -n)? \/usr\/local\/sbin\/downtimeos-deploy/);
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
  assert.match(script, /read -r registry_token/);
  assert.match(script, /docker login ghcr\.io .*--password-stdin/);
  assert.match(script, /docker logout ghcr\.io/);
  assert.match(script, /\/run\/downtimeos-docker\.\*/);
});

test('Nginx no publica la app por HTTP antes de emitir TLS', async () => {
  const config = await leer('../deploy/digitalocean/nginx-acme.conf');
  assert.match(config, /listen 80 default_server/);
  assert.match(config, /location \^~ \/\.well-known\/acme-challenge\//);
  assert.match(config, /return 444/);
  assert.doesNotMatch(config, /proxy_pass|listen 443|ssl_certificate/);
});

test('Nginx HTTPS termina TLS y solo proxya hacia localhost', async () => {
  const config = await leer('../deploy/digitalocean/nginx-app-https.conf');
  assert.match(config, /server_name app\.downtimeos\.tech/);
  assert.match(config, /listen 443 ssl http2/);
  assert.match(config, /ssl_protocols TLSv1\.2 TLSv1\.3/);
  assert.match(config, /return 301 https:\/\/\$host\$request_uri/);
  assert.match(config, /proxy_pass http:\/\/127\.0\.0\.1:3000/);
  assert.match(config, /Strict-Transport-Security/);
  assert.match(config, /default_server/);
  assert.match(config, /return 444/);
  assert.deepEqual(
    [...config.matchAll(/proxy_pass\s+([^;]+);/g)].map((match) => match[1]),
    ['http://127.0.0.1:3000'],
  );
});
