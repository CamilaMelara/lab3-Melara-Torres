import express from "express";
import { httpLogger, logger } from "./logging.js";
import { register } from "./metrics.js";
import { createNotification } from "./notifications.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json({ limit: "32kb" }));
app.use(httpLogger);

app.get("/health", (_req, res) => {
  res.status(200).json({ service: "notifications-api", status: "ok" });
});

app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.status(200).send(await register.metrics());
});

app.post("/notifications", createNotification);

app.listen(port, "0.0.0.0", () => {
  logger.info({ event: "service_started", port }, "notifications-api started");
});
