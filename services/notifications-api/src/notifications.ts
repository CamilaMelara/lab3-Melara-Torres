import type { Request, Response } from "express";
import type { Logger } from "pino";
import { SpanKind, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import {
  deliver,
  type LabScenario,
  type NotificationChannel
} from "./delivery-client.js";
import {
  httpRequestDuration,
  httpRequestsInProgress,
  httpRequestsTotal
} from "./metrics.js";

interface NotificationBody {
  notification_id?: unknown;
  channel?: unknown;
  template?: unknown;
  recipient?: unknown;
  message?: unknown;
}

type RequestWithLogger = Request & {
  id: string;
  log: Logger;
};

const DEPENDENCY = "delivery-provider";
const ROUTE = "/notifications";

// Tracer de la instrumentación de dominio (Laboratorio 4).
const tracer = trace.getTracer("notifications-api.domain");

function parseScenario(value: string | string[] | undefined): LabScenario {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "slow" || raw === "timeout" || raw === "retry-success") {
    return raw;
  }
  return "normal";
}

function isChannel(value: unknown): value is NotificationChannel {
  return value === "email" || value === "sms";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorSummary(error: unknown): { type: string; message: string } {
  if (error instanceof Error) {
    return { type: error.name, message: error.message };
  }
  return { type: "unknown", message: String(error) };
}

interface ValidNotification {
  notificationId: string;
  channel: NotificationChannel;
  template: string;
  recipient: string;
  message: string;
}

/**
 * Span manual de dominio: notification.process
 *
 * Pregunta: ¿qué ocurrió con esta notificación válida, cuántos intentos de
 * entrega necesitó y cuál fue su resultado global?
 *
 * Inicio: después de validar la solicitud (la validación no es parte del
 * procesamiento de una notificación; una solicitud inválida no llega a ser una
 * notificación y queda representada por el span HTTP con su 400).
 * Fin: cuando se conoce el resultado global y se envía la respuesta al cliente.
 * Contiene como hijos los spans CLIENT de fetch() hacia /deliver, uno por intento.
 *
 * No se registran recipient ni message en atributos ni eventos.
 */
async function processNotification(
  span: Span,
  log: Logger,
  requestId: string,
  scenario: LabScenario,
  input: ValidNotification,
  res: Response
): Promise<number> {
  const { notificationId, channel, template } = input;
  const maxAttempts = scenario === "retry-success" ? 2 : 1;
  const started = performance.now();

  span.setAttributes({
    "notification.id": notificationId,
    "notification.channel": channel,
    "notification.template": template,
    "lab.scenario": scenario,
    "notification.max_attempts": maxAttempts
  });

  // Contexto mínimo: sin recipient ni message.
  log.info(
    { event: "notification.received", notification_id: notificationId, channel, template },
    "notification received"
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    log.info(
      {
        event: "delivery.attempt.started",
        notification_id: notificationId,
        channel,
        attempt,
        dependency: DEPENDENCY
      },
      "calling delivery-provider"
    );

    // fetch() está autoinstrumentado (Undici): genera un span CLIENT hijo de
    // este span y propaga traceparent hacia delivery-provider.
    const result = await deliver(
      {
        notification_id: notificationId,
        channel,
        recipient: input.recipient,
        message: input.message,
        attempt
      },
      scenario,
      requestId
    );

    const attemptMs = Math.round(result.duration_ms);
    span.setAttribute("notification.attempts", attempt);

    if (result.status === 202) {
      const statusCode = 202;
      const totalMs = Math.round(performance.now() - started);
      span.setAttributes({
        "notification.result": "delivered",
        "notification.status_code": statusCode,
        "delivery.last_status_code": result.status
      });
      // Resultado global satisfactorio, aunque un intento previo haya fallado.
      span.setStatus({ code: SpanStatusCode.OK });
      log.info(
        {
          event: "notification.delivered",
          notification_id: notificationId,
          channel,
          attempt,
          dependency: DEPENDENCY,
          dependency_status: result.status,
          status_code: statusCode,
          result: "success",
          dependency_duration_ms: attemptMs,
          duration_ms: totalMs
        },
        "notification delivered"
      );
      res.status(statusCode).json({ notification_id: notificationId, status: "sent" });
      return statusCode;
    }

    if (result.status === 503 && attempt < maxAttempts) {
      // Fallo de intento recuperable: se registra como evento, NO cambia el
      // estado del span de la notificación (todavía puede terminar bien).
      span.addEvent("delivery.attempt.retryable_failure", {
        "delivery.attempt": attempt,
        "delivery.status_code": result.status,
        "delivery.duration_ms": attemptMs,
        "delivery.will_retry": true
      });
      log.warn(
        {
          event: "delivery.attempt.retryable_failure",
          notification_id: notificationId,
          channel,
          attempt,
          dependency: DEPENDENCY,
          dependency_status: result.status,
          result: "retryable_error",
          will_retry: true,
          dependency_duration_ms: attemptMs
        },
        "retryable delivery failure, retrying"
      );
      await delay(50);
      continue;
    }

    // Fallo que determina el resultado final.
    const timeout = result.status === 504;
    const statusCode = timeout ? 504 : 502;
    const outcome = timeout ? "timeout" : "delivery_error";
    const totalMs = Math.round(performance.now() - started);

    if (timeout) {
      // Evento de dominio: el proveedor agotó su tiempo y la notificación no se
      // entregó. Es un hecho puntual con su propio contexto (intento, código y
      // duración del intento), distinto del estado final del span.
      span.addEvent("notification.delivery_timeout", {
        "delivery.attempt": attempt,
        "delivery.status_code": result.status,
        "delivery.duration_ms": attemptMs
      });
    }

    span.setAttributes({
      "notification.result": outcome,
      "notification.status_code": statusCode,
      "delivery.last_status_code": result.status
    });
    // El resultado de la operación representada (procesar la notificación) es
    // fallido -> ERROR. No hay excepción JavaScript: el 504 es una respuesta HTTP
    // recibida normalmente, por eso no se usa recordException().
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: timeout ? "delivery-provider timeout (504)" : `delivery-provider error (${result.status})`
    });
    log.error(
      {
        event: "notification.failed",
        notification_id: notificationId,
        channel,
        attempt,
        dependency: DEPENDENCY,
        dependency_status: result.status,
        status_code: statusCode,
        result: outcome,
        dependency_duration_ms: attemptMs,
        duration_ms: totalMs
      },
      "notification delivery failed"
    );
    res.status(statusCode).json({
      notification_id: notificationId,
      status: "failed",
      error: timeout ? "delivery_timeout" : "delivery_error"
    });
    return statusCode;
  }

  // No alcanzable: el bucle siempre responde. Se deja explícito por seguridad.
  throw new Error("delivery loop ended without a result");
}

