'use strict';

// Bootstrap de OpenTelemetry (Laboratorio 4).
// Se precarga con `node --require ./instrumentation.cjs`, de modo que el SDK y
// las autoinstrumentaciones quedan registrados ANTES de que el servicio importe
// Express, Pino o haga llamadas con fetch()/Undici. El mismo archivo lo usan
// ambos servicios; OTEL_SERVICE_NAME identifica a cada proceso.

// Solo se exportan TRAZAS por OTLP. Las métricas siguen en Prometheus (/metrics)
// y los logs siguen en archivos JSON Lines; por eso se desactivan explícitamente
// los exportadores OTLP de métricas y logs, que el SDK activaría por defecto.
process.env.OTEL_METRICS_EXPORTER = process.env.OTEL_METRICS_EXPORTER || 'none';
process.env.OTEL_LOGS_EXPORTER = process.env.OTEL_LOGS_EXPORTER || 'none';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } =
  require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } =
  require('@opentelemetry/exporter-trace-otlp-http');

// Exporter OTLP por HTTP hacia el Collector. La URL se toma de
// OTEL_EXPORTER_OTLP_TRACES_ENDPOINT (definida en compose.yaml).
const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
});

const instrumentations = getNodeAutoInstrumentations({
  // Pino: se usa solo la correlación (agrega trace_id, span_id y trace_flags a
  // cada registro emitido dentro de un span activo). No se envían logs por OTLP.
  '@opentelemetry/instrumentation-pino': {
    disableLogSending: true
  },
  // HTTP entrante/saliente de Node: no se generan spans para /health ni
  // /metrics, que son tráfico de infraestructura (healthcheck y scrape).
  '@opentelemetry/instrumentation-http': {
    ignoreIncomingRequestHook: (req) =>
      req.url === '/health' || req.url === '/metrics'
  },
  // Instrumentaciones que solo añadirían ruido (operaciones de archivos,
  // sockets y DNS) sin responder preguntas del laboratorio.
  '@opentelemetry/instrumentation-fs': { enabled: false },
  '@opentelemetry/instrumentation-net': { enabled: false },
  '@opentelemetry/instrumentation-dns': { enabled: false }
  // Express, HTTP y Undici (fetch) quedan habilitados con su configuración
  // por defecto. La propagación usa el propagador W3C (traceparent) por defecto.
});

const sdk = new NodeSDK({
  traceExporter,
  instrumentations
});

sdk.start();

// Cierre controlado: al terminar el proceso (docker compose stop/down envía
// SIGTERM), se exportan los spans pendientes antes de salir. No interviene en
// el ciclo de una solicitud HTTP.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  sdk
    .shutdown()
    .catch((error) => {
      console.error(`OpenTelemetry shutdown error (${signal}):`, error);
    })
    .finally(() => process.exit(0));
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
