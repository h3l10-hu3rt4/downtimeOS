# Despliegue en un droplet de DigitalOcean

El contenedor no requiere Vercel. El proceso de Next escucha internamente en
el puerto 3000; Nginx o el proxy TLS del droplet debe publicar HTTPS y reenviar
los webhooks de Meta a `/api/whatsapp/alerta`.

## Primera instalación

```bash
git clone <repositorio> downtimeos
cd downtimeos
cp .env.example .env
chmod 600 .env
# editar .env con las credenciales reales
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml ps
```

La comprobación local del contenedor es:

```bash
curl -f http://127.0.0.1:3000/api/config
```

La URL que se registra en Meta debe ser la pública y HTTPS del droplet:

```text
https://TU_DOMINIO/api/whatsapp/alerta
```

Después de una actualización:

```bash
git pull
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml ps
```

Nunca se debe copiar `.env.local` al droplet ni incluir secretos en la imagen.
