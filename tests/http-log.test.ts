import { test } from "node:test";
import assert from "node:assert/strict";
import { redactHttpBody } from "../src/lib/http-log-redaction";

test("HTTP log masks nested personal data, credentials, and unknown strings", () => {
  const result = redactHttpBody({
    action: "claim", input: { email: "person@example.com", barcode: "123456",
      password: "secret", requestKey: "private", box: 3, consent: true,
      unexpected: "private text", nested: [{ token: "secret" }] },
    status: "assigned", id: "private-id",
  });
  assert.deepEqual(result, {
    action: "claim", input: { email: "[REDACTED]", barcode: "[REDACTED]",
      password: "[REDACTED]", requestKey: "[REDACTED]", box: 3, consent: true,
      unexpected: "[REDACTED]", nested: [{ token: "[REDACTED]" }] },
    status: "assigned", id: "[REDACTED]",
  });
  assert.deepEqual(redactHttpBody({ action: "injected secret", box: 123456 }),
    { action: "[REDACTED]", box: "[REDACTED]" });
});
