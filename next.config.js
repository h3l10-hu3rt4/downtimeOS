import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Evita que un package-lock fuera del repo cambie la raíz del build y deje
  // server.js dentro de una carpeta anidada al desplegar en Docker.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  poweredByHeader: false,
  outputFileTracingIncludes: {
    '/*': ['./node_modules/pdfkit/**/*'],
  },
  async headers() {
    return [{
      source: '/api/:path*',
      headers: [{ key: 'Cache-Control', value: 'no-store' }],
    }];
  },
  async redirects() {
    return [{
      source: '/dashboard/apiGastos/index.html',
      destination: '/dashboard/apiGastos',
      permanent: false,
    }];
  },
};

export default nextConfig;
