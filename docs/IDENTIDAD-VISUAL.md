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

## Reglas de consistencia

- No usar emojis como iconografía de producto; usar SVGs del sistema.
- Cada estado debe llevar texto además de color.
- Los botones de IA usan la animación de sparkles solo durante una operación.
- Las tarjetas de parada mantienen rojo para STOP y verde para RUN.
- JetBrains Mono se reserva para datos y etiquetas operativas; no para párrafos
  largos.

## Componentes con reglas propias

| Componente | Regla |
| :--- | :--- |
| Navegación de la landing | **Demo** es el único botón con caja ámbar, al extremo derecho. **Auditoría** va en texto ámbar sin caja, justo antes. El resto en gris. |
| Precios | Selector Semestral / Anual con la misma pastilla que el selector de divisa de la calculadora. El total del periodo es la cifra grande; el equivalente mensual va debajo, en texto pequeño y pegado. |
| Mapa de Líneas | Cajas con **relleno transparente**: solo el contorno lleva el color (verde con flujo, ámbar paro con respaldo en paralelo, rojo etapa completa detenida o sin flujo por un paro anterior), con una segunda cara desplazada para el volumen y halo del mismo color. Uniones **blancas**. Flechas de flujo **cian** (actividad en curso) cuando hay producción; grises y quietas cuando no. |
| Análisis con IA (desplegable) | El ámbar vive **solo en la pestaña del encabezado**: desvanecido mientras la IA procesa, brillante al terminar. El contenido desplegado conserva el fondo oscuro; lo que está procesándose se marca en cian. |
| Pasos del Operador | Solo los pasos completados (verde) responden al toque; el activo va en ámbar y los futuros en gris. |
