# -*- coding: utf-8 -*-
"""
Semilla obligatoria de la Capa 3 (PRD, Capa 3: Persistencia).

30 registros sinteticos de plantas manufactureras verosimiles de Mexico/LATAM,
con roles del ICP (CFO, Gerente de Planta, Director de Operaciones, Jefe de
Mantenimiento) y valores dentro de los rangos exigidos:
  maquinas 3-45 | turnos 1-3 | tarifa 800-4,500 MXN/hr | paro 5-120 min/dia

Las cifras financieras NO estan escritas a mano: se derivan con el mismo motor
`calculo.calcular` que usa el endpoint POST /api/leads, de modo que la semilla
y los leads nuevos son matematicamente consistentes.
"""
from datetime import datetime, timedelta, timezone

try:
    from . import calculo  # type: ignore
except ImportError:  # ejecucion como script suelto
    import calculo

# nombre, puesto, empresa, sector, dominio, ciudad, parque industrial,
# maquinas, turnos, tarifa MXN/hr, minutos paro/dia, origen, dias de antiguedad
ROSTER = [
    ("Mariana Villarreal Cepeda", "CFO", "Inyeccion Lagunera del Norte", "Inyeccion de plastico",
     "inyeccionlagunera.mx", "Torreon, Coahuila", "Parque Industrial Lagunero", 18, 3, 2450, 42, "AUDITORIA", 2),
    ("Rodrigo Alanis Trevino", "Gerente de Planta", "Maquinados CNC Trevino", "Mecanizado CNC",
     "cnctrevino.com.mx", "Gomez Palacio, Durango", "Parque Industrial Gomez Palacio", 12, 2, 1850, 28, "CALCULADORA", 3),
    ("Ana Sofia Quintero Ramos", "Director de Operaciones", "Estampados Automotrices Saltillo", "Estampado automotriz Tier 2",
     "estampadossaltillo.com", "Ramos Arizpe, Coahuila", "Parque Industrial Derramadero", 34, 3, 3900, 55, "AUDITORIA", 5),
    ("Jose Luis Mendoza Farias", "Jefe de Mantenimiento", "Fundiciones Bajio Precision", "Fundicion de aluminio",
     "fundicionesbajio.mx", "Celaya, Guanajuato", "Parque Industrial Celaya", 9, 2, 2100, 65, "CALCULADORA", 6),
    ("Claudia Ibarra Nunez", "CFO", "Empaques Flexibles del Golfo", "Empaque flexible",
     "empaquesgolfo.com.mx", "Altamira, Tamaulipas", "Puerto Industrial Altamira", 22, 3, 1650, 33, "AUDITORIA", 8),
    ("Hector Salinas Ordonez", "Gerente de Planta", "Termoplasticos de Occidente", "Inyeccion de plastico",
     "termoplasticosoccidente.mx", "El Salto, Jalisco", "Parque Industrial El Salto", 15, 2, 1450, 24, "CALCULADORA", 9),
    ("Diana Berenice Lozano", "Director de Operaciones", "Agroindustrias La Comarca", "Agroindustria / lacteos",
     "agrolacomarca.mx", "Lerdo, Durango", "Corredor Agroindustrial Lerdo", 27, 3, 1200, 48, "AUDITORIA", 11),
    ("Fernando Cardenas Rios", "Jefe de Mantenimiento", "Troqueles y Herramentales MTY", "Troquelado y herramental",
     "troquelesmty.com", "Apodaca, Nuevo Leon", "Parque Industrial Apodaca", 7, 1, 1750, 90, "CALCULADORA", 12),
    ("Paola Estrada Guerrero", "CFO", "Autopartes Selladas Bajio", "Autopartes Tier 2",
     "autopartesselladas.mx", "Silao, Guanajuato", "Puerto Interior Guanajuato", 41, 3, 4200, 38, "AUDITORIA", 14),
    ("Ricardo Beltran Ochoa", "Gerente de Planta", "Perfiles de Aluminio Sonora", "Extrusion de aluminio",
     "perfilessonora.com.mx", "Hermosillo, Sonora", "Parque Industrial Dinamico", 16, 2, 2650, 31, "CALCULADORA", 15),
    ("Monica Renteria Sada", "Director de Operaciones", "Cableados Industriales Juarez", "Arneses automotrices",
     "cableadosjuarez.com", "Ciudad Juarez, Chihuahua", "Parque Industrial Bermudez", 45, 3, 3100, 26, "AUDITORIA", 17),
    ("Gustavo Pineda Marroquin", "Jefe de Mantenimiento", "Vidrios Templados del Centro", "Vidrio templado",
     "vidriosdelcentro.mx", "Toluca, Estado de Mexico", "Parque Industrial Toluca 2000", 11, 2, 1950, 72, "CALCULADORA", 19),
    ("Alejandra Fuentes Camarena", "CFO", "Alimentos Procesados del Pacifico", "Agroindustria / conservas",
     "alimentospacifico.mx", "Culiacan, Sinaloa", "Parque Industrial Canacintra", 24, 3, 980, 44, "AUDITORIA", 21),
    ("Emilio Zamudio Herrera", "Gerente de Planta", "Rectificados Industriales Puebla", "Mecanizado CNC",
     "rectificadospuebla.com.mx", "Cuautlancingo, Puebla", "Parque Industrial FINSA Puebla", 8, 2, 2300, 36, "CALCULADORA", 23),
    ("Ximena Ordaz Villalobos", "Director de Operaciones", "Corrugados del Sureste", "Empaque de carton",
     "corrugadossureste.mx", "Merida, Yucatan", "Parque Industrial Yucatan", 19, 3, 1350, 29, "AUDITORIA", 25),
    ("Arturo Cisneros Bermudez", "Jefe de Mantenimiento", "Forjas Pesadas del Norte", "Forja en caliente",
     "forjasdelnorte.com", "Monclova, Coahuila", "Parque Industrial Monclova", 6, 2, 3450, 105, "CALCULADORA", 27),
    ("Regina Solis Aguirre", "CFO", "Textiles Tecnicos Aguascalientes", "Textil tecnico",
     "textilesags.mx", "Aguascalientes, Aguascalientes", "Parque Industrial San Francisco", 30, 3, 890, 40, "AUDITORIA", 29),
    ("Sebastian Arriaga Peralta", "Gerente de Planta", "Plasticos Reforzados Queretaro", "Composites / fibra de vidrio",
     "plasticosqro.com.mx", "El Marques, Queretaro", "Parque Industrial Bernardo Quintana", 13, 2, 2050, 34, "CALCULADORA", 31),
    ("Lucia Mercado Ontiveros", "Director de Operaciones", "Ensambles Electromecanicos Tijuana", "Ensamble electromecanico",
     "ensamblestijuana.com", "Tijuana, Baja California", "Parque Industrial El Florido", 38, 3, 2800, 22, "AUDITORIA", 33),
    ("Omar Villegas Escobedo", "Jefe de Mantenimiento", "Galvanizados del Istmo", "Galvanizado en caliente",
     "galvanizadosistmo.mx", "Coatzacoalcos, Veracruz", "Corredor Industrial Coatzacoalcos", 5, 1, 1550, 118, "CALCULADORA", 35),
    ("Valeria Nogueira Santos", "CFO", "Componentes Plasticos do Sul", "Inyeccion de plastico (LATAM)",
     "componentesdosul.com.br", "Sao Jose dos Pinhais, Parana", "Distrito Industrial Afonso Pena", 26, 3, 1750, 37, "AUDITORIA", 37),
    ("Andres Felipe Ocampo", "Gerente de Planta", "Metalmecanica Andina S.A.S.", "Metalmecanica",
     "metalmecanicaandina.co", "Itagui, Antioquia", "Zona Industrial Itagui", 17, 2, 1150, 46, "CALCULADORA", 39),
    ("Ignacio Peralta Videla", "Director de Operaciones", "Envases Rioplatenses", "Envase rigido",
     "envasesrioplatenses.com.ar", "Pilar, Buenos Aires", "Parque Industrial Pilar", 21, 2, 1050, 52, "AUDITORIA", 41),
    ("Karla Jimenez Bustamante", "Jefe de Mantenimiento", "Refacciones Diesel del Bajio", "Remanufactura diesel",
     "refaccionesdiesel.mx", "Irapuato, Guanajuato", "Parque Industrial Castro del Rio", 10, 2, 1900, 61, "CALCULADORA", 43),
    ("Marco Antonio Delgadillo", "CFO", "Herrajes y Estampados Leon", "Estampado metalico",
     "herrajesleon.com.mx", "Leon, Guanajuato", "Ciudad Industrial Leon", 29, 3, 1600, 27, "AUDITORIA", 45),
    ("Sandra Elizondo Cavazos", "Gerente de Planta", "Cementos y Prefabricados Laguna", "Prefabricados de concreto",
     "prefabricadoslaguna.mx", "Torreon, Coahuila", "Parque Industrial Oriente", 14, 2, 2200, 58, "CALCULADORA", 47),
    ("Julio Cesar Robledo Paz", "Director de Operaciones", "Inyectados Medicos Tijuana", "Dispositivo medico",
     "inyectadosmedicos.com", "Tijuana, Baja California", "Otay Industrial Park", 33, 3, 4450, 18, "AUDITORIA", 49),
    ("Brenda Carrillo Anzures", "Jefe de Mantenimiento", "Molinos Harineros del Norte", "Agroindustria / molienda",
     "molinosdelnorte.mx", "Chihuahua, Chihuahua", "Complejo Industrial Chihuahua", 4, 3, 1250, 84, "CALCULADORA", 51),
    ("Enrique Tapia Valadez", "CFO", "Soldaduras Estructurales Tampico", "Estructura metalica",
     "soldadurastampico.com.mx", "Tampico, Tamaulipas", "Parque Industrial Tampico", 20, 2, 2750, 39, "AUDITORIA", 54),
    ("Natalia Bracamontes Ruiz", "Gerente de Planta", "Empaques Aereos del Centro", "Empaque automotriz",
     "empaquesaereos.mx", "San Luis Potosi, S.L.P.", "Zona Industrial WTC SLP", 3, 1, 830, 96, "CALCULADORA", 58),
]

