# Identidad visual — DowntimeOS y demo DowntimeCO

## Propósito

La marca comunica una operación industrial clara, técnica y accionable: los
paros de planta se convierten en decisiones financieras. La landing vende esa
claridad; la demo demuestra cómo cambia la información según el perfil.

## Sistema base

| Elemento | Decisión visual | Uso |
| :--- | :--- | :--- |
| Fondo | Negro carbón `#06080B` | Base de toda la aplicación y la landing |
| Superficies | Azul-negro y bordes discretos | Tarjetas, paneles, tablas y formularios |
| Acento principal | Ámbar `#FFB627` | Marca, CTAs, datos financieros y foco |
| Estado sano | Verde `#34D399` | Operando, aprobado, éxito |
| Riesgo | Rojo `#FF4D4F` | Paro, bloqueo y error |
| Información | Cian `#35D0E8` | IA, observabilidad y actividad en curso |
| Texto | Inter | Lectura de producto, títulos y contenido |
| Datos | JetBrains Mono | Folios, montos, estados, turnos y metadatos |

El logotipo combina un bloque ámbar redondeado con una señal de pulso negra. La
palabra **DowntimeCO** resalta `CO` en ámbar: es una identidad industrial, no
una interfaz genérica de analítica.

## Landing pública

La landing usa más espacio, tipografía expresiva y CTAs ámbar para explicar el
problema económico antes del producto. Las tarjetas traducen métricas a impacto
de negocio; el contraste no se usa como decoración, sino para jerarquizar la
decisión: dinero y acción en ámbar, alerta en rojo y confirmación en verde.

## Perfiles de la demo

| Perfil | Objetivo | Señales visuales | Información omitida |
| :--- | :--- | :--- | :--- |
| Dirección y Finanzas | Decidir inversión y prioridad económica | Ámbar, Pareto, costos y tarjetas de IA | Ninguna métrica financiera relevante |
| Operaciones y Mantenimiento | Recuperar capacidad y validar paros | Rojo/verde de estado, MTTR/MTBF, líneas y bandeja | Tarifas y cálculo económico detallado |
| Operador de Piso | Reportar rápido desde planta | Semáforo, acciones grandes, flujo corto de captura | Montos, tarifas y análisis financiero |

Los tres comparten cabecera, logo, modo oscuro, componentes y escala
tipográfica. Cambia el contenido disponible, no la identidad: así la demo hace
visible la segregación de información sin parecer tres productos distintos.

## Administración privada

`/administracion` conserva la misma base visual para ser reconocible como parte
de DowntimeOS, pero se identifica como **Administración privada**. Usa cian
para telemetría, ámbar para configuración y los mismos estados verde/rojo para
salud de integraciones. No debe enlazarse desde la landing ni desde la pantalla
de perfiles de la demo.

## Reglas de consistencia

- No usar emojis como iconografía de producto; usar SVGs del sistema.
- Cada estado debe llevar texto además de color.
- Los botones de IA usan la animación de sparkles solo durante una operación.
- Las tarjetas de parada mantienen rojo para STOP y verde para RUN.
- JetBrains Mono se reserva para datos y etiquetas operativas; no para párrafos
  largos.
