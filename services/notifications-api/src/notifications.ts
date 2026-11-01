import type { Request, Response } from "express";
import type { Logger } from "pino";
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

export async function createNotification(req: Request, res: Response): Promise<void> {
  const typedReq = req as RequestWithLogger;
  // req.log ya incluye request_id (lo agrega pino-http en logging.ts).
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

    const notificationId = body.notification_id;
    const channel = body.channel;
    const template = body.template;

    // Contexto mínimo: sin recipient ni message.
    log.info(
      { event: "notification.received", notification_id: notificationId, channel, template },
      "notification received"
    );

    const maxAttempts = scenario === "retry-success" ? 2 : 1;

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

      const result = await deliver(
        {
          notification_id: notificationId,
          channel,
          recipient: body.recipient,
          message: body.message,
          attempt
        },
        scenario,
        typedReq.id
      );

      const attemptMs = Math.round(result.duration_ms);

      if (result.status === 202) {
        statusCode = 202;
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
            duration_ms: Math.round(performance.now() - started)
          },
          "notification delivered"
        );
        res.status(statusCode).json({ notification_id: notificationId, status: "sent" });
        return;
      }

      if (result.status === 503 && attempt < maxAttempts) {
        // Condición anómala pero recuperable: WARN, la operación sigue.
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

      // Fallo que determina el resultado final: ERROR.
      const timeout = result.status === 504;
      statusCode = timeout ? 504 : 502;
      log.error(
        {
          event: "notification.failed",
          notification_id: notificationId,
          channel,
          attempt,
          dependency: DEPENDENCY,
          dependency_status: result.status,
          status_code: statusCode,
          result: timeout ? "timeout" : "delivery_error",
          dependency_duration_ms: attemptMs,
          duration_ms: Math.round(performance.now() - started)
        },
        "notification delivery failed"
      );
      res.status(statusCode).json({
        notification_id: notificationId,
        status: "failed",
        error: timeout ? "delivery_timeout" : "delivery_error"
      });
      return;
    }
  } catch (error) {
    // Error inesperado (p. ej. proveedor inalcanzable). Solo tipo y mensaje del
    // error, nunca el cuerpo de la solicitud.
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
