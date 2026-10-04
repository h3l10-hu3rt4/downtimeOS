import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { administradorConfigurado, sesionAdministradorValida } from '../../lib/administracion.js';
import { LegacyPage } from '../_components/LegacyPage';

export const dynamic = 'force-dynamic';

export default async function Administracion() {
  if (!administradorConfigurado()) redirect('/administracion/acceso');
  if (!sesionAdministradorValida(await cookies())) redirect('/administracion/acceso');
  return <><nav className="admin-shortcuts"><a className="btn btn--secondary" href="/administracion/suscripciones">Solicitudes de suscripción y pagos</a></nav><LegacyPage file="dashboard/apiGastos/index.html" /></>;
}