export async function createNotification(req: Request, res: Response): Promise<void> {
  const typedReq = req as RequestWithLogger;
  // req.log ya incluye request_id (pino-http) y, dentro de un span activo,
  // trace_id y span_id (instrumentación de Pino de OpenTelemetry).
  const log = typedReq.log;
  const body = req.body as NotificationBody;
  const scenario = parseScenario(req.headers["x-lab-scenario"]);

  // --- Métricas: inicio de la solicitud ---
  const baseLabels = { method: req.method, route: ROUTE };
  httpRequestsInProgress.inc(baseLabels);
  const endTimer = httpRequestDuration.startTimer(baseLabels);
  const started = performance.now();
  let statusCode = 500;

  try {
    if (
      typeof body?.notification_id !== "string" ||
      !isChannel(body.channel) ||
      typeof body.template !== "string" ||
      typeof body.recipient !== "string" ||
      typeof body.message !== "string"
    ) {
      // Solo se indica qué campos fallaron, nunca sus valores.
      log.warn(
        { event: "notification.rejected", reason: "invalid_request" },
        "notification request rejected"
      );
      statusCode = 400;
      res.status(statusCode).json({ error: "invalid_request" });
      return;
    }

    const input: ValidNotification = {
      notificationId: body.notification_id,
      channel: body.channel,
      template: body.template,
      recipient: body.recipient,
      message: body.message
    };

    // startActiveSpan deja el span como contexto activo: los spans de fetch() y
    // los logs emitidos dentro quedan asociados a él.
    statusCode = await tracer.startActiveSpan(
      "notification.process",
      { kind: SpanKind.INTERNAL },
      async (span) => {
        try {
          return await processNotification(span, log, typedReq.id, scenario, input, res);
        } catch (error) {
          // Excepción real (p. ej. proveedor inalcanzable: fetch lanza TypeError).
          span.recordException(error instanceof Error ? error : new Error(String(error)));
          span.setAttributes({
            "notification.result": "unexpected_error",
            "notification.status_code": 502
          });
          span.setStatus({ code: SpanStatusCode.ERROR, message: "unexpected error" });
          throw error;
        } finally {
          span.end(); // se cierra en todos los caminos
        }
      }
    );
  } catch (error) {
    // Error inesperado. Solo tipo y mensaje del error, nunca el cuerpo.
    statusCode = 502;
    log.error(
      {
        event: "notification.unexpected_error",
        notification_id: typeof body?.notification_id === "string" ? body.notification_id : undefined,
        dependency: DEPENDENCY,
        status_code: statusCode,
        error: errorSummary(error),
        duration_ms: Math.round(performance.now() - started)
      },
      "unexpected error while delivering notification"
    );
    if (!res.headersSent) {
      res.status(statusCode).json({ status: "failed", error: "provider_unreachable" });
    }
  } finally {
    // --- Métricas: fin de la solicitud, en todos los caminos ---
    const code = String(statusCode);
    httpRequestsTotal.inc({ ...baseLabels, status_code: code });
    endTimer({ status_code: code });
    httpRequestsInProgress.dec(baseLabels);
  }
}
