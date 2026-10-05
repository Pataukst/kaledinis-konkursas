import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./audit";
import { assignGift, type AssignmentOutcome } from "./assignment-adapters";
import {
  cleanup,
  lock,
  serverNow,
  expireInTransaction,
  type NewClaim,
  type Reservation,
} from "./reservations";
import { participationAllowed, integer } from "./config";
type Job = {
  id: string;
  claimId: string;
  idempotencyKey: string;
  attempts: number;
};
export async function processAssignment(
  clock?: () => Date,
  assign = assignGift,
) {
  await cleanup(clock);
  if (!participationAllowed()) return false;
  const leaseToken = randomUUID(),
    max = integer("DELIVERY_MAX_ATTEMPTS", 8, 100);
  const job = await db.$transaction(async (tx) => {
    const now = await serverNow(tx, clock);
    const confirmed = process.env.EXTERNAL_IDEMPOTENCY_CONFIRMED === "true";
    const review = await tx.$queryRaw<
      { claimId: string; attempts: number }[]
    >`UPDATE "AssignmentJob" SET status='review',"safeError"='UNCERTAIN_OUTCOME',"leaseToken"=NULL,"leaseUntil"=NULL WHERE (attempts>=${max} OR (${!confirmed} AND attempts>0)) AND (status='pending' OR (status='processing' AND "leaseUntil"<=${now})) RETURNING "claimId",attempts`;
    for (const row of review)
      await audit(tx, "assignment.review", {
        claimId: row.claimId,
        attempt: row.attempts,
        safeError: "UNCERTAIN_OUTCOME",
      });
    const rows = await tx.$queryRaw<
      Job[]
    >`UPDATE "AssignmentJob" SET status='processing',attempts=attempts+1,"leaseToken"=${leaseToken},"leaseUntil"=${new Date(now.getTime() + 90000)} WHERE id=(SELECT id FROM "AssignmentJob" WHERE attempts<${max} AND ((status='pending' AND "nextAttemptAt"<=${now}) OR (status='processing' AND "leaseUntil"<=${now})) ORDER BY "nextAttemptAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`;
    return rows[0];
  });
  if (!job) return false;
  const claims = await db.$queryRaw<
    (NewClaim & {
      flowId: string;
      validationId: string;
      reservedAt: Date;
      expiresAt: Date;
    })[]
  >`SELECT c.*,r."flowId",r."validationId",r."reservedAt",r."expiresAt" FROM "AssignmentClaim" c JOIN "Reservation" r ON r.id=c."reservationId" AND r."giftId"=c."giftId" AND r."customerGuid"=c."customerGuid" AND r.barcode=c.barcode AND r."sessionId"=c."sessionId" JOIN "PurchaseValidation" v ON v.id=r."validationId" AND v."customerGuid"=r."customerGuid" AND v.barcode=r.barcode AND v."activationDate"=r."activationDate" AND v."flowId"=r."flowId" JOIN "Flow" f ON f.id=r."flowId" AND f."sessionId"=r."sessionId" JOIN "Gift" g ON g.id=c."giftId" AND g."externalGiftId"=c."externalGiftId" AND g."activeReservationId"=r.id AND g."reservationExpiresAt"=r."expiresAt" WHERE c.id=${job.claimId} AND c.status='PENDING_ASSIGNMENT' AND r.status='PENDING_ASSIGNMENT' AND g.status='pending'`;
  const c = claims[0],
    correlationId = randomUUID(),
    started = Date.now();
  const chain = c
    ? {
        flowId: c.flowId,
        validationId: c.validationId,
        reservedAt: c.reservedAt,
        expiresAt: c.expiresAt,
      }
    : {};
  await audit(
    db,
    "assignment.attempt",
    {
      claimId: job.claimId,
      reservationId: c?.reservationId,
      customerGuid: c?.customerGuid,
      giftId: c?.externalGiftId,
      attempt: job.attempts,
      ...chain,
    },
    correlationId,
  );
  let result: AssignmentOutcome = { kind: "unknown", code: "mismatch" };
  if (c) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      result = await Promise.race([
        assign(
          { customerGuid: c.customerGuid, giftId: c.externalGiftId },
          job.idempotencyKey,
        ),
        new Promise<AssignmentOutcome>((resolve) => {
          timer = setTimeout(
            () => resolve({ kind: "unknown", code: "timeout" }),
            integer("INTERNAL_API_TIMEOUT_MS", 10000, 60000),
          );
        }),
      ]);
    } catch {
      result = { kind: "unknown", code: "unavailable" };
    } finally {
      clearTimeout(timer);
    }
  }
  await db.$transaction(async (tx) => {
    await lock(tx);
    const now = await serverNow(tx, clock);
    const owned = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "AssignmentJob" WHERE id=${job.id} AND "leaseToken"=${leaseToken} FOR UPDATE`;
    if (!owned.length) {
      await audit(
        tx,
        "assignment.late_outcome",
        {
          claimId: job.claimId,
          attempt: job.attempts,
          classification: result.kind,
          ...chain,
        },
        correlationId,
      );
      return;
    }
    await audit(
      tx,
      "assignment.outcome",
      {
        claimId: job.claimId,
        reservationId: c?.reservationId,
        customerGuid: c?.customerGuid,
        giftId: c?.externalGiftId,
        attempt: job.attempts,
        classification: result.kind,
        safeError: result.kind !== "ok" ? result.code : undefined,
        durationMs: Date.now() - started,
        ...chain,
      },
      correlationId,
    );
    if (c && result.kind === "ok") {
      await tx.$executeRaw`UPDATE "AssignmentClaim" SET status='ASSIGNED',"assignedAt"=${now} WHERE id=${c.id} AND status='PENDING_ASSIGNMENT'`;
      await tx.$executeRaw`UPDATE "Reservation" SET status='ASSIGNED' WHERE id=${c.reservationId} AND status='PENDING_ASSIGNMENT'`;
      await tx.$executeRaw`UPDATE "Gift" SET status='assigned',"activeReservationId"=NULL,"reservationExpiresAt"=NULL WHERE id=${c.giftId} AND "activeReservationId"=${c.reservationId} AND status='pending'`;
      await tx.$executeRaw`UPDATE "AssignmentJob" SET status='accepted',"safeError"=NULL,"leaseToken"=NULL,"leaseUntil"=NULL WHERE id=${job.id}`;
      await audit(
        tx,
        "assignment.completed",
        {
          claimId: c.id,
          reservationId: c.reservationId,
          giftId: c.externalGiftId,
          customerGuid: c.customerGuid,
          from: "PENDING_ASSIGNMENT",
          to: "ASSIGNED",
          ...chain,
        },
        correlationId,
      );
    } else if (c && result.kind === "rejected") {
      await tx.$executeRaw`UPDATE "AssignmentClaim" SET status='REJECTED' WHERE id=${c.id}`;
      await tx.$executeRaw`UPDATE "AssignmentJob" SET status='rejected',"safeError"='ASSIGNMENT_REJECTED',"leaseToken"=NULL,"leaseUntil"=NULL WHERE id=${job.id}`;
      await tx.$executeRaw`UPDATE "Reservation" SET status='RESERVED' WHERE id=${c.reservationId} AND status='PENDING_ASSIGNMENT'`;
      await tx.$executeRaw`UPDATE "Gift" SET status='reserved' WHERE id=${c.giftId} AND "activeReservationId"=${c.reservationId}`;
      const rows = await tx.$queryRaw<
        Reservation[]
      >`SELECT * FROM "Reservation" WHERE id=${c.reservationId}`;
      await audit(
        tx,
        "assignment.rejected",
        {
          claimId: c.id,
          reservationId: c.reservationId,
          giftId: c.externalGiftId,
          customerGuid: c.customerGuid,
          from: "PENDING_ASSIGNMENT",
          to: "RESERVED",
          reservedAt: rows[0].reservedAt,
          expiresAt: rows[0].expiresAt,
        },
        correlationId,
      );
      await expireInTransaction(tx, now);
    } else {
      const review =
        result.kind === "unknown" &&
        (["mismatch", "malformed", "unconfigured"].includes(result.code) ||
          job.attempts >= max ||
          process.env.EXTERNAL_IDEMPOTENCY_CONFIRMED !== "true");
      await tx.$executeRaw`UPDATE "AssignmentJob" SET status=${review ? "review" : "pending"},"safeError"=${result.kind === "unknown" ? result.code : "UNCERTAIN_OUTCOME"},"leaseToken"=NULL,"leaseUntil"=NULL,"nextAttemptAt"=${new Date(now.getTime() + Math.min(3600000, 1000 * 2 ** job.attempts))} WHERE id=${job.id}`;
    }
  });
  return true;
}
