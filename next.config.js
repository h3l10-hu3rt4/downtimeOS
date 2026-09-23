/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  // PDFKit importa sus fuentes estándar mediante un subpath privado. Next no
  // siempre las detecta al trazar el servidor standalone, así que se incluyen
  // explícitamente para que Helvetica/Courier también existan en Docker.
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
