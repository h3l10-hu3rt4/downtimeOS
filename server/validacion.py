# -*- coding: utf-8 -*-
"""
Reglas de validacion de la Capa 2 (PRD, RF-03).

  * Campos obligatorios segun el origen del lead.
  * Correo con formato valido y regla B2B: se rechazan dominios genericos
    (@gmail.com, @hotmail.com, @outlook.com, @yahoo, etc.) cuando la regla
    esta activa.
  * Telefono/WhatsApp de 10 digitos (MX) tolerando espacios, guiones y +52.
  * Saneamiento: se recortan cadenas y se limita su longitud para que nada
    raro llegue al archivo JSON.
"""
import re

RE_EMAIL = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

# Regla B2B (RF-03): dominios publicos rechazados.
DOMINIOS_GENERICOS = {
    "gmail.com", "googlemail.com", "hotmail.com", "hotmail.es", "hotmail.mx",
    "outlook.com", "outlook.es", "live.com", "live.com.mx", "msn.com",
    "yahoo.com", "yahoo.com.mx", "yahoo.es", "icloud.com", "me.com",
    "aol.com", "protonmail.com", "proton.me", "gmx.com", "mail.com",
    "zoho.com", "yandex.com", "tutanota.com", "example.com",
}

REGLA_B2B_ACTIVA = True

LARGO_MAXIMO = 160
ESTATUS_VALIDOS = {"NUEVO", "AUDITORIA_SOLICITADA"}


class ErrorValidacion(Exception):
    """Agrupa los errores por campo para responder un 400 legible."""

    def __init__(self, errores):
        super().__init__("Datos invalidos")
        self.errores = errores


def limpiar_texto(valor, maximo=LARGO_MAXIMO):
    if valor is None:
        return ""
    texto = str(valor).replace("\x00", "").strip()
    texto = re.sub(r"\s+", " ", texto)
    return texto[:maximo]


def normalizar_telefono(valor):
    digitos = re.sub(r"\D", "", str(valor or ""))
    if digitos.startswith("52") and len(digitos) == 12:
        digitos = digitos[2:]
    if digitos.startswith("521") and len(digitos) == 13:
        digitos = digitos[3:]
    return digitos


def dominio_de(email):
    return email.split("@")[-1].lower() if "@" in email else ""


def validar_email(email, errores, campo="email"):
    email = limpiar_texto(email).lower()
    if not email:
        errores[campo] = "El correo corporativo es obligatorio."
        return email
    if not RE_EMAIL.match(email):
        errores[campo] = "El formato del correo no es válido."
        return email
    if REGLA_B2B_ACTIVA and dominio_de(email) in DOMINIOS_GENERICOS:
        errores[campo] = (
            "Usa un correo corporativo. Los dominios públicos "
            "(@gmail.com, @hotmail.com, @outlook.com...) no son aceptados."
        )
    return email


def validar_lead(payload, origen):
    """Valida y normaliza el payload del formulario.

    `origen` es "CALCULADORA" (lead magnet / reporte PDF) o "AUDITORIA"
    (formulario de cierre de 30 dias). Lanza ErrorValidacion si algo falla.
    """
    if not isinstance(payload, dict):
        raise ErrorValidacion({"_": "El cuerpo debe ser un objeto JSON."})

    errores = {}
    limpio = {}

    limpio["nombre"] = limpiar_texto(payload.get("nombre"))
    if len(limpio["nombre"]) < 3:
        errores["nombre"] = "Escribe tu nombre completo (mínimo 3 caracteres)."

    limpio["empresa"] = limpiar_texto(payload.get("empresa"))
    if len(limpio["empresa"]) < 2:
        errores["empresa"] = "El nombre de la empresa es obligatorio."

    limpio["email"] = validar_email(payload.get("email"), errores)

    telefono = normalizar_telefono(payload.get("telefono"))
    if not telefono:
        errores["telefono"] = "El teléfono / WhatsApp es obligatorio."
    elif len(telefono) != 10:
        errores["telefono"] = "El teléfono debe tener 10 dígitos."
    limpio["telefono"] = telefono

    limpio["puesto"] = limpiar_texto(payload.get("puesto")) or "No especificado"
    limpio["ciudad"] = limpiar_texto(payload.get("ciudad"))
    limpio["parque_industrial"] = limpiar_texto(payload.get("parque_industrial"))
    limpio["sector"] = limpiar_texto(payload.get("sector"))
    limpio["notas"] = limpiar_texto(payload.get("notas"), 500)

    # El formulario de cierre exige ciudad / parque industrial.
    if origen == "AUDITORIA" and not limpio["ciudad"]:
        errores["ciudad"] = "Indica la ciudad o parque industrial de la planta."

    # --- Parametros de la calculadora -------------------------------------
    def numero(clave, defecto):
        crudo = payload.get(clave, defecto)
        try:
            return float(str(crudo).replace(",", "").replace("$", "").strip())
        except (TypeError, ValueError):
            errores[clave] = "Debe ser un valor numérico."
            return float(defecto)

    limpio["maquinas"] = numero("maquinas", 5)
    limpio["turnos"] = numero("turnos", 2)
    limpio["tarifa_hora"] = numero("tarifa_hora", 1200)
    limpio["minutos_paro_dia"] = numero("minutos_paro_dia", 25)
    limpio["divisa"] = "USD" if str(payload.get("divisa", "MXN")).upper() == "USD" else "MXN"

    utm = payload.get("utm") if isinstance(payload.get("utm"), dict) else {}
    limpio["utm"] = {
        "utm_source": limpiar_texto(utm.get("utm_source")) or "directo",
        "utm_medium": limpiar_texto(utm.get("utm_medium")) or "landing",
        "utm_campaign": limpiar_texto(utm.get("utm_campaign")) or "margen-oculto-2026",
    }

    if errores:
        raise ErrorValidacion(errores)
    return limpio
