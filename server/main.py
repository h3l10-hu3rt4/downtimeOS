# -*- coding: utf-8 -*-
"""
DowntimeOS - Capa 2: Middleware / API local.
=============================================

Servidor HTTP local SIN DEPENDENCIAS EXTERNAS (solo libreria estandar de
Python 3.8+). Sirve la Capa 1 (public/) y expone la API de negocio sobre la
Capa 3 (data/leads.json).

Arranque:
    python server/main.py                 -> http://localhost:3000
    python server/main.py --port 4000     -> otro puerto
    python server/main.py --no-browser    -> no abrir el navegador
    python server/main.py --reseed        -> regenerar los 30 leads semilla

Endpoints:
    GET  /api/health        Estado del servidor y de la persistencia.
    GET  /api/leads         Lista completa de leads (depuracion local).
                            Query: ?estatus=NUEVO|AUDITORIA_SOLICITADA&limite=N
    GET  /api/leads/stats   Agregados (total, por estatus, perdida agregada).
    POST /api/leads         Alta de lead: valida, calcula, asigna id + ISO
                            timestamp + estatus, y persiste en la Capa 3.
"""
import argparse
import json
import os
import sys
import threading
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(SERVER_DIR)
DIR_PUBLICO = os.path.join(RAIZ, "public")
sys.path.insert(0, SERVER_DIR)

import calculo          # noqa: E402
import store            # noqa: E402
import validacion       # noqa: E402

ARRANQUE = datetime.now(timezone.utc)
MAX_BODY = 64 * 1024  # 64 KB: mas que suficiente para un lead