FUENTES = [
    "organico", "linkedin-ads", "google-ads", "referido-cluster",
    "webinar-industria", "email-outbound",
]

LADAS = ["871", "818", "477", "656", "662", "444", "222", "999", "614", "667"]


def _slug_correo(nombre, dominio):
    partes = nombre.lower().split()
    return "{0}.{1}@{2}".format(partes[0], partes[-1], dominio)


def _telefono(indice):
    lada = LADAS[indice % len(LADAS)]
    return "{0}{1:07d}".format(lada, (1200340 + indice * 7351) % 10000000)


def construir_semilla(ahora=None):
    """Genera la lista de 30 leads sinteticos ya calculados."""
    ahora = ahora or datetime.now(timezone.utc)
    leads = []
    for i, fila in enumerate(ROSTER):
        (nombre, puesto, empresa, sector, dominio, ciudad, parque,
         maquinas, turnos, tarifa, minutos, origen, antiguedad) = fila

        f = calculo.calcular(maquinas, turnos, tarifa, minutos, "MXN")
        creado = ahora - timedelta(days=antiguedad, hours=(i * 7) % 22, minutes=(i * 13) % 60)

        leads.append({
            "id": "LEAD-2026-{0:04d}".format(i + 1),
            "nombre": nombre,
            "puesto": puesto,
            "empresa": empresa,
            "sector": sector,
            "email": _slug_correo(nombre, dominio),
            "telefono": _telefono(i),
            "ciudad": ciudad,
            "parque_industrial": parque,
            "maquinas": f["maquinas"],
            "turnos": f["turnos"],
            "horas_operacion_dia": f["horas_operacion_dia"],
            "tarifa_hora": f["tarifa_hora"],
            "minutos_paro_dia": f["minutos_paro_dia"],
            "divisa": "MXN",
            "perdida_diaria": f["perdida_diaria"],
            "perdida_mensual": f["perdida_mensual"],
            "perdida_anual": f["perdida_anual"],
            "ahorro_proyectado": f["ahorro_proyectado"],
            "perdida_anual_mxn": f["perdida_anual_mxn"],
            "costo_por_minuto": f["costo_por_minuto"],
            "origen": origen,
            "estatus": "AUDITORIA_SOLICITADA" if origen == "AUDITORIA" else "NUEVO",
            "utm": {
                "utm_source": FUENTES[i % len(FUENTES)],
                "utm_medium": "landing",
                "utm_campaign": "margen-oculto-2026",
            },
            "notas": "Registro semilla generado para depuracion local.",
            "created_at": creado.isoformat(timespec="seconds").replace("+00:00", "Z"),
        })
    return leads
