import { db } from "@/lib/db";
import {
  endpoint,
  visitor,
  originCheck,
  rateLimit,
  jsonBody,
  AppError,
  hash,
} from "@/lib/security";
import { purchaseSchema } from "@/lib/validation";
import { validatePurchase } from "@/lib/server-adapters";
import { integer, participationAllowed, isMock, consent } from "@/lib/config";
import { createClaim, publicClaim } from "@/lib/claims";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () => {
    await rateLimit("bootstrap:global", 1200);
    const s = await visitor(true);
    const claim = await db.claim.findFirst({
      where: { sessionId: s.id },
      orderBy: { createdAt: "desc" },
      include: { job: true },
    });
    const e = await db.eligibility.findUnique({ where: { sessionId: s.id } });
    return {
      mock: isMock(),
      allowed: participationAllowed(),
      consent: consent(),
      maxLength: integer("IDENTIFIER_MAX_LENGTH", 128, 1024),
      eligible: !!e && e.expiresAt > new Date(),
      channel: e?.channel,
      claim: claim ? publicClaim(claim) : null,
    };
  });
}
export async function POST(req: Request) {
  return endpoint(async () => {
    await originCheck(req);
    const s = await visitor();
    await rateLimit(`contest:${s.id}`, 20);
    await rateLimit("contest:global", 300);
    if (!participationAllowed())
      throw new AppError(
        503,
        "Dalyvavimas šiuo metu negalimas: integracijos neparuoštos.",
      );
    const body = await jsonBody(req);
    if (body.action === "claim") return createClaim(s.id, body.input);
    if (body.action === "invalidate") {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id=${s.id} FOR UPDATE`;
        await tx.eligibility.deleteMany({ where: { sessionId: s.id } });
      });
      return { eligible: false };
    }
    if (body.action !== "validate")
      throw new AppError(400, "Netinkama užklausa.");
    // Each validation generation invalidates the old eligibility before any API call.
    const nonce = crypto.randomUUID();
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id=${s.id} FOR UPDATE`;
      await tx.eligibility.upsert({
        where: { sessionId: s.id },
        create: {
          sessionId: s.id,
          purchaseId: "pending",
          channel: "pending",
          fingerprint: nonce,
          expiresAt: new Date(0),
        },
        update: {
          purchaseId: "pending",
          channel: "pending",
          fingerprint: nonce,
          expiresAt: new Date(0),
        },
      });
    });
    const parsed = purchaseSchema(
      integer("IDENTIFIER_MAX_LENGTH", 128, 1024),
    ).safeParse(body.input);
    if (!parsed.success)
      throw new AppError(
        400,
        "Patikrinkite įvestus pirkimo duomenis.",
        Object.fromEntries(
          parsed.error.issues.map((i) => [String(i.path[0]), i.message]),
        ),
      );
    const result = await validatePurchase(parsed.data);
    if (result.outcome === "invalid")
      throw new AppError(
        422,
        "Patikrinkite įvestus pirkimo duomenis ir bandykite dar kartą.",
      );
    if (result.outcome === "error")
      throw new AppError(
        503,
        result.reason === "unconfigured"
          ? "Pirkimo tikrinimo integracija nesukonfigūruota."
          : "Šiuo metu nepavyksta patikrinti pirkimo. Bandykite vėliau.",
      );
    const updated = await db.eligibility.updateMany({
      where: { sessionId: s.id, fingerprint: nonce },
      data: {
        purchaseId: result.purchaseId,
        channel: parsed.data.channel,
        fingerprint: hash(JSON.stringify(parsed.data)),
        expiresAt: new Date(
          Date.now() + integer("ELIGIBILITY_MINUTES", 30, 1440) * 60000,
        ),
      },
    });
    if (!updated.count)
      throw new AppError(
        409,
        "Duomenys pasikeitė. Patikrinkite pirkimą iš naujo.",
      );
    return { eligible: true };
  });
}
