import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fuente = await readFile(new URL('../lib/cuenta.js', import.meta.url), 'utf8');

test('registro e inicio usan un cliente público aislado del cliente servidor privilegiado', () => {
  assert.match(fuente, /function crearClienteAuthPublico\(\)[\s\S]*?createClient\(url, clavePublica/);
  assert.match(fuente, /export async function registrarEmpresa\(datos\)[\s\S]*?let authPublico;[\s\S]*?authPublico = crearClienteAuthPublico\(\);[\s\S]*?authPublico\.auth\.signUp/);
  assert.match(fuente, /export async function iniciarSesion\(\{ email, password \}\)[\s\S]*?const authPublico = crearClienteAuthPublico\(\);[\s\S]*?authPublico\.auth\.signInWithPassword/);
  assert.doesNotMatch(fuente, /supabase\.auth\.signInWithPassword/);
});

test('la renovación de sesión usa el cliente Auth público, nunca el singleton service-role', () => {
  assert.match(fuente, /export async function renovarSesion\(refreshToken[\s\S]*?const authPublico = crearClienteAuthPublico\(\);[\s\S]*?authPublico\.auth\.refreshSession\(\{ refresh_token: token \}\)/);
  assert.doesNotMatch(fuente, /supabase\.auth\.refreshSession/);
});

test('resolverPerfil fija la FK compuesta de planta para evitar relaciones PostgREST ambiguas', () => {
  assert.match(fuente, /plantas!planta_membresias_planta_tenant_fkey\(nombre,codigo\)/);
  assert.match(fuente, /organizaciones!planta_membresias_organizacion_id_fkey\(nombre,propietario_id\)/);
});
