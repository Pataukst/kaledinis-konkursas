import { Prisma } from "@prisma/client";
import { db } from "./db";
import { AppError, hash } from "./security";
import { claimSchema } from "./validation";
import { consent, participationAllowed } from "./config";
export const exhausted = "Visos dovanos jau išdalytos. Ačiū už susidomėjimą!";
export function publicClaim(c: {
  id: string;
  email: string;
  job: { status: string; attempts: number } | null;
}) {
  return {
    id: c.id,
    email: c.email,
    delayed: !!c.job && c.job.attempts > 0 && c.job.status !== "accepted",
  };
}
export async function createClaim(sessionId: string, raw: unknown) {
  if (!participationAllowed())
    throw new AppError(
      503,
      "Dalyvavimas šiuo metu negalimas: integracijos neparuoštos.",
    );
  const parsed = claimSchema.safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      400,
      "Patikrinkite įvestus duomenis.",
      Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0]), i.message]),
      ),
    );
  const input = parsed.data;
  const requestHash = hash(
    JSON.stringify({
      email: input.email,
      box: input.box,
      consent: input.consent,
      consentVersion: input.consentVersion,
      consentText: input.consentText,
    }),
  );
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          // Lock visitor to serialize eligibility changes and claims within the authorized session.
          const visitors = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "Visitor" WHERE id=${sessionId} AND "expiresAt">NOW() FOR UPDATE`;
          if (!visitors.length)
            throw new AppError(401, "Sesija baigėsi. Pradėkite iš naujo.");
          const existing = await tx.claim.findUnique({
            where: {
              sessionId_requestKey: { sessionId, requestKey: input.requestKey },
            },
            include: { job: true },
          });
          if (existing) {
            if (existing.requestHash !== requestHash)
              throw new AppError(
                409,
                "Pakartotos užklausos duomenys nesutampa.",
              );
            return publicClaim(existing);
          }
          const eligibility = await tx.eligibility.findUnique({
            where: { sessionId },
          });
          if (!eligibility || eligibility.expiresAt <= new Date())
            throw new AppError(
              403,
              "Pirkimo patvirtinimas baigėsi. Patikrinkite pirkimą iš naujo.",
            );
          // A transaction-level advisory lock avoids false exhaustion caused by SKIP LOCKED.
          // Allocation and archival share it. Waiting contenders retry on PostgreSQL lock timeout.
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2000ms'");
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(730124)::text`;
          if (await tx.claim.findUnique({ where: { email: input.email } }))
            throw new AppError(
              409,
              "Šiuo el. pašto adresu konkurse jau dalyvauta.",
            );
          if (
            await tx.claim.findUnique({
              where: { purchaseId: eligibility.purchaseId },
            })
          )
            throw new AppError(409, "Su šiuo pirkimu konkurse jau dalyvauta.");
          const gifts = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "Gift" WHERE status='available' ORDER BY random() LIMIT 1 FOR UPDATE`;
          if (!gifts.length) throw new AppError(410, exhausted);
          const approved = consent();
          if (
            input.consentVersion !== approved.version ||
            input.consentText !== approved.text
          )
            throw new AppError(
              409,
              "Sutikimo tekstas pasikeitė. Atnaujinkite puslapį ir patvirtinkite sutikimą iš naujo.",
            );
          const c = await tx.claim.create({
            data: {
              sessionId,
              email: input.email,
              purchaseId: eligibility.purchaseId,
              giftId: gifts[0].id,
              box: input.box,
              consentText: approved.text,
              consentVersion: approved.version,
              requestKey: input.requestKey,
              requestHash,
              job: {
                create: {
                  idempotencyKey: `claim:${sessionId}:${input.requestKey}`,
                },
              },
            },
            include: { job: true },
          });
          await tx.gift.update({
            where: { id: gifts[0].id },
            data: { status: "allocated" },
          });
          return publicClaim(c);
        },
        { timeout: 10000 },
      );
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        throw new AppError(
          409,
          "Šiuo el. pašto adresu arba su šiuo pirkimu konkurse jau dalyvauta.",
        );
      if (attempt === 3)
        throw new AppError(
          503,
          "Registracija laikinai užimta. Bandykite dar kartą.",
        );
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
  throw new AppError(503, "Bandykite vėliau.");
}
