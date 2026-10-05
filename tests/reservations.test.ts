import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { barcodeSchema } from "../src/lib/validation";
import {
  validationRequestSchema,
  validationResponseSchema,
  assignmentRequestSchema,
  assignmentResponseSchema,
} from "../src/lib/api-contract";
import {
  checkPurchase,
  stableGuid,
  classifyAssignment,
  assignGift,
} from "../src/lib/assignment-adapters";
import {
  validateAndReserve,
  submitReservation,
  cleanup,
  flowState,
  invalidateFlow,
  type Reservation,
} from "../src/lib/reservations";
import { processAssignment } from "../src/lib/assignment-worker";
import { archiveInventory } from "../src/lib/inventory";
import { consent } from "../src/lib/config";
process.env.AUDIT_HMAC_KEY ||= "test-only-key";
const enabled = process.env.RUN_DATABASE_TESTS === "1";
if (enabled && !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Testai leidžiami tik *_test bazėje.");
after(async () => {
  await db.$disconnect();
});
test("Nauja pirkimo sutartis, datos, nuliai ir GUID", async () => {
  for (const [name, schema] of [
    ["validation-request", validationRequestSchema],
    ["validation-ok", validationResponseSchema],
    ["validation-invalid", validationResponseSchema],
    ["assignment-request", assignmentRequestSchema],
    ["assignment-ok", assignmentResponseSchema],
    ["assignment-failure", assignmentResponseSchema],
  ] as const)
    assert.ok(
      schema.safeParse(
        JSON.parse(
          readFileSync(
            new URL("./fixtures/" + name + ".json", import.meta.url),
            "utf8",
          ),
        ),
      ).success,
      name,
    );
  const now = new Date("2026-10-01T21:30:00Z");
  assert.deepEqual(
    barcodeSchema(128, now).parse({
      barcode: " 000123 ",
      purchaseDate: "2026-10-02",
    }),
    { barcode: "000123", purchaseDate: "2026-10-02" },
  );
  for (const input of [
    { barcode: 123, purchaseDate: "2026-10-01" },
    { barcode: "x", purchaseDate: "2026-02-30" },
    { barcode: "x", purchaseDate: "2026-10-03" },
    { barcode: "x".repeat(129), purchaseDate: "2026-10-01" },
  ])
    assert.equal(barcodeSchema(128, now).safeParse(input).success, false);
  for (const customerGuid of ["", null, "abc"])
    assert.equal(
      validationResponseSchema.safeParse({ validation: true, customerGuid })
        .success,
      false,
    );
  const request = { customerGuid: stableGuid("one"), giftId: "gift-one" };
  assert.equal(
    assignmentRequestSchema.safeParse({ ...request, customerGuid: "" }).success,
    false,
  );
  assert.deepEqual(classifyAssignment({ status: "OK", ...request }, request), {
    kind: "ok",
  });
  for (const response of [
    { status: "OK", ...request, customerGuid: stableGuid("two") },
    { status: "OK", ...request, giftId: "two" },
    { status: "OK" },
  ])
    assert.equal(classifyAssignment(response, request).kind, "unknown");
  process.env.PURCHASE_ADAPTER = "mock";
  const a = await checkPurchase({
    customerIp: "127.0.0.1",
    barcode: "TEST-001",
    activationDate: "2026-10-01",
  });
  assert.deepEqual(
    a,
    await checkPurchase({
      customerIp: "127.0.0.1",
      barcode: "TEST-001",
      activationDate: "2026-09-01",
    }),
  );
  assert.notDeepEqual(
    a,
    await checkPurchase({
      customerIp: "127.0.0.1",
      barcode: "TEST-002",
      activationDate: "2026-10-01",
    }),
  );
});
test(
  "PostgreSQL: 12 valandų rezervacijos ir patvarus priskyrimas",
  { skip: !enabled },
  async (t) => {
    process.env.PURCHASE_ADAPTER = "mock";
    process.env.DELIVERY_ADAPTER = "mock";
    process.env.EXTERNAL_IDEMPOTENCY_CONFIRMED = "true";
    let instant = new Date(),
      clock = () => new Date(instant);
    const advance = (ms: number) => {
      instant = new Date(instant.getTime() + ms);
    };
    async function reset(n = 1) {
      await db.$executeRawUnsafe(
        'TRUNCATE "AssignmentJob","AssignmentClaim","MockAssignment","Reservation","PurchaseValidation","Flow","DeliveryJob","Claim","Eligibility","Visitor","Gift" CASCADE',
      );
      instant = new Date();
      process.env.MOCK_ASSIGNMENT = "ok";
      for (let i = 0; i < n; i++)
        await db.gift.create({
          data: { code: "TEST-CODE-" + randomUUID(), title: "Testinė dovana" },
        });
    }
    const session = async () =>
      (
        await db.visitor.create({
          data: {
            id: randomUUID(),
            expiresAt: new Date(instant.getTime() + 48 * 3600000),
          },
        })
      ).id;
    const reserve = (
      s: string,
      barcode = "TEST-001",
      purchaseDate = "2026-10-01",
    ) => validateAndReserve(s, { barcode, purchaseDate }, "127.0.0.1", clock);
    const submission = (
      r: { id: string; validationId: string },
      email = randomUUID() + "@example.lt",
      requestKey = randomUUID(),
    ) => ({
      email,
      box: 1,
      consent: true,
      consentText: consent().text,
      consentVersion: consent().version,
      requestKey,
      reservationId: r.id,
      validationId: r.validationId,
    });
    const rows = () =>
      db.$queryRaw<
        Reservation[]
      >`SELECT * FROM "Reservation" ORDER BY "reservedAt"`;
    await t.test(
      "Netinkamas pirkimas ar atsakymas nieko nerezervuoja",
      async () => {
        await reset();
        const s = await session();
        for (const barcode of [
          "INVALID",
          "MALFORMED",
          "TIMEOUT",
          "UNAVAILABLE",
        ])
          await assert.rejects(reserve(s, barcode));
        await assert.rejects(
          validateAndReserve(
            s,
            { barcode: 123, purchaseDate: "2026-10-01" },
            "127.0.0.1",
            clock,
          ),
        );
        assert.equal((await rows()).length, 0);
        assert.equal((await db.gift.findFirstOrThrow()).status, "available");
      },
    );
    await t.test(
      "Pakartojimai, datos keitimas ir skirtukai nepratęsia termino",
      async () => {
        await reset();
        const s = await session();
        const results = await Promise.allSettled([
          reserve(s),
          reserve(s),
          reserve(s),
        ]);
        assert.ok(results.some((r) => r.status === "fulfilled"));
        const r = (await rows()).find((r) => r.status === "RESERVED")!;
        assert.equal(
          r.expiresAt.getTime() - r.reservedAt.getTime(),
          12 * 3600000,
        );
        advance(60000);
        const reused = await reserve(s, "TEST-001", "2026-09-01");
        assert.equal(reused.reservation.id, r.id);
        assert.equal(reused.reservation.expiresAt, r.expiresAt.toISOString());
        assert.equal((await flowState(s)).reservation!.id, r.id);
        assert.equal(
          (await rows()).filter((r) => r.status === "RESERVED").length,
          1,
        );
        assert.equal((await archiveInventory([r.giftId])).removed, 0);
      },
    );
    await t.test("Konkurentai negali gauti to paties vieneto", async () => {
      await reset();
      const sessions = await Promise.all([session(), session(), session()]);
      const results = await Promise.allSettled(
        sessions.map((s, i) => reserve(s, "TEST-00" + (i + 1))),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await rows()).length, 1);
    });
    await t.test(
      "Pavėluotas tikrinimo atsakymas nepakeičia naujesnio GUID",
      async () => {
        await reset(2);
        const s = await session();
        let release!: () => void, started!: () => void;
        const began = new Promise<void>((resolve) => {
          started = resolve;
        });
        const delayed = validateAndReserve(
          s,
          { barcode: "TEST-001", purchaseDate: "2026-10-01" },
          "127.0.0.1",
          clock,
          async () => {
            started();
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            return { kind: "valid", customerGuid: stableGuid("TEST-001") };
          },
        );
        await began;
        const newest = await reserve(s, "TEST-002");
        release();
        await assert.rejects(delayed, /Duomenys pasikeitė/);
        assert.equal(
          (await rows()).filter((r) => r.status === "RESERVED").length,
          1,
        );
        assert.equal(
          (await rows()).find((r) => r.id === newest.reservation.id)!
            .customerGuid,
          stableGuid("TEST-002"),
        );
      },
    );
    await t.test(
      "Tikslus terminas, pavėluota forma ir pakartotinis rezervavimas",
      async () => {
        await reset();
        const a = await session(),
          b = await session();
        const first = await reserve(a),
          r = (await rows())[0];
        advance(12 * 3600000);
        const stale = submission(first.reservation);
        await assert.rejects(submitReservation(a, stale, clock));
        assert.equal((await rows())[0].status, "EXPIRED");
        assert.equal(
          (await db.gift.findFirstOrThrow()).reservationExpiresAt,
          null,
        );
        const second = await reserve(b, "TEST-002");
        await assert.rejects(submitReservation(a, stale, clock));
        assert.equal(
          (await db.gift.findFirstOrThrow()).activeReservationId,
          second.reservation.id,
        );
        await assert.rejects(
          submitReservation(a, submission(second.reservation), clock),
        );
        assert.equal(
          (await rows()).find((x) => x.id === r.id)!.expiresAt.toISOString(),
          r.expiresAt.toISOString(),
        );
      },
    );
    await t.test(
      "GUID tik iš saugomos grandinės; užbaigta dovana apsaugota",
      async () => {
        await reset();
        const a = await session(),
          b = await session(),
          r = await reserve(a);
        await assert.rejects(
          submitReservation(b, submission(r.reservation), clock),
        );
        await assert.rejects(
          submitReservation(
            a,
            {
              ...submission(r.reservation),
              customerGuid: stableGuid("attacker"),
            },
            clock,
          ),
        );
        const input = submission(r.reservation, " User+gift@Example.lt ");
        const c = await submitReservation(a, input, clock);
        assert.equal(c.status, "PENDING_ASSIGNMENT");
        assert.deepEqual(await submitReservation(a, input, clock), c);
        const gift = await db.gift.findFirstOrThrow();
        assert.equal((await archiveInventory([gift.id])).removed, 0);
        await processAssignment(clock);
        const claim = (
          await db.$queryRaw<
            {
              email: string;
              customerGuid: string;
              consentText: string;
              assignedAt: Date;
            }[]
          >`SELECT * FROM "AssignmentClaim" WHERE id=${c.id}`
        )[0];
        assert.equal(claim.customerGuid, stableGuid("TEST-001"));
        assert.equal(claim.email, "user+gift@example.lt");
        assert.ok(claim.consentText);
        assert.ok(claim.assignedAt);
        assert.equal(
          (await db.gift.findFirstOrThrow()).reservationExpiresAt,
          null,
        );
        assert.equal((await flowState(a)).claim!.status, "ASSIGNED");
        assert.equal(await processAssignment(clock), false);
        assert.equal((await archiveInventory([gift.id])).removed, 0);
        await assert.rejects(
          db.gift.update({
            where: { id: gift.id },
            data: { status: "available" },
          }),
        );
        await assert.rejects(reserve(b, "TEST-001", "2026-09-01"));
      },
    );
    await t.test(
      "Pakartotinis el. paštas ir idempotency konflikto patikra",
      async () => {
        await reset(2);
        const a = await session(),
          b = await session(),
          r = await reserve(a),
          q = await reserve(b, "TEST-002");
        const input = submission(r.reservation, "same@example.lt");
        await submitReservation(a, input, clock);
        await assert.rejects(submitReservation(a, { ...input, box: 2 }, clock));
        await assert.rejects(
          submitReservation(
            b,
            submission(q.reservation, " SAME@example.lt "),
            clock,
          ),
        );
        assert.equal(
          (await rows()).find((x) => x.id === q.reservation.id)!.status,
          "RESERVED",
        );
      },
    );
    await t.test(
      "Definitive Failure atkuria pradinį terminą ir leidžia naują bandymą",
      async () => {
        await reset();
        const s = await session(),
          r = await reserve(s),
          input = submission(r.reservation),
          deadline = r.reservation.expiresAt;
        const c = await submitReservation(s, input, clock);
        process.env.MOCK_ASSIGNMENT = "failure";
        await processAssignment(clock);
        assert.equal(
          (await submitReservation(s, input, clock)).status,
          "REJECTED",
        );
        assert.equal((await rows())[0].status, "RESERVED");
        assert.equal((await rows())[0].expiresAt.toISOString(), deadline);
        assert.equal(await processAssignment(clock), false);
        process.env.MOCK_ASSIGNMENT = "ok";
        const retry = await submitReservation(
          s,
          { ...input, requestKey: randomUUID() },
          clock,
        );
        assert.notEqual(retry.id, c.id);
        await processAssignment(clock);
        assert.equal((await flowState(s)).claim!.status, "ASSIGNED");
      },
    );
    await t.test(
      "Prarastas OK, perkrovimas ir termino kirtimas negrąžina dovanos",
      async () => {
        await reset();
        const s = await session(),
          r = await reserve(s),
          c = await submitReservation(s, submission(r.reservation), clock);
        process.env.MOCK_ASSIGNMENT = "timeout-after";
        await processAssignment(clock);
        advance(13 * 3600000);
        await cleanup(clock);
        assert.equal((await db.gift.findFirstOrThrow()).status, "pending");
        await db.$executeRaw`UPDATE "AssignmentJob" SET status='processing',"leaseUntil"=${new Date(0)} WHERE "claimId"=${c.id}`;
        await processAssignment(clock);
        assert.equal((await flowState(s)).claim!.status, "ASSIGNED");
        assert.equal(
          (
            await db.$queryRaw<
              { count: bigint }[]
            >`SELECT count(*) AS count FROM "MockAssignment"`
          )[0].count,
          1n,
        );
      },
    );
    await t.test(
      "Mismatched/malformed atsakymai ir nepatvirtinta idempotency saugomi peržiūrai",
      async () => {
        for (const mode of [
          "swapped-guid",
          "swapped-gift",
          "malformed",
          "timeout-before",
        ]) {
          await reset();
          const s = await session(),
            r = await reserve(s),
            c = await submitReservation(s, submission(r.reservation), clock);
          process.env.MOCK_ASSIGNMENT = mode;
          process.env.EXTERNAL_IDEMPOTENCY_CONFIRMED = "false";
          await processAssignment(clock);
          const job = (
            await db.$queryRaw<
              { status: string }[]
            >`SELECT status FROM "AssignmentJob" WHERE "claimId"=${c.id}`
          )[0];
          assert.equal(job.status, "review");
          advance(13 * 3600000);
          await cleanup(clock);
          assert.equal((await db.gift.findFirstOrThrow()).status, "pending");
        }
        process.env.EXTERNAL_IDEMPOTENCY_CONFIRMED = "true";
      },
    );
    await t.test(
      "Galutinis atmetimas po termino saugiai baigia rezervaciją",
      async () => {
        await reset();
        const s = await session(),
          r = await reserve(s);
        await submitReservation(s, submission(r.reservation), clock);
        advance(13 * 3600000);
        process.env.MOCK_ASSIGNMENT = "failure";
        await processAssignment(clock);
        assert.equal((await rows())[0].status, "EXPIRED");
        assert.equal((await db.gift.findFirstOrThrow()).status, "available");
      },
    );
    await t.test(
      "Expiry / submit lenktynės, cleanup delsimas ir išėjimas",
      async () => {
        await reset();
        const s = await session(),
          r = await reserve(s);
        advance(12 * 3600000);
        await Promise.allSettled([
          cleanup(clock),
          submitReservation(s, submission(r.reservation), clock),
        ]);
        assert.equal((await rows())[0].status, "EXPIRED");
        const next = await reserve(s);
        await invalidateFlow(s);
        assert.equal(
          (await rows()).find((x) => x.id === next.reservation.id)!.status,
          "RELEASED",
        );
        await assert.rejects(
          submitReservation(s, submission(next.reservation), clock),
        );
      },
    );
    await t.test(
      "Restart be idempotency garantijos nekartoja neaiškaus priskyrimo",
      async () => {
        await reset();
        const s = await session(),
          r = await reserve(s),
          c = await submitReservation(s, submission(r.reservation), clock);
        await db.$executeRaw`UPDATE "AssignmentJob" SET status='processing',attempts=1,"leaseToken"='stopped',"leaseUntil"=${new Date(0)} WHERE "claimId"=${c.id}`;
        process.env.EXTERNAL_IDEMPOTENCY_CONFIRMED = "false";
        assert.equal(await processAssignment(clock), false);
        assert.equal(
          (
            await db.assignmentJob.findUniqueOrThrow({
              where: { claimId: c.id },
            })
          ).status,
          "review",
        );
        assert.equal(await db.mockAssignment.count(), 0);
        process.env.EXTERNAL_IDEMPOTENCY_CONFIRMED = "true";
      },
    );
    await t.test(
      "Pavėluotas worker atsakymas nepakeičia naujos nuomos rezultato",
      async () => {
        await reset();
        const s = await session(),
          r = await reserve(s),
          c = await submitReservation(s, submission(r.reservation), clock);
        let release!: () => void, started!: () => void;
        const began = new Promise<void>((resolve) => {
          started = resolve;
        });
        const delayed = processAssignment(clock, async () => {
          started();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { kind: "unknown", code: "timeout" };
        });
        await began;
        advance(100000);
        await processAssignment(clock);
        release();
        await delayed;
        assert.equal(
          (
            await db.assignmentJob.findUniqueOrThrow({
              where: { claimId: c.id },
            })
          ).status,
          "accepted",
        );
        assert.equal(
          (await db.assignmentClaim.findUniqueOrThrow({ where: { id: c.id } }))
            .status,
          "ASSIGNED",
        );
        await assert.rejects(
          db.assignmentClaim.update({
            where: { id: c.id },
            data: { customerGuid: stableGuid("swapped") },
          }),
        );
        await assert.rejects(
          db.assignmentClaim.update({
            where: { id: c.id },
            data: { giftId: randomUUID() },
          }),
        );
      },
    );
    await t.test(
      "Timeout prieš apdorojimą kartojamas tuo pačiu raktu; kito payload negalima",
      async () => {
        await reset();
        const s = await session(),
          r = await reserve(s),
          c = await submitReservation(s, submission(r.reservation), clock);
        process.env.MOCK_ASSIGNMENT = "timeout-before";
        await processAssignment(clock);
        const job = await db.assignmentJob.findUniqueOrThrow({
          where: { claimId: c.id },
        });
        assert.equal(job.status, "pending");
        assert.equal(await db.mockAssignment.count(), 0);
        process.env.MOCK_ASSIGNMENT = "ok";
        advance(10000);
        await processAssignment(clock);
        const claim = await db.assignmentClaim.findUniqueOrThrow({
          where: { id: c.id },
        });
        const request = {
          customerGuid: claim.customerGuid,
          giftId: claim.externalGiftId,
        };
        assert.deepEqual(await assignGift(request, job.idempotencyKey), {
          kind: "ok",
        });
        assert.equal(
          (
            await assignGift(
              { ...request, customerGuid: stableGuid("other") },
              job.idempotencyKey,
            )
          ).kind,
          "unknown",
        );
        assert.equal(
          (await assignGift(request, "different-key")).kind,
          "rejected",
        );
        assert.equal(
          (
            await db.assignmentJob.findUniqueOrThrow({
              where: { claimId: c.id },
            })
          ).idempotencyKey,
          job.idempotencyKey,
        );
      },
    );
    await t.test(
      "Auditas patvarus, nekeičiamas ir be žalių asmens duomenų",
      async () => {
        const events = await db.$queryRaw<
          { eventType: string; metadata: unknown }[]
        >`SELECT "eventType",metadata FROM "AuditEvent"`;
        for (const event of [
          "validation.attempt",
          "validation.outcome",
          "reservation.created",
          "reservation.reused",
          "reservation.expired",
          "reservation.released",
          "assignment.pending",
          "assignment.attempt",
          "assignment.outcome",
          "assignment.completed",
          "assignment.rejected",
          "submission.rejected",
        ])
          assert.ok(
            events.some((e) => e.eventType === event),
            event,
          );
        const text = JSON.stringify(events);
        assert.ok(!text.includes("same@example.lt"));
        assert.ok(!text.includes("TEST-CODE-"));
        assert.ok(!text.includes("127.0.0.1"));
        await assert.rejects(
          db.$executeRawUnsafe('UPDATE "AuditEvent" SET "eventType"=\'fake\''),
        );
        await assert.rejects(db.$executeRawUnsafe('DELETE FROM "AuditEvent"'));
      },
    );
  },
);
