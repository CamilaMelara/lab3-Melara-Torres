import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

let failures = 0;

function pass(message: string): void {
  console.log(`[PASS] ${message}`);
}

function fail(message: string): void {
  failures += 1;
  console.log(`[FAIL] ${message}`);
}

async function checkHttp(url: string, label: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      fail(`${label}: HTTP ${response.status}`);
      return null;
    }
    pass(label);
    return await response.text();
  } catch (error) {
    fail(`${label}: ${String(error)}`);
    return null;
  }
}

function validateJsonLines(text: string, label: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const [index, line] of lines.entries()) {
    try {
      records.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      fail(`${label}: línea ${index + 1} no contiene JSON válido`);
      return [];
    }
  }
  pass(`${label}: JSON Lines válido`);
  return records;
}

function hasForbiddenMetricLabels(metrics: string): string[] {
  const forbidden = ["request_id", "notification_id", "recipient", "message"];
  return forbidden.filter((name) => new RegExp(`(?:\\{|,)${name}=`).test(metrics));
}

function hasPositiveSample(metrics: string, metricName: string): boolean {
  const pattern = new RegExp(`^${metricName}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)$`, "gm");
  for (const match of metrics.matchAll(pattern)) {
    if (Number(match[1]) > 0) return true;
  }
  return false;
}

console.log("=== Compilación ===");
const build = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
  stdio: "inherit"
});
if (build.status === 0) pass("TypeScript compila");
else fail("La compilación TypeScript falló");

console.log("\n=== Servicios ===");
await checkHttp("http://localhost:3000/health", "notifications-api responde");
await checkHttp("http://localhost:3002/health", "delivery-provider responde");

console.log("\n=== Métricas ===");
const notificationMetrics = await checkHttp("http://localhost:3000/metrics", "endpoint de métricas de notifications-api");
const deliveryMetrics = await checkHttp("http://localhost:3002/metrics", "endpoint de métricas de delivery-provider");

if (notificationMetrics) {
  for (const family of [
    "notifications_http_requests_total",
    "notifications_http_requests_in_progress",
    "notifications_http_request_duration_seconds"
  ]) {
    if (notificationMetrics.includes(family)) pass(`existe ${family}`);
    else fail(`no se encontró ${family}`);
  }

  const forbidden = hasForbiddenMetricLabels(notificationMetrics);
  if (forbidden.length === 0) pass("notifications-api no utiliza labels prohibidos");
  else fail(`labels prohibidos en notifications-api: ${forbidden.join(", ")}`);

  if (hasPositiveSample(notificationMetrics, "notifications_http_requests_total")) {
    pass("notifications-api registra solicitudes observadas");
  } else {
    fail("notifications_http_requests_total no contiene observaciones positivas; instrumente la lógica y genere tráfico");
  }

  if (hasPositiveSample(notificationMetrics, "notifications_http_request_duration_seconds_count")) {
    pass("notifications-api registra observaciones de duración");
  } else {
    fail("notifications_http_request_duration_seconds no contiene observaciones; instrumente la lógica y genere tráfico");
  }
}

if (deliveryMetrics) {
  for (const family of ["delivery_requests_total", "delivery_request_duration_seconds"]) {
    if (deliveryMetrics.includes(family)) pass(`existe ${family}`);
    else fail(`no se encontró ${family}`);
  }

  const forbidden = hasForbiddenMetricLabels(deliveryMetrics);
  if (forbidden.length === 0) pass("delivery-provider no utiliza labels prohibidos");
  else fail(`labels prohibidos en delivery-provider: ${forbidden.join(", ")}`);

  if (hasPositiveSample(deliveryMetrics, "delivery_requests_total")) {
    pass("delivery-provider registra operaciones observadas");
  } else {
    fail("delivery_requests_total no contiene observaciones positivas; instrumente la lógica y genere tráfico");
  }

  if (hasPositiveSample(deliveryMetrics, "delivery_request_duration_seconds_count")) {
    pass("delivery-provider registra observaciones de duración");
  } else {
    fail("delivery_request_duration_seconds no contiene observaciones; instrumente la lógica y genere tráfico");
  }
}

console.log("\n=== Prometheus ===");
try {
  const response = await fetch("http://localhost:9090/api/v1/targets");
  const payload = await response.json() as {
    data?: { activeTargets?: Array<{ labels?: { job?: string }; health?: string }> };
  };
  const targets = payload.data?.activeTargets ?? [];
  for (const job of ["notifications-api", "delivery-provider"]) {
    const target = targets.find((candidate) => candidate.labels?.job === job);
    if (target?.health === "up") pass(`target Prometheus ${job} está UP`);
    else fail(`target Prometheus ${job} no está UP`);
  }
} catch (error) {
  fail(`no fue posible consultar Prometheus: ${String(error)}`);
}

console.log("\n=== Logs ===");
for (const [service, filename] of [
  ["notifications-api", "notifications-api.jsonl"],
  ["delivery-provider", "delivery-provider.jsonl"]
] as const) {
  try {
    const text = await readFile(resolve("logs", filename), "utf8");
    const records = validateJsonLines(text, service);

    const domainEvents = records.filter((record) =>
      typeof record.event === "string" && record.event !== "service_started"
    );
    if (domainEvents.length > 0) pass(`${service}: existen eventos estructurados de la operación`);
    else fail(`${service}: no se encontraron eventos estructurados de la operación`);

    if (records.some((record) => typeof record.request_id === "string")) pass(`${service}: existen request_id`);
    else fail(`${service}: no se encontraron request_id`);
  } catch (error) {
    fail(`${service}: no fue posible leer ${filename}: ${String(error)}`);
  }
}

try {
  const notificationText = await readFile(resolve("logs", "notifications-api.jsonl"), "utf8");
  const deliveryText = await readFile(resolve("logs", "delivery-provider.jsonl"), "utf8");

  if (notificationText.includes("req-retry-01") && deliveryText.includes("req-retry-01")) {
    pass("req-retry-01 puede correlacionarse entre ambos servicios");
  } else {
    fail("req-retry-01 no aparece en ambos servicios; ejecute npm run probe:retry");
  }

  const combined = `${notificationText}\n${deliveryText}`;
  const sensitive = ["DO-NOT-LOG@example.test", "SECRET-LAB3-DO-NOT-PERSIST-9381"];
  const leaked = sensitive.filter((value) => combined.includes(value));
  if (leaked.length === 0) pass("no se detectaron valores sensibles de la prueba");
  else fail(`se detectó información sensible: ${leaked.join(", ")}`);
} catch (error) {
  fail(`no fue posible comprobar correlación/privacidad: ${String(error)}`);
}

console.log("\n=== Resultado ===");
if (failures === 0) {
  console.log("RESULTADO: VALIDACIÓN COMPLETA");
} else {
  console.log(`RESULTADO: REVISAR INSTRUMENTACIÓN (${failures} fallo(s))`);
  process.exitCode = 1;
}
