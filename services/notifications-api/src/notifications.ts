import type { Request, Response } from "express";
import type { Logger } from "pino";
import {
  deliver,
  type LabScenario,
  type NotificationChannel
} from "./delivery-client.js";

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

export async function createNotification(req: Request, res: Response): Promise<void> {
  const typedReq = req as RequestWithLogger;
  const body = req.body as NotificationBody;
  const scenario = parseScenario(req.headers["x-lab-scenario"]);

  if (
    typeof body.notification_id !== "string" ||
    !isChannel(body.channel) ||
    typeof body.template !== "string" ||
    typeof body.recipient !== "string" ||
    typeof body.message !== "string"
  ) {
    typedReq.log.warn("Invalid notification request");
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const notificationId = body.notification_id;
  const channel = body.channel;

  // Instrumentación inicial deliberadamente deficiente.
  // El laboratorio requiere rediseñar estos registros.
  typedReq.log.info({ body: req.body }, "Notification received");

  const maxAttempts = scenario === "retry-success" ? 2 : 1;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      typedReq.log.info(`Calling delivery provider (attempt ${attempt})`);

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

      if (result.status === 202) {
        typedReq.log.info("Notification sent");
        res.status(202).json({ notification_id: notificationId, status: "sent" });
        return;
      }

      if (result.status === 503 && attempt < maxAttempts) {
        typedReq.log.warn("Retrying delivery");
        await delay(50);
        continue;
      }

      const timeout = result.status === 504;
      typedReq.log.error("Notification delivery failed");
      res.status(timeout ? 504 : 502).json({
        notification_id: notificationId,
        status: "failed",
        error: timeout ? "delivery_timeout" : "delivery_error"
      });
      return;
    }
  } catch (error) {
    typedReq.log.error({ err: error }, "Notification delivery failed");
    res.status(502).json({ status: "failed", error: "provider_unreachable" });
  }
}