class DowntimeHandler(SimpleHTTPRequestHandler):
    server_version = "DowntimeOS/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR_PUBLICO, **kwargs)

    # ------------------------------------------------------------------ util
    def log_message(self, formato, *args):
        sys.stdout.write("  [{0}] {1}\n".format(
            datetime.now().strftime("%H:%M:%S"), formato % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")

    def _json(self, codigo, payload):
        cuerpo = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(cuerpo)

    def end_headers(self):
        # Sin cache para los estaticos: el prototipo se edita en vivo.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def guess_type(self, path):
        """Declara UTF-8 en todo texto: los acentos de la UI viven en
        index.html, styles.css y app.js, y sin charset el navegador podria
        interpretarlos con la codificacion local del sistema."""
        tipo = super().guess_type(path)
        if tipo.startswith("text/") or tipo in ("application/javascript", "application/json"):
            if "charset=" not in tipo:
                return tipo + "; charset=utf-8"
        return tipo

    def _leer_json(self):
        try:
            largo = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            largo = 0
        if largo <= 0:
            return None, "El cuerpo de la petición está vacío."
        if largo > MAX_BODY:
            return None, "El cuerpo de la petición excede el límite permitido."
        crudo = self.rfile.read(largo)
        try:
            return json.loads(crudo.decode("utf-8")), None
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None, "El cuerpo no es JSON válido."

    # --------------------------------------------------------------- metodos
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        ruta = urlparse(self.path).path.rstrip("/") or "/"

        if ruta == "/api/health":
            return self._health()
        if ruta == "/api/leads/stats":
            return self._json(200, {"ok": True, "stats": store.estadisticas()})
        if ruta == "/api/leads":
            return self._listar_leads()
        if ruta == "/api/config":
            return self._json(200, {
                "ok": True,
                "modelo": {
                    "dias_operativos": calculo.DIAS_OPERATIVOS,
                    "meses": calculo.MESES_ANIO,
                    "factor_mitigacion": calculo.FACTOR_MITIGACION,
                    "tipo_cambio_usd": calculo.TIPO_CAMBIO_USD,
                },
                "limites": calculo.LIMITES,
                "limites_tarifa": calculo.LIMITES_TARIFA,
                "regla_b2b_activa": validacion.REGLA_B2B_ACTIVA,
            })
        if ruta.startswith("/api/"):
            return self._json(404, {"ok": False, "error": "Endpoint no encontrado."})

        return super().do_GET()

    def do_POST(self):
        ruta = urlparse(self.path).path.rstrip("/") or "/"
        if ruta == "/api/leads":
            return self._crear_lead()
        return self._json(404, {"ok": False, "error": "Endpoint no encontrado."})

    # ------------------------------------------------------------ endpoints
    def _health(self):
        try:
            stats = store.estadisticas()
            persistencia_ok = True
            detalle = None
        except Exception as exc:  # pragma: no cover
            stats, persistencia_ok, detalle = {}, False, str(exc)

        activo = (datetime.now(timezone.utc) - ARRANQUE).total_seconds()
        self._json(200 if persistencia_ok else 503, {
            "ok": persistencia_ok,
            "servicio": "DowntimeOS Landing API",
            "version": "1.0.0",
            "uptime_segundos": round(activo, 1),
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "persistencia": {
                "motor": "JSON local",
                "archivo": os.path.relpath(store.RUTA_LEADS, RAIZ).replace("\\", "/"),
                "disponible": persistencia_ok,
                "error": detalle,
            },
            "leads": stats,
        })

    def _listar_leads(self):
        query = parse_qs(urlparse(self.path).query)
        estatus = (query.get("estatus") or [None])[0]
        limite = (query.get("limite") or [None])[0]
        try:
            resultado = store.listar(estatus=estatus, limite=limite)
        except ValueError:
            return self._json(400, {"ok": False, "error": "El parámetro 'limite' debe ser numérico."})
        self._json(200, {"ok": True, **resultado})

    def _crear_lead(self):
        payload, error = self._leer_json()
        if error:
            return self._json(400, {"ok": False, "error": error})

        origen = str(payload.get("origen", "CALCULADORA")).upper()
        if origen not in ("CALCULADORA", "AUDITORIA"):
            origen = "CALCULADORA"

        try:
            limpio = validacion.validar_lead(payload, origen)
        except validacion.ErrorValidacion as exc:
            return self._json(400, {
                "ok": False,
                "error": "Revisa los campos marcados.",
                "errores": exc.errores,
            })

        # El servidor NUNCA confia en las cifras del cliente: recalcula.
        finanzas = calculo.calcular(
            limpio["maquinas"], limpio["turnos"],
            limpio["tarifa_hora"], limpio["minutos_paro_dia"], limpio["divisa"],
        )

        registro = {
            "id": None,  # lo asigna la Capa 3
            "nombre": limpio["nombre"],
            "puesto": limpio["puesto"],
            "empresa": limpio["empresa"],
            "sector": limpio["sector"],
            "email": limpio["email"],
            "telefono": limpio["telefono"],
            "ciudad": limpio["ciudad"],
            "parque_industrial": limpio["parque_industrial"],
            "maquinas": finanzas["maquinas"],
            "turnos": finanzas["turnos"],
            "horas_operacion_dia": finanzas["horas_operacion_dia"],
            "tarifa_hora": finanzas["tarifa_hora"],
            "minutos_paro_dia": finanzas["minutos_paro_dia"],
            "divisa": finanzas["divisa"],
            "perdida_diaria": finanzas["perdida_diaria"],
            "perdida_mensual": finanzas["perdida_mensual"],
            "perdida_anual": finanzas["perdida_anual"],
            "ahorro_proyectado": finanzas["ahorro_proyectado"],
            "perdida_anual_mxn": finanzas["perdida_anual_mxn"],
            "costo_por_minuto": finanzas["costo_por_minuto"],
            "origen": origen,
            "estatus": "AUDITORIA_SOLICITADA" if origen == "AUDITORIA" else "NUEVO",
            "utm": limpio["utm"],
            "notas": limpio["notas"],
            "created_at": None,  # lo asigna la Capa 3
        }

        try:
            guardado = store.agregar_lead(registro)
        except OSError as exc:
            return self._json(500, {
                "ok": False,
                "error": "No fue posible escribir en data/leads.json: {0}".format(exc),
            })

        self.log_message("LEAD %s -> %s (%s)", guardado["id"], guardado["empresa"], guardado["estatus"])
        self._json(201, {
            "ok": True,
            "mensaje": "Lead registrado correctamente.",
            "lead": guardado,
        })


def banner(puerto, total):
    url = "http://localhost:{0}".format(puerto)
    linea = "=" * 66
    print(linea)
    print("  DowntimeOS - Prototipo local (3 capas)")
    print(linea)
    print("  Capa 1  Frontend .... {0}".format(os.path.relpath(DIR_PUBLICO, RAIZ)))
    print("  Capa 2  API ......... {0}/api/health".format(url))
    print("  Capa 3  Persistencia  data/leads.json ({0} leads)".format(total))
    print(linea)
    print("  Abre:  {0}".format(url))
    print("  Leads: {0}/api/leads".format(url))
    print("  Ctrl+C para detener.")
    print(linea)


def main():
    parser = argparse.ArgumentParser(description="Servidor local DowntimeOS")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 3000)))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--no-browser", action="store_true", help="No abrir el navegador")
    parser.add_argument("--reseed", action="store_true", help="Regenerar los 30 leads semilla")
    args = parser.parse_args()

    datos = store.sembrar(forzar=args.reseed)
    total = len(datos["leads"])
    if args.reseed:
        print("  [seed] data/leads.json regenerado con {0} registros.".format(total))

    try:
        httpd = ThreadingHTTPServer((args.host, args.port), DowntimeHandler)
    except OSError as exc:
        print("\n  ERROR: no se pudo abrir el puerto {0} ({1}).".format(args.port, exc))
        print("  Prueba:  python server/main.py --port 3001\n")
        sys.exit(1)

    banner(args.port, total)

    if not args.no_browser:
        threading.Timer(0.8, webbrowser.open, args=("http://localhost:{0}".format(args.port),)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Servidor detenido. Los leads quedaron guardados en data/leads.json")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
