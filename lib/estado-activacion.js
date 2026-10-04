export function copyEstadoActivacion({ enlaceInvalido, flujoInvitacion, modoRegistro, estadoEnlace }) {
  if (!enlaceInvalido) return 'Define tu contraseña personal para acceder a la planta. No compartas este enlace con otras personas.';
  if (flujoInvitacion) return 'Esta invitación ya no se puede usar. Pide un enlace nuevo a la persona que te invitó.';
  if (estadoEnlace === 'incompleto') return 'Abre el enlace de confirmación o de invitación que recibiste por correo.';
  if (modoRegistro) return 'La confirmación del registro ya no se puede usar. Inicia sesión para continuar configurando tu planta.';
  return 'Este enlace ya no se puede usar. Si esperabas una invitación, pide que te la reenvíen; si ya tienes cuenta, inicia sesión.';
}
