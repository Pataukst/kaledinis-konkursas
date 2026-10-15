import { randomUUID } from "node:crypto";
import { db } from "./db";
import { redactHttpBody } from "./http-log-redaction";

async function bodySummary(message: Request | Response) {
  if (!message.body) return null;
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        void reader.cancel().catch(() => {});
        return { omitted: "body_too_large" };
      }
      chunks.push(value);
    }
    return redactHttpBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    return { omitted: "unreadable_or_non_json_body" };
  }
}

export async function logContestRequest(
  request: Request,
  handler: () => Promise<Response>,
) {
  const started = Date.now();
  const id = randomUUID();
  const requestBody = bodySummary(request.clone());
  const response = await handler();
  response.headers.set("X-Request-Id", id);
  try {
    const requestJson = JSON.stringify(await requestBody);
    const responseJson = JSON.stringify(await bodySummary(response.clone()));
    const duration = Date.now() - started;
    await db.$executeRaw`INSERT INTO "HttpRequestLog" (id, method, path, status, "durationMs", "requestBody", "responseBody") VALUES (${id}, ${request.method}, '/api/contest', ${response.status}, ${duration}, ${requestJson}::jsonb, ${responseJson}::jsonb)`;
  } catch {
    // Logging must not turn a completed reservation into a failed response.
    console.error("HTTP request log could not be saved.");
  }
  return response;
}
