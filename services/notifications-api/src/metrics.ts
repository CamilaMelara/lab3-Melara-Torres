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

// Labels de baja cardinalidad:
//   method      -> verbo HTTP (POST)
//   route       -> plantilla fija de la ruta (/notifications)
//   status_code -> código HTTP final enviado al cliente (202, 400, 502, 504)
// No se usan request_id, notification_id, recipient ni message: identifican
// operaciones individuales y crearían una serie temporal por solicitud.
export const httpRequestsTotal = new Counter({
  name: "notifications_http_requests_total",
  help: "Total HTTP requests processed by notifications-api.",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [register]
});

// Valor instantáneo: se incrementa al entrar al handler y se decrementa
// siempre en el bloque finally (éxito, error o excepción).
export const httpRequestsInProgress = new Gauge({
  name: "notifications_http_requests_in_progress",
  help: "HTTP requests currently being processed by notifications-api.",
  labelNames: ["method", "route"] as const,
  registers: [register]
});

// Buckets alineados con las escalas temporales del experimento:
//   normal         ~0.08 s                       -> 0.05, 0.1
//   retry-success  ~0.21 s (80 + 50 espera + 80)  -> 0.15, 0.25
//   slow           ~0.35 s                       -> 0.3, 0.4
//   timeout        ~0.70 s                       -> 0.6, 0.75
//   margen                                        -> 1, 2
export const httpRequestDuration = new Histogram({
  name: "notifications_http_request_duration_seconds",
  help: "Duration of HTTP requests processed by notifications-api.",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.05, 0.1, 0.15, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1, 2],
  registers: [register]
});
