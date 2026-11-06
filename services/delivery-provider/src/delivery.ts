import type { Request, Response } from "express";
import type { Logger } from "pino";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { deliveryRequestDuration, deliveryRequestsTotal } from "./metrics.js";

interface DeliveryBody {
  notification_id?: unknown;
  channel?: unknown;
  recipient?: unknown;
  message?: unknown;
  attempt?: unknown;
}

type RequestWithLogger = Request & {
  id: string;
  log: Logger;
};

type LabScenario = "normal" | "slow" | "timeout" | "retry-success";
type Channel = "email" | "sms";
type DeliveryResult = "success" | "timeout" | "retryable_error" | "invalid_request";

// Tracer de la instrumentación de dominio (Laboratorio 4).
const tracer = trace.getTracer("delivery-provider.domain");

function parseScenario(value: string | string[] | undefined): LabScenario {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "slow" || raw === "timeout" || raw === "retry-success") {
    return raw;
  }
  return "normal";
}

function isChannel(value: unknown): value is Channel {
  return value === "email" || value === "sms";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deliverNotification(req: Request, res: Response): Promise<void> {
  const typedReq = req as RequestWithLogger;
  // req.log conserva el request_id recibido en X-Request-ID (no se genera uno nuevo).
  const log = typedReq.log;
  const body = req.body as DeliveryBody;
  const scenario = parseScenario(req.headers["x-lab-scenario"]);
  const endTimer = deliveryRequestDuration.startTimer();
  const started = performance.now();

  // Registra métricas para cualquier rama, incluidas las que responden antes.
  function record(result: DeliveryResult, channel: string): number {
    deliveryRequestsTotal.inc({ result, channel });
    endTimer({ result });
    return Math.round(performance.now() - started);
  }

  if (
    typeof body?.notification_id !== "string" ||
    !isChannel(body.channel) ||
    typeof body.recipient !== "string" ||
    typeof body.message !== "string" ||
    typeof body.attempt !== "number"
  ) {
    const durationMs = record("invalid_request", "unknown");
    log.warn(
      { event: "delivery.rejected", result: "invalid_request", status_code: 400, duration_ms: durationMs },
      "delivery request rejected"
    );
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const notificationId = body.notification_id;
  const channel = body.channel;
  const attempt = body.attempt;

  /**
   * Span manual de dominio: delivery.execute
   *
   * Pregunta: ¿qué hizo el proveedor con este intento de entrega, cuánto tardó
   * y con qué resultado respondió?
   *
   * Inicio: después de validar la solicitud de entrega.
   * Fin: cuando el proveedor ya decidió el resultado del intento y envió la
   * respuesta (202, 503 o 504). Cubre la espera que determina la duración.
   * Es hijo del span SERVER de POST /deliver, cuyo padre remoto es el span
   * CLIENT de notifications-api (contexto recibido por traceparent).
   */
  await tracer.startActiveSpan(
    "delivery.execute",
    { kind: SpanKind.INTERNAL },
    async (span) => {
      try {
        span.setAttributes({
          "notification.id": notificationId,
          "notification.channel": channel,
          "delivery.attempt": attempt,
          "lab.scenario": scenario
        });

        // Contexto mínimo: sin recipient ni message.
        log.info(
          { event: "delivery.received", notification_id: notificationId, channel, attempt },
          "delivery received"
        );

        if (scenario === "timeout") {
          await delay(700);
          const durationMs = record("timeout", channel);
          span.setAttributes({ "delivery.result": "timeout", "delivery.status_code": 504 });
          // Evento de dominio: el proveedor no completó la entrega en su tiempo.
          span.addEvent("delivery.timeout", {
            "delivery.attempt": attempt,
            "delivery.status_code": 504,
            "delivery.duration_ms": durationMs
          });
          // El intento falló: ERROR. No hay excepción JavaScript (respuesta 504 normal).
          span.setStatus({ code: SpanStatusCode.ERROR, message: "delivery timeout (504)" });
          log.error(
            {
              event: "delivery.timeout",
              notification_id: notificationId,
              channel,
              attempt,
              result: "timeout",
              status_code: 504,
              duration_ms: durationMs
            },
            "delivery timed out"
          );
          res.status(504).json({ status: "timeout" });
          return;
        }

        if (scenario === "retry-success" && attempt === 1) {
          await delay(80);
          const durationMs = record("retryable_error", channel);
          span.setAttributes({ "delivery.result": "retryable_error", "delivery.status_code": 503 });
          span.addEvent("delivery.retryable_error", {
            "delivery.attempt": attempt,
            "delivery.status_code": 503
          });
          // Este intento falló (ERROR para la operación del proveedor), aunque la
          // notificación completa todavía pueda recuperarse en notifications-api.
          span.setStatus({ code: SpanStatusCode.ERROR, message: "retryable error (503)" });
          log.warn(
            {
              event: "delivery.retryable_error",
              notification_id: notificationId,
              channel,
              attempt,
              result: "retryable_error",
              status_code: 503,
              duration_ms: durationMs
            },
            "retryable delivery error"
          );
          res.status(503).json({ status: "retryable_error" });
          return;
        }

        await delay(scenario === "slow" ? 350 : 80);
        const durationMs = record("success", channel);
        span.setAttributes({ "delivery.result": "success", "delivery.status_code": 202 });
        span.setStatus({ code: SpanStatusCode.OK });
        log.info(
          {
            event: "delivery.succeeded",
            notification_id: notificationId,
            channel,
            attempt,
            result: "success",
            status_code: 202,
            duration_ms: durationMs
          },
          "delivery completed"
        );
        res.status(202).json({ status: "accepted" });
      } catch (error) {
        // Excepción real inesperada: se registra en el span y se propaga a Express.
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR, message: "unexpected error" });
        throw error;
      } finally {
        span.end(); // se cierra en todos los caminos, incluidos los retornos anticipados
      }
    }
  );
}
