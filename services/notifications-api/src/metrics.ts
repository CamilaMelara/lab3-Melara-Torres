import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics
} from "prom-client";

export const register = new Registry();

collectDefaultMetrics({
  register,
  prefix: "notifications_"
});

// Las familias se proporcionan para mantener estable el contrato del laboratorio.
// Deben completarse sus dimensiones, buckets y uso desde la lógica de la aplicación.
export const httpRequestsTotal = new Counter({
  name: "notifications_http_requests_total",
  help: "Total HTTP requests processed by notifications-api.",
  registers: [register]
});

export const httpRequestsInProgress = new Gauge({
  name: "notifications_http_requests_in_progress",
  help: "HTTP requests currently being processed by notifications-api.",
  registers: [register]
});

export const httpRequestDuration = new Histogram({
  name: "notifications_http_request_duration_seconds",
  help: "Duration of HTTP requests processed by notifications-api.",
  registers: [register]
});
