import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics
} from "prom-client";

export const register = new Registry();

collectDefaultMetrics({
  register,
  prefix: "delivery_"
});

// Labels de baja cardinalidad:
//   result  -> success | timeout | retryable_error | invalid_request
//   channel -> email | sms (solo valores validados; "unknown" si la solicitud es inválida)
export const deliveryRequestsTotal = new Counter({
  name: "delivery_requests_total",
  help: "Total delivery operations processed by delivery-provider.",
  labelNames: ["result", "channel"] as const,
  registers: [register]
});

// Buckets que separan los comportamientos del proveedor:
//   normal y primer intento de retry ~0.08 s -> 0.05, 0.1
//   slow    ~0.35 s                          -> 0.3, 0.4
//   timeout ~0.70 s                          -> 0.6, 0.75
//   margen                                   -> 0.2, 0.5, 1
export const deliveryRequestDuration = new Histogram({
  name: "delivery_request_duration_seconds",
  help: "Duration of delivery operations processed by delivery-provider.",
  labelNames: ["result"] as const,
  buckets: [0.025, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 1],
  registers: [register]
});
