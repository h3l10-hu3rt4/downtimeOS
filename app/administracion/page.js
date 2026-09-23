import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { administradorConfigurado, sesionAdministradorValida } from '../../lib/administracion.js';
import { LegacyPage } from '../_components/LegacyPage';

export default async function Administracion() {
  if (!administradorConfigurado()) redirect('/administracion/acceso');
  const cookie = (await cookies()).toString();
  if (!sesionAdministradorValida(cookie)) redirect('/administracion/acceso');
  return <LegacyPage file="dashboard/apiGastos/index.html" />;
}
