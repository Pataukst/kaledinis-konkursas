import { randomUUID } from "node:crypto";
import { db } from "./db";
import { deliver } from "./adapters";
import { integer, participationAllowed } from "./config";
export async function processOne() {
  if (!participationAllowed()) return false;
  const maxAttempts = integer("DELIVERY_MAX_ATTEMPTS", 8, 100);
  await db.deliveryJob.updateMany({
    where: {
      status: "processing",
      leaseUntil: { lt: new Date() },
      attempts: { gte: maxAttempts },
    },
    data: {
      status: "failed",
      safeError: "timeout",
      leaseToken: null,
      leaseUntil: null,
    },
  });
  const token = randomUUID();
  const timeout = integer("INTERNAL_API_TIMEOUT_MS", 10000, 60000);
  const leaseMs = timeout + 30000;
  const jobs = await db.$queryRaw<
    { id: string }[]
  >`UPDATE "DeliveryJob" SET status='processing',"leaseToken"=${token},"leaseUntil"=NOW()+${leaseMs}*INTERVAL '1 millisecond',attempts=attempts+1,"updatedAt"=NOW() WHERE id=(SELECT id FROM "DeliveryJob" WHERE attempts<${maxAttempts} AND ((status='pending' AND "nextAttemptAt"<=NOW()) OR (status='processing' AND "leaseUntil"<NOW())) ORDER BY "nextAttemptAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id`;
  if (!jobs.length) return false;
  const job = await db.deliveryJob.findUniqueOrThrow({
    where: { id: jobs[0].id },
    include: { claim: { include: { gift: true } } },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result;
  try {
    result = await Promise.race([
      deliver({
        recipientEmail: job.claim.email,
        giftCode: job.claim.gift.code,
        claimId: job.claimId,
        idempotencyKey: job.idempotencyKey,
      }),
      new Promise<{ outcome: "error"; reason: "timeout" }>((r) => {
        timer = setTimeout(
          () => r({ outcome: "error", reason: "timeout" }),
          timeout,
        );
      }),
    ]);
  } catch {
    result = { outcome: "error" as const, reason: "unavailable" as const };
  } finally {
    clearTimeout(timer);
  }
  const accepted = result.outcome === "accepted";
  const failed = job.attempts >= maxAttempts;
  await db.deliveryJob.updateMany({
    where: { id: job.id, leaseToken: token },
    data: {
      status: accepted ? "accepted" : failed ? "failed" : "pending",
      safeError: result.outcome === "error" ? result.reason : null,
      leaseToken: null,
      leaseUntil: null,
      nextAttemptAt: new Date(
        Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(job.attempts, 12)),
      ),
    },
  });
  return true;
}
