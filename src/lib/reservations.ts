import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit, token, type Tx } from "./audit";
import { AppError, hash } from "./security";
import { barcodeSchema, claimSchema } from "./validation";
import { consent, participationAllowed } from "./config";
import { checkPurchase, type ValidationOutcome } from "./assignment-adapters";
import { z } from "zod";
export const expiryMessage =
  "Jūsų dovanos rezervacijos laikas baigėsi. Patikrinkite pirkimą iš naujo.";
export type Reservation = {
  id: string;
  giftId: string;
  validationId: string;
  flowId: string;
  sessionId: string;
  barcode: string;
  activationDate: string;
  customerGuid: string;
  status: string;
  reservedAt: Date;
  expiresAt: Date;
};
export type NewClaim = {
  box: number;
  id: string;
  reservationId: string;
  sessionId: string;
  giftId: string;
  barcode: string;
  email: string;
  customerGuid: string;
  externalGiftId: string;
  status: string;
  requestHash: string;
};
export async function lock(tx: Tx) {
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3000ms'");
  // Shared by reservation allocation, expiry, final submission, assignment completion and archival.
  // Blocking lock distinguishes temporary contention from genuinely empty inventory.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(730124)::text`;
}
export async function serverNow(tx: Tx, clock?: () => Date) {
  if (clock) return clock();
  return (
    await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  )[0].now;
}
async function sessionLock(tx: Tx, sessionId: string, now: Date) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Visitor" WHERE id=${sessionId} AND "expiresAt">${now} FOR UPDATE`;
  if (!rows.length)
    throw new AppError(401, "Sesija baigėsi. Pradėkite iš naujo.");
}
export const publicReservation = (r: Reservation) => ({
  id: r.id,
  validationId: r.validationId,
  expiresAt: r.expiresAt.toISOString(),
});
export async function publicResult(c: NewClaim, tx: Tx) {
  const gift = await tx.gift.findUniqueOrThrow({ where: { id: c.giftId }, select: { title: true } });
  return { id: c.id, email: c.email, status: c.status,
    delayed: c.status === "PENDING_ASSIGNMENT", giftTitle: gift.title, box: c.box };
}
async function release(tx: Tx, r: Reservation, status: "EXPIRED" | "RELEASED") {
  if (r.status !== "RESERVED") return;
  const gift = await tx.gift.findUniqueOrThrow({
    where: { id: r.giftId },
    select: { externalGiftId: true },
  });
  await tx.$executeRaw`UPDATE "Reservation" SET status=${status} WHERE id=${r.id} AND status='RESERVED'`;
  await tx.$executeRaw`UPDATE "Gift" SET status='available',"reservationExpiresAt"=NULL,"activeReservationId"=NULL WHERE id=${r.giftId} AND status='reserved' AND "activeReservationId"=${r.id}`;
  await tx.$executeRaw`UPDATE "Flow" SET "validationId"=NULL,version=version+1 WHERE id=${r.flowId} AND "validationId"=${r.validationId}`;
  await audit(
    tx,
    status === "EXPIRED" ? "reservation.expired" : "reservation.released",
    {
      flowId: r.flowId,
      reservationId: r.id,
      giftId: gift.externalGiftId,
      inventoryId: r.giftId,
      customerGuid: r.customerGuid,
      from: "RESERVED",
      to: status,
      reservedAt: r.reservedAt,
      expiresAt: r.expiresAt,
    },
  );
}
export async function expireInTransaction(tx: Tx, now: Date) {
  const rows = await tx.$queryRaw<
    Reservation[]
  >`SELECT * FROM "Reservation" WHERE status='RESERVED' AND "expiresAt"<=${now} FOR UPDATE`;
  for (const r of rows) await release(tx, r, "EXPIRED");
  return rows.length;
}
export async function cleanup(clock?: () => Date) {
  return db.$transaction(async (tx) => {
    await lock(tx);
    return expireInTransaction(tx, await serverNow(tx, clock));
  });
}
export async function invalidateFlow(sessionId: string) {
  await cleanup();
  await db.$transaction(async (tx) => {
    await lock(tx);
    await sessionLock(tx, sessionId, await serverNow(tx));
    const rows = await tx.$queryRaw<
      Reservation[]
    >`SELECT * FROM "Reservation" WHERE "sessionId"=${sessionId} AND status='RESERVED' FOR UPDATE`;
    for (const r of rows) await release(tx, r, "RELEASED");
    await tx.$executeRaw`UPDATE "Flow" SET version=version+1,"validationId"=NULL WHERE "sessionId"=${sessionId}`;
  });
}
export async function flowState(sessionId: string) {
  await cleanup();
  return db.$transaction(async (tx) => {
    await lock(tx);
    const now = await serverNow(tx);
    await sessionLock(tx, sessionId, now);
    const claims = await tx.$queryRaw<
      NewClaim[]
    >`SELECT * FROM "AssignmentClaim" WHERE "sessionId"=${sessionId} AND status<>'REJECTED' ORDER BY "createdAt" DESC LIMIT 1`;
    if (claims[0])
      return {
        claim: await publicResult(claims[0], tx),
        eligible: false,
        reservation: null,
        serverTime: now.toISOString(),
      };
    const rows = await tx.$queryRaw<
      Reservation[]
    >`SELECT r.* FROM "Reservation" r JOIN "Flow" f ON f.id=r."flowId" AND f."validationId"=r."validationId" WHERE r."sessionId"=${sessionId} AND r.status='RESERVED' AND r."expiresAt">${now}`;
    const history = await tx.$queryRaw<
      { status: string }[]
    >`SELECT status FROM "Reservation" WHERE "sessionId"=${sessionId} ORDER BY "reservedAt" DESC LIMIT 1`;
    const rejected = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "AssignmentClaim" WHERE "sessionId"=${sessionId} AND status='REJECTED' ORDER BY "createdAt" DESC LIMIT 1`;
    return {
      claim: null,
      eligible: !!rows[0],
      reservation: rows[0] ? publicReservation(rows[0]) : null,
      rejected: !!rejected[0],
      expired: !rows[0] && history[0]?.status === "EXPIRED",
      serverTime: now.toISOString(),
    };
  });
}
export async function validateAndReserve(
  sessionId: string,
  raw: unknown,
  customerIp: string,
  clock?: () => Date,
  verify = checkPurchase,
) {
  if (!participationAllowed())
    throw new AppError(
      503,
      "Dalyvavimas šiuo metu negalimas: integracijos neparuoštos.",
    );
  await cleanup(clock);
  const parsed = barcodeSchema().safeParse(raw);
  if (!parsed.success) {
    await invalidateFlow(sessionId);
    throw new AppError(
      400,
      "Patikrinkite įvestus pirkimo duomenis.",
      Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0]), i.message]),
      ),
    );
  }
  const input = parsed.data;
  const correlationId = randomUUID();
  const start = await db.$transaction(async (tx) => {
    await lock(tx);
    const now = await serverNow(tx, clock);
    await sessionLock(tx, sessionId, now);
    const old = await tx.$queryRaw<
      Reservation[]
    >`SELECT * FROM "Reservation" WHERE "sessionId"=${sessionId} AND status IN ('RESERVED','PENDING_ASSIGNMENT') FOR UPDATE`;
    if (old[0]?.status === "PENDING_ASSIGNMENT")
      throw new AppError(409, "Dovanos priskyrimas dar tikrinamas.");
    if (old[0] && old[0].barcode === input.barcode) {
      const gift = await tx.gift.findUniqueOrThrow({
        where: { id: old[0].giftId },
        select: { externalGiftId: true },
      });
      await audit(
        tx,
        "reservation.reused",
        {
          reservationId: old[0].id,
          flowId: old[0].flowId,
          validationId: old[0].validationId,
          giftId: gift.externalGiftId,
          customerGuid: old[0].customerGuid,
          reservedAt: old[0].reservedAt,
          expiresAt: old[0].expiresAt,
        },
        correlationId,
      );
      return { reuse: old[0], serverTime: now.toISOString() };
    }
    if (old[0]) await release(tx, old[0], "RELEASED");
    const id = randomUUID();
    const f = await tx.$queryRaw<
      { id: string; version: number }[]
    >`INSERT INTO "Flow" (id,"sessionId") VALUES (${id},${sessionId}) ON CONFLICT ("sessionId") DO UPDATE SET version="Flow".version+1,"validationId"=NULL RETURNING id,version`;
    await audit(
      tx,
      "validation.attempt",
      {
        flowId: f[0].id,
        version: f[0].version,
        barcodeToken: token(input.barcode),
        ipToken: token(customerIp),
      },
      correlationId,
    );
    return { flow: f[0] };
  });
  if (start.reuse)
    return {
      eligible: true,
      reservation: publicReservation(start.reuse),
      serverTime: start.serverTime,
    };
  const began = Date.now();
  let result: ValidationOutcome;
  try {
    result = await verify({
      customerIp,
      barcode: input.barcode,
      activationDate: input.purchaseDate,
    });
  } catch {
    result = { kind: "error" as const, code: "unavailable" as const };
  }
  if (
    result.kind === "valid" &&
    !z.uuid().safeParse(result.customerGuid).success
  )
    result = { kind: "error", code: "malformed" };
  await audit(
    db,
    "validation.outcome",
    {
      flowId: start.flow!.id,
      version: start.flow!.version,
      classification: result.kind,
      customerGuid: result.kind === "valid" ? result.customerGuid : undefined,
      safeError: result.kind === "error" ? result.code : undefined,
      durationMs: Date.now() - began,
    },
    correlationId,
  );
  if (result.kind === "invalid")
    throw new AppError(
      422,
      "Pirkimas nepatvirtintas. Patikrinkite brūkšninį kodą ir pirkimo datą.",
    );
  if (result.kind === "error")
    throw new AppError(
      503,
      "Pirkimo tikrinimo paslauga šiuo metu nepasiekiama. Bandykite vėliau.",
    );
  const guid = result.customerGuid;
  try {
    return await db.$transaction(async (tx) => {
      await lock(tx);
      const now = await serverNow(tx, clock);
      await sessionLock(tx, sessionId, now);
      await expireInTransaction(tx, now);
      const f = await tx.$queryRaw<
        { version: number }[]
      >`SELECT version FROM "Flow" WHERE id=${start.flow!.id} FOR UPDATE`;
      if (f[0]?.version !== start.flow!.version)
        throw new AppError(
          409,
          "Duomenys pasikeitė. Patikrinkite pirkimą iš naujo.",
        );
      const used = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Reservation" WHERE barcode=${input.barcode} AND status IN ('RESERVED','PENDING_ASSIGNMENT','ASSIGNED') UNION ALL SELECT id FROM "Claim" WHERE "purchaseId"=${input.barcode} OR "purchaseId"=${"fixture:" + input.barcode}`;
      if (used.length)
        throw new AppError(409, "Su šiuo pirkimu jau dalyvaujama.");
      const gifts = await tx.$queryRaw<
        { id: string; externalGiftId: string }[]
      >`SELECT id,"externalGiftId" FROM "Gift" WHERE status='available' ORDER BY random() LIMIT 1 FOR UPDATE`;
      if (!gifts.length)
        throw new AppError(
          410,
          "Visos dovanos jau rezervuotos arba išdalytos.",
        );
      const validationId = randomUUID(),
        id = randomUUID(),
        expiresAt = new Date(now.getTime() + 12 * 3600000),
        flowId = start.flow!.id;
      await tx.$executeRaw`INSERT INTO "PurchaseValidation" (id,"flowId",version,barcode,"activationDate","customerGuid") VALUES (${validationId},${flowId},${start.flow!.version},${input.barcode},${input.purchaseDate},${guid})`;
      await tx.$executeRaw`INSERT INTO "Reservation" (id,"giftId","validationId","flowId","sessionId",barcode,"activationDate","customerGuid",status,"reservedAt","expiresAt") VALUES (${id},${gifts[0].id},${validationId},${flowId},${sessionId},${input.barcode},${input.purchaseDate},${guid},'RESERVED',${now},${expiresAt})`;
      await tx.$executeRaw`UPDATE "Gift" SET status='reserved',"activeReservationId"=${id},"reservationExpiresAt"=${expiresAt} WHERE id=${gifts[0].id}`;
      await tx.$executeRaw`UPDATE "Flow" SET "validationId"=${validationId} WHERE id=${flowId}`;
      await audit(
        tx,
        "reservation.created",
        {
          flowId,
          reservationId: id,
          validationId,
          giftId: gifts[0].externalGiftId,
          inventoryId: gifts[0].id,
          customerGuid: guid,
          barcodeToken: token(input.barcode),
          from: "AVAILABLE",
          to: "RESERVED",
          reservedAt: now,
          expiresAt,
        },
        correlationId,
      );
      return {
        eligible: true,
        reservation: { id, validationId, expiresAt: expiresAt.toISOString() },
        serverTime: now.toISOString(),
      };
    });
  } catch (e) {
    await audit(
      db,
      "reservation.rejected",
      {
        flowId: start.flow!.id,
        safeError: e instanceof AppError ? "CONFLICT" : "CONTENTION",
      },
      correlationId,
    );
    if (e instanceof AppError) throw e;
    throw new AppError(
      503,
      "Rezervavimas laikinai užimtas. Bandykite dar kartą.",
    );
  }
}
const submissionSchema = claimSchema
  .extend({ reservationId: z.uuid(), validationId: z.uuid() })
  .strict();
