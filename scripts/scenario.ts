const baseUrl = process.env.NOTIFICATIONS_URL ?? "http://localhost:3000";
const scale = Number(process.env.LAB_SCENARIO_SCALE ?? "1");

if (!Number.isFinite(scale) || scale <= 0) {
  throw new Error("LAB_SCENARIO_SCALE must be a positive number");
}

type Scenario = "normal" | "slow" | "timeout";
type Channel = "email" | "sms";

interface Phase {
  name: string;
  seconds: number;
  rate: number;
  scenarioFor(index: number): Scenario;
}

const phases: Phase[] = [
  { name: "A", seconds: 60, rate: 1, scenarioFor: () => "normal" },
  { name: "B", seconds: 60, rate: 4, scenarioFor: () => "normal" },
  { name: "C", seconds: 90, rate: 4, scenarioFor: (i) => (i % 4 === 0 ? "timeout" : "normal") },
  { name: "D", seconds: 90, rate: 4, scenarioFor: () => "slow" },
  { name: "E", seconds: 60, rate: 1, scenarioFor: () => "normal" }
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function send(
  phase: string,
  index: number,
  scenario: Scenario,
  channel: Channel
): Promise<{ status: number; elapsedMs: number }> {
  const sequence = String(index).padStart(4, "0");
  const requestId = `req-${phase.toLowerCase()}-${sequence}`;
  const notificationId = `not-${phase.toLowerCase()}-${sequence}`;
  const started = performance.now();

  const response = await fetch(`${baseUrl}/notifications`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-lab-scenario": scenario
    },
    body: JSON.stringify({
      notification_id: notificationId,
      channel,
      template: "account-activity",
      recipient: `${notificationId}@example.test`,
      message: `Synthetic notification ${notificationId}`
    })
  });

  await response.text();
  return { status: response.status, elapsedMs: performance.now() - started };
}

async function runPhase(phase: Phase): Promise<void> {
  const durationMs = phase.seconds * 1000 * scale;
  const intervalMs = 1000 / phase.rate;
  const plannedRequests = Math.max(1, Math.floor(durationMs / intervalMs));
  const pending: Promise<{ status: number; elapsedMs: number }>[] = [];

  console.log(`\nFase ${phase.name}: ${phase.rate} req/s durante ${(durationMs / 1000).toFixed(1)} s`);

  const phaseStarted = performance.now();
  for (let i = 1; i <= plannedRequests; i += 1) {
    const targetTime = phaseStarted + (i - 1) * intervalMs;
    const waitMs = targetTime - performance.now();
    if (waitMs > 0) await sleep(waitMs);

    const channel: Channel = i % 2 === 0 ? "sms" : "email";
    pending.push(send(phase.name, i, phase.scenarioFor(i), channel));
  }

  const results = await Promise.allSettled(pending);
  let ok = 0;
  let failures = 0;
  const statuses = new Map<number, number>();

  for (const result of results) {
    if (result.status === "fulfilled") {
      const status = result.value.status;
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
      if (status < 500) ok += 1;
      else failures += 1;
    } else {
      failures += 1;
    }
  }

  const statusSummary = [...statuses.entries()]
    .sort(([a], [b]) => a - b)
    .map(([status, count]) => `${status}=${count}`)
    .join(", ");

  console.log(`Fase ${phase.name} completada: total=${results.length}, ok=${ok}, fallos=${failures}, ${statusSummary}`);
}

console.log("Escenario A-E de notifications-api");
console.log(`Destino: ${baseUrl}`);
console.log(`Escala temporal: ${scale}`);

for (const phase of phases) {
  await runPhase(phase);
}

console.log("\nEscenario completado.");
