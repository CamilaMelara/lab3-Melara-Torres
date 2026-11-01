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

// Las familias se proporcionan para mantener estable el contrato del laboratorio.
// Deben completarse sus dimensiones, buckets y uso desde la lógica de la aplicación.
export const deliveryRequestsTotal = new Counter({
  name: "delivery_requests_total",
  help: "Total delivery operations processed by delivery-provider.",
  registers: [register]
});

export const deliveryRequestDuration = new Histogram({
  name: "delivery_request_duration_seconds",
  help: "Duration of delivery operations processed by delivery-provider.",
  registers: [register]
});
