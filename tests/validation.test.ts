import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emailSchema,
  purchaseSchema,
  validDate,
  vilniusDate,
  claimSchema,
  labels,
} from "../src/lib/validation";
import {
  mockPurchase,
  realPurchase,
  realDelivery,
  mockDelivery,
} from "../src/lib/adapters";
import { parseInventory } from "../src/lib/inventory";
import { participationAllowed } from "../src/lib/config";
test("Kanalų laukai ir pradiniai nuliai", () => {
  assert.deepEqual(
    labels.online.map((x) => x[0]),
    ["orderNumber", "buyerEmail"],
  );
  assert.deepEqual(
    labels.shop.map((x) => x[0]),
    ["barcode", "receiptNumber"],
  );
  assert.deepEqual(
    labels.retail.map((x) => x[0]),
    ["barcode", "purchaseDate"],
  );
  const p = purchaseSchema().parse({
    channel: "shop",
    barcode: " 000001 ",
    receiptNumber: "00002",
  });
  if (p.channel !== "shop") throw new Error("channel");
  assert.equal(p.barcode, "000001");
  assert.equal(p.receiptNumber, "00002");
  assert.equal(
    purchaseSchema().safeParse({ channel: "online", orderNumber: "123" })
      .success,
    false,
  );
});
test("El. paštas ir Lietuvos kalendorinė data", () => {
  assert.equal(
    emailSchema.parse(" A.B+gift@Example.com "),
    "a.b+gift@example.com",
  );
  for (const email of ["a@", "@b.com", "a b@c.lt", "a@b"])
    assert.equal(emailSchema.safeParse(email).success, false);
  const now = new Date("2026-10-03T22:30:00Z");
  assert.equal(vilniusDate(now), "2026-10-04");
  assert.equal(validDate("2026-10-04", now), true);
  assert.equal(validDate("2026-10-05", now), false);
  assert.equal(validDate("2026-02-30", now), false);
});
test("Sutikimas ir dėžutė privalomi", () => {
  assert.equal(
    claimSchema.safeParse({
      email: "a@b.lt",
      box: 1,
      consent: false,
      requestKey: crypto.randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    claimSchema.safeParse({
      email: "a@b.lt",
      box: 6,
      consent: true,
      requestKey: crypto.randomUUID(),
    }).success,
    false,
  );
});
test("Testinės pirkimų tapatybės stabilios tarp kanalų", async () => {
  const online = await mockPurchase({
    channel: "online",
    orderNumber: "TEST-001",
    buyerEmail: "buyer@example.lt",
  });
  const shop = await mockPurchase({
    channel: "shop",
    barcode: "TEST-001",
    receiptNumber: "000123",
  });
  const retail = await mockPurchase({
    channel: "retail",
    barcode: "TEST-001",
    purchaseDate: "2026-01-01",
  });
  assert.deepEqual(online, shop);
  assert.deepEqual(shop, retail);
  assert.equal(
    (
      await mockPurchase({
        channel: "online",
        orderNumber: "INVALID",
        buyerEmail: "a@b.lt",
      })
    ).outcome,
    "invalid",
  );
  for (const [key, reason] of [
    ["TIMEOUT", "timeout"],
    ["UNAVAILABLE", "unavailable"],
  ] as const)
    assert.deepEqual(
      await mockPurchase({
        channel: "online",
        orderNumber: key,
        buyerEmail: "a@b.lt",
      }),
      { outcome: "error", reason },
    );
});
test("Tikros integracijos nesukonfigūruotos, imitacija aiški", async () => {
  assert.deepEqual(
    await realPurchase({
      channel: "online",
      orderNumber: "x",
      buyerEmail: "a@b.lt",
    }),
    { outcome: "error", reason: "unconfigured" },
  );
  const request = {
    recipientEmail: "a@b.lt",
    giftCode: "fake",
    claimId: "test",
    idempotencyKey: "stable",
  };
  assert.deepEqual(await realDelivery(request), {
    outcome: "error",
    reason: "unconfigured",
  });
  process.env.MOCK_DELIVERY = "failed";
  assert.equal((await mockDelivery(request)).outcome, "error");
  process.env.MOCK_DELIVERY = "accepted";
  assert.equal((await mockDelivery(request)).outcome, "accepted");
});
test("CSV: BOM, kabutės, diakritiniai ženklai, skyrikliai, klaidos", () => {
  const good = parseInventory(
    '\uFEFFdovanos_kodas;dovanos_pavadinimas\n0001;"Dovana; lietuviška"\n0002;"Dovana\nkitame puslapyje"',
  );
  assert.equal(good.errors.length, 0);
  assert.equal(good.rows[0].code, "0001");
  assert.equal(good.rows[0].title, "Dovana; lietuviška");
  assert.equal(
    parseInventory("dovanos_kodas,dovanos_pavadinimas\n001,A\n001,B").errors
      .length,
    1,
  );
  assert.ok(
    parseInventory('dovanos_kodas,dovanos_pavadinimas\n001,"neuždaryta').errors
      .length,
  );
  assert.ok(
    parseInventory("dovanos_kodas,dovanos_pavadinimas\n001,").errors.length,
  );
});
test("Produkcija ir nesukonfigūruotos integracijos blokuoja dalyvavimą", () => {
  const old = process.env.NODE_ENV;
  process.env.PURCHASE_ADAPTER = "mock";
  process.env.DELIVERY_ADAPTER = "mock";
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  assert.equal(participationAllowed(), false);
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  assert.equal(participationAllowed(), true);
  process.env.DELIVERY_ADAPTER = "real";
  assert.equal(participationAllowed(), false);
  process.env.DELIVERY_ADAPTER = "mock";
  (process.env as Record<string, string | undefined>).NODE_ENV = old;
});