export async function submitReservation(
  sessionId: string,
  raw: unknown,
  clock?: () => Date,
) {
  await cleanup(clock);
  const p = submissionSchema.safeParse(raw);
  if (!p.success) {
    await audit(db, "submission.rejected", {
      safeError: "INPUT_OR_IDENTITY_NOT_ALLOWED",
    });
    throw new AppError(
      400,
      "Patikrinkite įvestus duomenis.",
      Object.fromEntries(
        p.error.issues.map((i) => [String(i.path[0]), i.message]),
      ),
    );
  }
  const input = p.data,
    requestHash = hash(JSON.stringify(input));
  try {
    return await db.$transaction(async (tx) => {
      await lock(tx);
      const now = await serverNow(tx, clock);
      await sessionLock(tx, sessionId, now);
      const prior = await tx.$queryRaw<
        NewClaim[]
      >`SELECT * FROM "AssignmentClaim" WHERE "sessionId"=${sessionId} AND "requestKey"=${input.requestKey}`;
      if (prior[0]) {
        if (prior[0].requestHash !== requestHash)
          throw new AppError(409, "Pakartotos užklausos duomenys nesutampa.");
        return publicResult(prior[0], tx);
      }
      const rows = await tx.$queryRaw<
        Reservation[]
      >`SELECT r.* FROM "Reservation" r JOIN "Flow" f ON f.id=r."flowId" AND f."validationId"=r."validationId" JOIN "PurchaseValidation" v ON v.id=r."validationId" AND v."customerGuid"=r."customerGuid" AND v.barcode=r.barcode AND v."activationDate"=r."activationDate" WHERE r.id=${input.reservationId} AND r."sessionId"=${sessionId} AND r."validationId"=${input.validationId} AND r.status='RESERVED' AND r."expiresAt">${now} FOR UPDATE OF r`;
      const r = rows[0];
      if (!r) throw new AppError(403, expiryMessage);
      const gifts = await tx.$queryRaw<
        { externalGiftId: string }[]
      >`SELECT "externalGiftId" FROM "Gift" WHERE id=${r.giftId} AND status='reserved' AND "activeReservationId"=${r.id} FOR UPDATE`;
      if (!gifts[0])
        throw new AppError(
          403,
          "Rezervacija nebegalioja. Patikrinkite pirkimą iš naujo.",
        );
      const approved = consent();
      if (
        input.consentText !== approved.text ||
        input.consentVersion !== approved.version
      )
        throw new AppError(
          409,
          "Sutikimo tekstas pasikeitė. Atnaujinkite puslapį.",
        );
      const legacy = await tx.claim.findUnique({
        where: { email: input.email },
      });
      if (legacy)
        throw new AppError(
          409,
          "Šiuo el. pašto adresu konkurse jau dalyvauta.",
        );
      const id = randomUUID(),
        externalGiftId = gifts[0].externalGiftId;
      await tx.$executeRaw`INSERT INTO "AssignmentClaim" (id,"reservationId","sessionId","giftId",barcode,email,"customerGuid","externalGiftId",box,"consentText","consentVersion","consentAt","requestKey","requestHash",status) VALUES (${id},${r.id},${sessionId},${r.giftId},${r.barcode},${input.email},${r.customerGuid},${externalGiftId},${input.box},${approved.text},${approved.version},${now},${input.requestKey},${requestHash},'PENDING_ASSIGNMENT')`;
      await tx.$executeRaw`INSERT INTO "AssignmentJob" (id,"claimId","idempotencyKey","nextAttemptAt") VALUES (${randomUUID()},${id},${"assignment:" + id},${now})`;
      await tx.$executeRaw`UPDATE "Reservation" SET status='PENDING_ASSIGNMENT' WHERE id=${r.id}`;
      await tx.$executeRaw`UPDATE "Gift" SET status='pending' WHERE id=${r.giftId} AND "activeReservationId"=${r.id}`;
      await audit(tx, "assignment.pending", {
        claimId: id,
        reservationId: r.id,
        validationId: r.validationId,
        flowId: r.flowId,
        giftId: externalGiftId,
        customerGuid: r.customerGuid,
        emailToken: token(input.email),
        from: "RESERVED",
        to: "PENDING_ASSIGNMENT",
        reservedAt: r.reservedAt,
        expiresAt: r.expiresAt,
      });
      const gift = await tx.gift.findUniqueOrThrow({ where: { id: r.giftId }, select: { title: true } });
      return { id, email: input.email, status: "PENDING_ASSIGNMENT", delayed: true,
        giftTitle: gift.title, box: input.box };
    });
  } catch (e) {
    await audit(db, "submission.rejected", {
      reservationId: input.reservationId,
      safeError:
        e instanceof AppError
          ? "AUTHORIZATION_OR_INPUT"
          : "DUPLICATE_OR_CONTENTION",
    });
    if (e instanceof AppError) throw e;
    throw new AppError(
      409,
      "Šiuo el. pašto adresu arba su šiuo pirkimu jau dalyvauta. Bandykite atnaujinti būseną.",
    );
  }
}

