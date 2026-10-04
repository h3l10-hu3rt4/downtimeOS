import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { administradorConfigurado, sesionAdministradorValida } from '../../../lib/administracion.js';
import PanelSuscripciones from './panel.js';

export const dynamic = 'force-dynamic';

export default async function SuscripcionesAdmin() {
  const cookieStore = await cookies();
  const configurado = administradorConfigurado();
  const valida = sesionAdministradorValida(cookieStore);
  if (!configurado || !valida) redirect('/administracion/acceso');
  return <PanelSuscripciones />;
}
