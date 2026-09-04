"""
DowntimeOS - Motor de calculo de Margen Oculto.
Fuente de verdad de la formula (PRD Landing v1.0.0, seccion 3).

    Minutos_Paro_Dia  = Maquinas x Turnos x Minutos_Paro_Turno
    Perdida_Diaria    = (Minutos_Paro_Dia / 60) x Tarifa_Horaria
    Perdida_Mensual   = Perdida_Diaria x 25 dias operativos
    Perdida_Anual     = Perdida_Mensual x 12 meses  (= 300 dias habiles)
    Ahorro_Proyectado = Perdida_Anual x 0.35   (reduccion estimada de MTTR)

NOTA DE IMPLEMENTACION:
El PRD enuncia el horizonte anual como "300 dias habiles"; aqui se conserva en
dos escalones (25 dias x 12 meses = 300) porque el esquema de Postgres valida
la invariante perdida_anual = perdida_mensual x 12.

Los minutos de paro se declaran POR TURNO Y POR MAQUINA: el multiplicador de
turnos entro con el PRD de la landing v1.0.0.
"""

# --- Constantes del modelo -------------------------------------------------
DIAS_OPERATIVOS = 25      # dias productivos por mes
MESES_ANIO = 12
FACTOR_MITIGACION = 0.35   # 35% de reduccion de MTTR con DowntimeOS
FACTOR_CONSERVADOR = 0.15  # escenario conservador del callout de la landing
DIAS_HABILES_ANIO = 300    # 25 x 12: el horizonte tal como lo enuncia el PRD
TIPO_CAMBIO_USD = 17.50   # MXN por 1 USD

# --- Limites de los inputs (PRD seccion 4.2) -------------------------------
LIMITES = {
    "maquinas":         {"min": 1,   "max": 100,    "default": 5},
    "turnos":           {"min": 1,   "max": 3,      "default": 2},
    "tarifa_hora":      {"min": 100, "max": 200000, "default": 1200},  # referencia MXN
    "minutos_paro_dia": {"min": 5,   "max": 120,    "default": 25},
}

# La tarifa se acota SEGUN LA DIVISA: aplicar un piso pensado en pesos a una
# tarifa en dolares la deformaria (espejo de public/js/calculator.js).
LIMITES_TARIFA = {
    "MXN": {"min": 100, "max": 200000},
    "USD": {"min": 5,   "max": 12000},
}

HORAS_POR_TURNO = 8


def _acotar(valor, minimo, maximo):
    return max(minimo, min(maximo, valor))


def limites_tarifa(divisa):
    return LIMITES_TARIFA["USD" if str(divisa).upper() == "USD" else "MXN"]


def calcular(maquinas, turnos, tarifa_hora, minutos_paro_dia, divisa="MXN"):
    """Devuelve el bloque financiero completo en la divisa recibida.

    `tarifa_hora` se interpreta SIEMPRE en la divisa indicada; los resultados
    se entregan en esa misma divisa mas su equivalente en MXN para que la
    persistencia sea comparable entre leads.
    """
    divisa = "USD" if str(divisa).upper() == "USD" else "MXN"
    lt = limites_tarifa(divisa)

    maquinas = int(_acotar(int(maquinas), LIMITES["maquinas"]["min"], LIMITES["maquinas"]["max"]))
    turnos = int(_acotar(int(turnos), LIMITES["turnos"]["min"], LIMITES["turnos"]["max"]))
    tarifa_hora = float(_acotar(float(tarifa_hora), lt["min"], lt["max"]))
    minutos_paro_dia = float(_acotar(
        float(minutos_paro_dia),
        LIMITES["minutos_paro_dia"]["min"],
        LIMITES["minutos_paro_dia"]["max"],
    ))

    minutos_flota_dia = maquinas * turnos * minutos_paro_dia
    perdida_diaria = (minutos_flota_dia / 60.0) * tarifa_hora
    perdida_mensual = perdida_diaria * DIAS_OPERATIVOS
    perdida_anual = perdida_mensual * MESES_ANIO
    ahorro_proyectado = perdida_anual * FACTOR_MITIGACION

    factor_mxn = TIPO_CAMBIO_USD if divisa == "USD" else 1.0

    return {
        "maquinas": maquinas,
        "turnos": turnos,
        "horas_operacion_dia": turnos * HORAS_POR_TURNO,
        "tarifa_hora": round(tarifa_hora, 2),
        "minutos_paro_dia": round(minutos_paro_dia, 2),
        "divisa": divisa,
        "perdida_diaria": round(perdida_diaria, 2),
        "perdida_mensual": round(perdida_mensual, 2),
        "perdida_anual": round(perdida_anual, 2),
        "ahorro_proyectado": round(ahorro_proyectado, 2),
        "recuperable_conservador": round(perdida_anual * FACTOR_CONSERVADOR, 2),
        "minutos_paro_flota_dia": round(minutos_flota_dia, 2),
        "perdida_anual_mxn": round(perdida_anual * factor_mxn, 2),
        "costo_por_minuto": round((tarifa_hora * maquinas) / 60.0, 4),
        "parametros_modelo": {
            "dias_operativos": DIAS_OPERATIVOS,
            "meses": MESES_ANIO,
            "factor_mitigacion": FACTOR_MITIGACION,
            "factor_conservador": FACTOR_CONSERVADOR,
            "dias_habiles_anio": DIAS_HABILES_ANIO,
            "tipo_cambio_usd": TIPO_CAMBIO_USD,
        },
    }
