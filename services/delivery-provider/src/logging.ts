import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import pino from "pino";
import { pinoHttp } from "pino-http";
import type { IncomingMessage, ServerResponse } from "node:http";

const service = "delivery-provider";
const logFile = process.env.LOG_FILE ?? "/logs/delivery-provider.jsonl";

mkdirSync(dirname(logFile), { recursive: true });

const fileStream = pino.destination({ dest: logFile, sync: false });

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    base: { service }
  },
  pino.multistream([
    { stream: process.stdout },
    { stream: fileStream }
  ])
);

export const httpLogger = pinoHttp({
  logger,
  autoLogging: false,
  quietReqLogger: true,
  customAttributeKeys: {
    reqId: "request_id"
  },
  genReqId(req: IncomingMessage, res: ServerResponse) {
    const incoming = req.headers["x-request-id"];
    const requestId = Array.isArray(incoming)
      ? incoming[0]
      : typeof incoming === "string" && incoming.length > 0
        ? incoming
        : randomUUID();

    res.setHeader("x-request-id", requestId);
    return requestId;
  }
});
