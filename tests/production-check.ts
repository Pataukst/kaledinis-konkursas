import assert from "node:assert/strict";
async function main() {
  const base = "http://localhost:3002";
  const bootstrap = await fetch(`${base}/api/contest`);
  assert.equal(bootstrap.status, 200);
  const state = await bootstrap.json();
  assert.equal(state.allowed, false);
  const cookie = bootstrap.headers.get("set-cookie")!.split(";")[0];
  const response = await fetch(`${base}/api/contest`, {
    method: "POST",
    headers: {
      Origin: base,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "validate",
      input: {
        channel: "online",
        orderNumber: "TEST-009",
        buyerEmail: "test@example.lt",
      },
    }),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /integracijos/);
  console.log(
    "Produkcijos HTTP patikra: imituota integracija negali priimti dalyvavimo.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
