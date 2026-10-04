import test from 'node:test';
import assert from 'node:assert/strict';
import { urlMailpitLocal } from '../lib/mailpit-local.js';

test('deriva el Mailpit de los puertos Supabase Local históricos, QA y descartables', () => {
  assert.equal(urlMailpitLocal('http://localhost:54321'), 'http://localhost:54324');
  assert.equal(urlMailpitLocal('http://localhost:55421'), 'http://localhost:55424');
  assert.equal(urlMailpitLocal('http://127.0.0.1:56621/rest/v1'), 'http://127.0.0.1:56624');
});

test('normaliza host Docker para el navegador y no construye enlaces externos', () => {
  assert.equal(urlMailpitLocal('http://host.docker.internal:55421'), 'http://localhost:55424');
  assert.equal(urlMailpitLocal('https://project.supabase.co'), '');
  assert.equal(urlMailpitLocal('http://mail.example.com:54321'), '');
  assert.equal(urlMailpitLocal('http://localhost'), '');
  assert.equal(urlMailpitLocal('http://localhost:65533'), '');
  assert.equal(urlMailpitLocal('not a URL'), '');
});
