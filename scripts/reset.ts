import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const logDir = resolve("logs");
await mkdir(logDir, { recursive: true });

for (const file of ["notifications-api.jsonl", "delivery-provider.jsonl"]) {
  await writeFile(resolve(logDir, file), "", "utf8");
}

console.log("Logs reiniciados. Ejecute este comando con los servicios detenidos.");
