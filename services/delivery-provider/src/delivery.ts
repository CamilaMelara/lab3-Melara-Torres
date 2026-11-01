import type { Request, Response } from "express";
import type { Logger } from "pino";

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
  const body = req.body as DeliveryBody;
  const scenario = parseScenario(req.headers["x-lab-scenario"]);

  if (
    typeof body.notification_id !== "string" ||
    !isChannel(body.channel) ||
    typeof body.recipient !== "string" ||
    typeof body.message !== "string" ||
    typeof body.attempt !== "number"
  ) {
    typedReq.log.warn("Invalid delivery request");
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  // Instrumentación inicial deliberadamente deficiente.
  typedReq.log.info({ body: req.body }, "Delivery received");

  if (scenario === "timeout") {
    await delay(700);
    typedReq.log.error("Delivery timed out");
    res.status(504).json({ status: "timeout" });
    return;
  }

  if (scenario === "retry-success" && body.attempt === 1) {
    await delay(80);
    typedReq.log.warn("Retryable delivery error");
    res.status(503).json({ status: "retryable_error" });
    return;
  }

  await delay(scenario === "slow" ? 350 : 80);
  typedReq.log.info("Delivery completed");
  res.status(202).json({ status: "accepted" });
}
