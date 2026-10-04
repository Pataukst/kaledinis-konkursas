import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { createClaim } from "../src/lib/claims";
import { processOne } from "../src/lib/outbox";
import { archiveInventory, importInventory } from "../src/lib/inventory";
const enabled = process.env.RUN_DATABASE_TESTS === "1";
if (enabled && !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Duomenų bazės testai leidžiami tik *_test bazėje.");
process.env.PURCHASE_ADAPTER = "mock";
process.env.DELIVERY_ADAPTER = "mock";
const unique = () => randomUUID();
const input = (email = `${unique()}@example.lt`, requestKey = unique()) => ({
  email,
  box: 1,
  consent: true,
  consentVersion: process.env.CONSENT_VERSION || "dev-1",
  consentText:
    process.env.CONSENT_TEXT || "Sutinku gauti naujienlaiškius el. paštu.",
  requestKey,
});
async function eligible(
  purchaseId: string = unique(),
  expiresAt = new Date(Date.now() + 60000),
) {
  const v = await db.visitor.create({
    data: {
      id: unique(),
      expiresAt: new Date(Date.now() + 60000),
      eligibility: {
        create: {
          purchaseId,
          channel: "online",
          fingerprint: "test",
          expiresAt,
        },
      },
    },
  });
  return v.id;
}
async function reset() {
  await db.$executeRawUnsafe(
    'TRUNCATE "DeliveryJob","Claim","Eligibility","Visitor","Gift","AdminSession","Admin","RateLimit" CASCADE',
  );
}
after(async () => {
  await db.$disconnect();
});
test(
  "PostgreSQL: konkurencija, unikalumas, sesijos, siuntimas ir CSV",
  { skip: !enabled },
  async (t) => {
    await t.test(
      "Negalima apeiti arba naudoti pasibaigusio patvirtinimo",
      async () => {
        await reset();
        const v = await db.visitor.create({
          data: { id: unique(), expiresAt: new Date(Date.now() + 60000) },
        });
        await assert.rejects(createClaim(v.id, input()), /patvirtinimas/);
        const expired = await eligible(unique(), new Date(0));
        await assert.rejects(createClaim(expired, input()), /patvirtinimas/);
        assert.equal(await db.claim.count(), 0);
      },
    );
    await t.test(
      "Su viena dovana laimi daugiausia vienas klientas",
      async () => {
        await reset();
        await db.gift.create({ data: { code: "000001", title: "Netikra" } });
        const sessions = await Promise.all(
          Array.from({ length: 8 }, () => eligible()),
        );
        const outcomes = await Promise.allSettled(
          sessions.map((s) => createClaim(s, input())),
        );
        assert.equal(
          outcomes.filter((x) => x.status === "fulfilled").length,
          1,
        );
        assert.equal(await db.claim.count(), 1);
        assert.equal(
          await db.gift.count({ where: { status: "allocated" } }),
          1,
        );
      },
    );
    await t.test(
      "Kartojimas naudoja tą patį rezultatą, kita sesija jo negauna",
      async () => {
        await reset();
        await db.gift.createMany({
          data: [
            { code: "a", title: "Netikra" },
            { code: "b", title: "Netikra" },
          ],
        });
        const s = await eligible("canonical-one");
        const request = input(" Receiver@Example.lt ");
        const first = await createClaim(s, request);
        assert.equal(first.email, "receiver@example.lt");
        assert.deepEqual(await createClaim(s, request), first);
        const other = await eligible("canonical-two");
        await assert.rejects(createClaim(other, { ...request }), /el. pašto/);
        const duplicatePurchase = await eligible("canonical-one");
        await assert.rejects(
          createClaim(duplicatePurchase, input()),
          /pirkimu/,
        );
        assert.equal(await db.claim.count(), 1);
        assert.equal(JSON.stringify(first).includes("giftCode"), false);
      },
    );
    await t.test(
      "Transakcijos atšaukimas nepalieka sunaudoto kodo",
      async () => {
        await reset();
        const g = await db.gift.create({
          data: { code: "rollback", title: "Netikra" },
        });
        await assert.rejects(
          db.$transaction(async (tx) => {
            await tx.gift.update({
              where: { id: g.id },
              data: { status: "allocated" },
            });
            throw new Error("Transakcija atšaukta.");
          }),
          /Transakcija atšaukta/,
        );
        assert.equal(
          (await db.gift.findUniqueOrThrow({ where: { id: g.id } })).status,
          "available",
        );
      },
    );
    await t.test(
      "Siuntimo klaida, paleidimas iš naujo ir nuoma išlaiko dovaną",
      async () => {
        await reset();
        await db.gift.create({ data: { code: "stable", title: "Netikra" } });
        const s = await eligible();
        const request = input();
        const c = await createClaim(s, request);
        const before = await db.claim.findUniqueOrThrow({
          where: { id: c.id },
          include: { job: true },
        });
        process.env.MOCK_DELIVERY = "failed";
        await processOne();
        let job = await db.deliveryJob.findUniqueOrThrow({
          where: { claimId: c.id },
        });
        assert.equal(job.status, "pending");
        assert.equal(job.attempts, 1);
        assert.equal((await createClaim(s, request)).delayed, true);
        await db.deliveryJob.update({
          where: { id: job.id },
          data: {
            status: "processing",
            leaseToken: "dead-worker",
            leaseUntil: new Date(0),
            nextAttemptAt: new Date(0),
          },
        });
        process.env.MOCK_DELIVERY = "accepted";
        await Promise.all([processOne(), processOne()]);
        job = await db.deliveryJob.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(job.status, "accepted");
        assert.equal(job.attempts, 2);
        assert.equal(job.idempotencyKey, before.job!.idempotencyKey);
        assert.equal(
          (await db.claim.findUniqueOrThrow({ where: { id: c.id } })).giftId,
          before.giftId,
        );
        assert.equal(await db.claim.count(), 1);
      },
    );
    await t.test(
      "Tuščias inventorius ir netinkamas CSV nesukuria dalinių duomenų",
      async () => {
        await reset();
        await assert.rejects(
          createClaim(await eligible(), input()),
          /Visos dovanos/,
        );
        assert.equal(await db.claim.count(), 0);
        await assert.rejects(
          importInventory("dovanos_kodas,dovanos_pavadinimas\n001,A\n001,B"),
        );
        assert.equal(await db.gift.count(), 0);
        await importInventory("dovanos_kodas,dovanos_pavadinimas\n001,A");
        await assert.rejects(
          importInventory("dovanos_kodas,dovanos_pavadinimas\n002,B\n001,C"),
        );
        assert.equal(await db.gift.count(), 1);
      },
    );
    await t.test(
      "Pašalinimas ir paskyrimas lenktyniaujant apsaugo paskirtus kodus",
      async () => {
        await reset();
        const gift = await db.gift.create({
          data: { code: "race", title: "Netikra" },
        });
        const session = await eligible();
        await Promise.allSettled([
          createClaim(session, input()),
          archiveInventory([gift.id]),
        ]);
        const row = await db.gift.findUniqueOrThrow({
          where: { id: gift.id },
          include: { claim: true },
        });
        if (row.claim) {
          assert.equal(row.status, "allocated");
          assert.equal((await archiveInventory([gift.id])).removed, 0);
          await assert.rejects(
            db.gift.update({
              where: { id: gift.id },
              data: { status: "available" },
            }),
          );
        } else assert.equal(row.status, "archived");
        await assert.rejects(
          importInventory("dovanos_kodas,dovanos_pavadinimas\nrace,Nauja"),
        );
      },
    );
  },
);
