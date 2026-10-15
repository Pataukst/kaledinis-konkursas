import { test } from "node:test";
import assert from "node:assert/strict";
import { participationAllowed } from "../src/lib/config";

test("production demo requires explicit opt-in, password, HTTPS and mock adapters", () => {
  const before = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: "production", PURCHASE_ADAPTER: "mock",
      DELIVERY_ADAPTER: "mock", HOSTED_DEMO: "true", SITE_PASSWORD: "long-team-password",
      APP_ORIGIN: "https://demo.example.com" });
    assert.equal(participationAllowed(), true);
    for (const [key, value] of Object.entries({ HOSTED_DEMO: "false", SITE_PASSWORD: "short",
      APP_ORIGIN: "http://demo.example.com", PURCHASE_ADAPTER: "real", DELIVERY_ADAPTER: "real" })) {
      const old = process.env[key]; process.env[key] = value;
      assert.equal(participationAllowed(), false, key); process.env[key] = old;
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
});
