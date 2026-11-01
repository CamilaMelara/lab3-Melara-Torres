import type { Request, Response } from "express";
import type { Logger } from "pino";
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

  // Contexto mínimo: sin recipient ni message.
  log.info(
    { event: "delivery.received", notification_id: notificationId, channel, attempt },
    "delivery received"
  );

  if (scenario === "timeout") {
    await delay(700);
    const durationMs = record("timeout", channel);
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
    // Recuperable desde la perspectiva del flujo completo: WARN.
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
}
