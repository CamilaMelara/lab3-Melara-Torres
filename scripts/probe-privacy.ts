const baseUrl = process.env.NOTIFICATIONS_URL ?? "http://localhost:3000";

const response = await fetch(`${baseUrl}/notifications`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-request-id": "req-privacy-01",
    "x-lab-scenario": "normal"
  },
  body: JSON.stringify({
    notification_id: "not-privacy-01",
    channel: "email",
    template: "password-reset",
    recipient: "DO-NOT-LOG@example.test",
    message: "SECRET-LAB3-DO-NOT-PERSIST-9381"
  })
});

console.log(`HTTP ${response.status}`);
console.log(await response.text());

if (response.status !== 202) process.exitCode = 1;
