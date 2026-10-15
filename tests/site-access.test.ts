import { test } from "node:test";
import assert from "node:assert/strict";
import { validSiteCredentials } from "../src/lib/site-access";

test("shared site gate requires the correct username and password", () => {
  const auth = (value: string) => `Basic ${Buffer.from(value).toString("base64")}`;
  assert.equal(validSiteCredentials(null, "secret"), false);
  assert.equal(validSiteCredentials(auth("team:wrong"), "secret"), false);
  assert.equal(validSiteCredentials(auth("other:secret"), "secret"), false);
  assert.equal(validSiteCredentials(auth("team:secret"), "secret"), true);
  assert.equal(validSiteCredentials(auth("team:with:colon"), "with:colon"), true);
});
