# Laboratorio 3. Instrumentación y observación de un servicio

## 1. Diseño de instrumentación

Complete la tabla antes de describir la implementación final.

| Pregunta operacional | Señal | Evidencia necesaria | Decisión de instrumentación |
|---|---|---|---|
| ¿Cómo cambia la actividad de `notifications-api`? | | | |
| ¿Qué proporción de solicitudes termina con error? | | | |
| ¿Cómo evoluciona la duración de `POST /notifications`? | | | |
| ¿Qué resultados produce `delivery-provider`? | | | |
| ¿Cómo evoluciona la duración de la dependencia? | | | |
| ¿Qué ocurrió durante una solicitud concreta? | | | |

## 2. Logging estructurado

### 2.1 Eventos y contexto

Documente los eventos estructurados diseñados para cada servicio. Para cada categoría relevante indique el nivel utilizado y los campos de contexto que conserva.

| Servicio | Evento | Nivel | Campos relevantes | Justificación |
|---|---|---|---|---|
| | | | | |

Explique brevemente la diferencia entre el uso de `request_id` y `notification_id` en su solución.

### 2.2 Reintento recuperable

Ejecute:

```bash
npm run probe:retry
```

Utilice `jq` para localizar `request_id=req-retry-01` en **ambos servicios**. Incluya las consultas utilizadas y reconstruya la secuencia observada. Explique por qué los niveles asignados son coherentes con el resultado final de la operación.

### 2.3 Minimización de información

Ejecute:

```bash
npm run probe:privacy
```

Explique qué información de la solicitud decidió no persistir y por qué.

## 3. Métricas Prometheus

Documente las familias implementadas.

| Familia | Tipo | Labels | Propósito |
|---|---|---|---|
| `notifications_http_requests_total` | | | |
| `notifications_http_requests_in_progress` | | | |
| `notifications_http_request_duration_seconds` | | | |
| `delivery_requests_total` | | | |
| `delivery_request_duration_seconds` | | | |

Explique por qué `request_id` y `notification_id` no se utilizaron como labels.

Para los Histograms, indique los buckets seleccionados y justifique su relación con los comportamientos temporales del escenario.

## 4. PromQL y dashboard de Grafana

Incluya las expresiones PromQL utilizadas para responder las siguientes preguntas:

1. ¿A qué tasa recibe solicitudes `notifications-api`?
2. ¿Qué proporción termina con respuestas 5xx?
3. ¿Cuál es la duración media de `POST /notifications`?
4. ¿Cuál es el p95 de `POST /notifications`?
5. ¿Qué tasa de resultados produce `delivery-provider`, diferenciada por resultado?
6. ¿Cuál es el p95 de duración de `delivery-provider`?

Para cada expresión indique brevemente qué magnitud produce y su unidad.

Construya en Grafana un dashboard que permita interpretar conjuntamente estas señales. Exporte el dashboard a:

```text
evidence/grafana-dashboard.json
```

Incluya una captura de la ejecución A-E en:

```text
evidence/dashboard.png
```

La captura debe quedar referenciada en este documento como evidencia del análisis.

## 5. Regla de alerta

Configure una única regla que detecte una degradación relevante de disponibilidad de `notifications-api`.

Documente:

| Elemento | Valor |
|---|---|
| Expresión PromQL | |
| Umbral | |
| Intervalo de evaluación | |
| Período pendiente | |
| `Keep firing for` | |

Justifique por qué la condición seleccionada representa un síntoma relevante del servicio y por qué los parámetros temporales son apropiados para este experimento.

Ejecute el escenario A-E y conserve **una captura** donde la regla se encuentre en estado `Alerting` durante la fase C:

```text
evidence/alert.png
```

La captura debe quedar referenciada en este documento como evidencia del estado alcanzado por la regla.

No se requiere configurar un `Contact point` ni demostrar envío de notificaciones.

## 6. Análisis del escenario A-E

Ejecute:

```bash
npm run scenario
```

Responda utilizando evidencia de Prometheus/Grafana y, cuando corresponda, logs.

### 6.1 Fase B

¿Qué cambia respecto de A? ¿Existe evidencia suficiente para afirmar que el aumento de actividad produjo degradación del servicio?

### 6.2 Fase C

Caracterice el episodio de degradación. Indique qué ocurre con actividad, errores, duración y resultados del `delivery-provider`.

### 6.3 Fase D

Compare D con C. ¿Qué señal permite distinguir una degradación de duración de una degradación de disponibilidad?

### 6.4 Recuperación

Describa el comportamiento observado al pasar a E y explique por qué algunas consultas pueden tardar en reflejar completamente el cambio de fase.

## 7. Reconstrucción de una operación afectada

Seleccione una solicitud fallida de la fase C.

Incluya las consultas `jq` utilizadas para localizar su `request_id` en:

```text
logs/notifications-api.jsonl
logs/delivery-provider.jsonl
```

Reconstruya los eventos observados en ambos servicios y separe explícitamente:

- evidencia observada;
- interpretación;
- hipótesis que requeriría evidencia adicional.

## 8. Límites de la evidencia

Explique al menos dos preguntas que los logs y métricas de este laboratorio **no permiten responder con suficiente precisión**. Indique qué evidencia adicional sería necesaria.

## 9. Validación

Antes de entregar ejecute:

```bash
npm run probe:retry
npm run probe:privacy
npm run validate
```

Registre únicamente el resultado final obtenido:

```text
RESULTADO: 
```

No copie toda la salida del validador.
