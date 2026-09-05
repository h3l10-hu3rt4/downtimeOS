# -*- coding: utf-8 -*-
"""
Capa 3 - Persistencia local en `data/leads.json`.

Garantias de esta capa:
  * Escritura ATOMICA: se escribe a un archivo temporal en el mismo directorio,
    se hace flush + fsync y se reemplaza con os.replace() (operacion atomica en
    Windows y POSIX). Un corte de energia nunca deja un JSON truncado.
  * Consistencia bajo concurrencia: todas las operaciones de lectura/escritura
    pasan por un threading.RLock, y el servidor es multihilo.
  * Auto-seeding: si el archivo no existe, esta vacio o esta corrupto, se
    regenera con los 30 registros de `seed_data` (el corrupto se respalda).
"""
import json
import os
import shutil
import tempfile
import threading
from datetime import datetime, timezone

try:
    from . import seed_data  # type: ignore
except ImportError:
    import seed_data

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_DATOS = os.path.join(RAIZ, "data")
RUTA_LEADS = os.path.join(DIR_DATOS, "leads.json")

_LOCK = threading.RLock()


def _ahora_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _envoltura(leads):
    return {
        "meta": {
            "proyecto": "DowntimeOS - Landing & Lead Magnet",
            "version_esquema": "1.0",
            "actualizado": _ahora_iso(),
            "total": len(leads),
        },
        "leads": leads,
    }


def _escribir_atomico(payload):
    """Escribe el JSON completo de forma atomica."""
    os.makedirs(DIR_DATOS, exist_ok=True)
    fd, temporal = tempfile.mkstemp(prefix=".leads-", suffix=".tmp", dir=DIR_DATOS)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporal, RUTA_LEADS)  # atomico
    except Exception:
        if os.path.exists(temporal):
            os.unlink(temporal)
        raise


def sembrar(forzar=False):
    """Crea `data/leads.json` con los 30 registros semilla."""
    with _LOCK:
        if os.path.exists(RUTA_LEADS) and not forzar:
            return leer_todo()
        payload = _envoltura(seed_data.construir_semilla())
        _escribir_atomico(payload)
        return payload


def _respaldar_corrupto():
    marca = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    destino = os.path.join(DIR_DATOS, "leads.corrupto-{0}.json".format(marca))
    try:
        shutil.copy2(RUTA_LEADS, destino)
    except OSError:
        pass
    return destino


def leer_todo():
    """Lee el archivo completo; si falta o esta corrupto lo regenera."""
    with _LOCK:
        if not os.path.exists(RUTA_LEADS) or os.path.getsize(RUTA_LEADS) == 0:
            return sembrar(forzar=True)
        try:
            with open(RUTA_LEADS, "r", encoding="utf-8") as fh:
                datos = json.load(fh)
        except (json.JSONDecodeError, UnicodeDecodeError):
            _respaldar_corrupto()
            return sembrar(forzar=True)

        if not isinstance(datos, dict) or not isinstance(datos.get("leads"), list):
            _respaldar_corrupto()
            return sembrar(forzar=True)
        return datos


def listar(estatus=None, limite=None):
    datos = leer_todo()
    leads = datos["leads"]
    if estatus:
        objetivo = estatus.upper()
        leads = [l for l in leads if str(l.get("estatus", "")).upper() == objetivo]
    leads = sorted(leads, key=lambda l: l.get("created_at", ""), reverse=True)
    if limite:
        leads = leads[:int(limite)]
    return {"meta": datos["meta"], "total_filtrado": len(leads), "leads": leads}


def _siguiente_id(leads):
    maximo = 0
    for lead in leads:
        partes = str(lead.get("id", "")).split("-")
        if len(partes) == 3 and partes[-1].isdigit():
            maximo = max(maximo, int(partes[-1]))
    anio = datetime.now(timezone.utc).year
    return "LEAD-{0}-{1:04d}".format(anio, maximo + 1)


def agregar_lead(registro):
    """Inserta un lead nuevo (read-modify-write bajo lock) y lo persiste."""
    with _LOCK:
        datos = leer_todo()
        leads = datos["leads"]
        registro["id"] = _siguiente_id(leads)
        registro["created_at"] = _ahora_iso()
        leads.append(registro)
        _escribir_atomico(_envoltura(leads))
        return registro


def estadisticas():
    datos = leer_todo()
    leads = datos["leads"]
    if not leads:
        return {"total": 0}
    perdidas = [float(l.get("perdida_anual_mxn") or 0) for l in leads]
    por_estatus = {}
    for lead in leads:
        clave = lead.get("estatus", "SIN_ESTATUS")
        por_estatus[clave] = por_estatus.get(clave, 0) + 1
    return {
        "total": len(leads),
        "por_estatus": por_estatus,
        "perdida_anual_agregada_mxn": round(sum(perdidas), 2),
        "perdida_anual_promedio_mxn": round(sum(perdidas) / len(perdidas), 2),
        "maquinas_totales": sum(int(l.get("maquinas") or 0) for l in leads),
    }
