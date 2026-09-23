import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { administradorConfigurado, sesionAdministradorValida } from '../../../lib/administracion.js';
import { LegacyPage } from '../../../app/_components/LegacyPage';

export default async function Dashboard() {
  if (!administradorConfigurado()) redirect('/administracion/acceso');
  if (!sesionAdministradorValida((await cookies()).toString())) redirect('/administracion/acceso');
  return <LegacyPage file="dashboard/apiGastos/index.html" />;
}
