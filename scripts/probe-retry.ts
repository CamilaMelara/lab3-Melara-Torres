const baseUrl = process.env.NOTIFICATIONS_URL ?? "http://localhost:3000";

const response = await fetch(`${baseUrl}/notifications`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-request-id": "req-retry-01",
    "x-lab-scenario": "retry-success"
  },
  body: JSON.stringify({
    notification_id: "not-retry-01",
    channel: "email",
    template: "account-activity",
    recipient: "retry-probe@example.test",
    message: "Retry probe message"
  })
});

console.log(`HTTP ${response.status}`);
console.log(await response.text());

if (response.status !== 202) process.exitCode = 1;
