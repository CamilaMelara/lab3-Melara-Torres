export type LabScenario = "normal" | "slow" | "timeout" | "retry-success";
export type NotificationChannel = "email" | "sms";

export interface DeliveryRequest {
  notification_id: string;
  channel: NotificationChannel;
  recipient: string;
  message: string;
  attempt: number;
}

export interface DeliveryResult {
  status: number;
  body: unknown;
  duration_ms: number;
}

const providerUrl = process.env.DELIVERY_PROVIDER_URL ?? "http://localhost:3002";

export async function deliver(
  payload: DeliveryRequest,
  scenario: LabScenario,
  requestId: string
): Promise<DeliveryResult> {
  const started = performance.now();
  const response = await fetch(`${providerUrl}/deliver`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-lab-scenario": scenario
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));

  return {
    status: response.status,
    body,
    duration_ms: performance.now() - started
  };
}
