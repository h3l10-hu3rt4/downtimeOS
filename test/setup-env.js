// La suite es unitaria: Supabase siempre apunta a loopback y usa llaves falsas.
// Así funciona igual en CI y en máquinas sin .env.local, sin tocar servicios reales.
process.env.SUPABASE_URL ??= 'http://127.0.0.1:9';
process.env.SUPABASE_SECRET_KEY ??= 'unit-test-only-not-a-secret';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'unit-test-only-not-a-secret';
process.env.SUPABASE_PUBLISHABLE_KEY ??= 'unit-test-only-public-key';
process.env.SUPABASE_ANON_KEY ??= 'unit-test-only-public-key';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:9';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'unit-test-only-public-key';
process.env.APP_ENV ??= 'development';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
