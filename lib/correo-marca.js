function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (caracter) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[caracter]);
}

function urlSegura(valor) {
  const url = new URL(valor);
  if (url.protocol !== 'https:') throw new TypeError('Los enlaces de correo deben usar HTTPS.');
  return escaparHtml(url.toString());
}

/** HTML de tabla con estilos inline para compatibilidad con clientes de correo. */
export function renderCorreoDowntimeOS({
  appUrl,
  preheader,
  categoria,
  titulo,
  contenidoHtml,
  botonTexto,
  botonUrl,
  pie = 'Mensaje automático de DowntimeOS. No respondas a este correo.',
}) {
  const urlApp = urlSegura(appUrl);
  const urlLogo = `${urlApp.replace(/\/$/, '')}/images/downtimeos-symbol.png`;
  const cta = botonTexto && botonUrl
    ? `<tr><td style="padding:0 32px 28px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#FFB627" style="border-radius:8px"><a href="${urlSegura(botonUrl)}" style="display:inline-block;padding:14px 20px;color:#06080B;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;line-height:20px;text-decoration:none">${escaparHtml(botonTexto)}</a></td></tr></table></td></tr>`
    : '';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escaparHtml(titulo)}</title></head>
<body style="margin:0;padding:0;background-color:#06080B;color:#E7EDF5;font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escaparHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#06080B" style="width:100%;background-color:#06080B">
    <tr><td align="center" style="padding:32px 12px">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px">
        <tr><td style="padding:0 4px 18px">
          <a href="${urlApp}" style="color:#F4F7FB;text-decoration:none;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;letter-spacing:-0.3px;line-height:36px">
            <img src="${urlLogo}" width="36" height="36" alt="" style="display:inline-block;width:36px;height:36px;margin-right:9px;border:0;vertical-align:middle">
            <span style="vertical-align:middle">Downtime<span style="color:#FFB627">OS</span></span>
          </a>
        </td></tr>
        <tr><td bgcolor="#10151D" style="background-color:#10151D;border:1px solid #293543;border-radius:14px;overflow:hidden">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr><td style="padding:32px 32px 12px;color:#FFB627;font-size:11px;font-weight:bold;letter-spacing:2px;line-height:16px;text-transform:uppercase">${escaparHtml(categoria)}</td></tr>
            <tr><td style="padding:0 32px 14px;color:#F4F7FB;font-size:27px;font-weight:bold;line-height:34px">${escaparHtml(titulo)}</td></tr>
            <tr><td style="padding:0 32px 26px;color:#B7C2D1;font-size:16px;line-height:25px">${contenidoHtml}</td></tr>
            ${cta}
          </table>
        </td></tr>
        <tr><td style="padding:18px 6px 0;color:#8996A8;font-size:12px;line-height:19px">${escaparHtml(pie)}<br><a href="${urlApp}" style="color:#AAB7C7;text-decoration:underline">DowntimeOS</a> · Continuidad operativa industrial</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function escaparTextoHtml(valor) {
  return escaparHtml(valor);
}
