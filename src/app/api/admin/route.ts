import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  AppError,
  endpoint,
  originCheck,
  requireAdmin,
  rateLimit,
  jsonBody,
  hash,
  checkPassword,
  passwordHash,
} from "@/lib/security";
import {
  previewInventory,
  importInventory,
  archiveInventory,
} from "@/lib/inventory";
import { integer } from "@/lib/config";
import { cleanup } from "@/lib/reservations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return endpoint(async () => {
    await requireAdmin();
    await cleanup();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").slice(0, 128);
    const status = url.searchParams.get("status") || "";
    if (
      status &&
      ![
        "available",
        "allocated",
        "archived",
        "reserved",
        "pending",
        "assigned",
      ].includes(status)
    )
      throw new AppError(400, "Netinkama būsena.");
    const page = Math.max(
      1,
      Math.min(100000, Math.floor(Number(url.searchParams.get("page")) || 1)),
    );
    const where = {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q } },
              { title: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [rows, total, groups] = await Promise.all([
      db.gift.findMany({
        where,
        skip: (page - 1) * 20,
        take: 20,
        orderBy: { createdAt: "desc" },
      }),
      db.gift.count({ where }),
      db.gift.groupBy({ by: ["status"], _count: true }),
    ]);
    const diagnostics = rows.length
      ? await db.$queryRaw<
          {
            giftId: string;
            status: string;
            safeError: string | null;
            attempts: number;
          }[]
        >`SELECT c."giftId",j.status,j."safeError",j.attempts FROM "AssignmentClaim" c JOIN "AssignmentJob" j ON j."claimId"=c.id WHERE c."giftId" IN (${Prisma.join(rows.map((r) => r.id))}) AND c.status='PENDING_ASSIGNMENT'`
      : [];
    return {
      rows: rows.map((r) => ({
        ...r,
        diagnostic: diagnostics.find((d) => d.giftId === r.id)
          ? "Bandymų: " +
            diagnostics.find((d) => d.giftId === r.id)!.attempts +
            "; " +
            (diagnostics.find((d) => d.giftId === r.id)!.status === "review"
              ? "Reikia IT peržiūros"
              : "Laukiama patvirtinimo") +
            "; " +
            (diagnostics.find((d) => d.giftId === r.id)!.safeError || "")
          : null,
      })),
      total,
      page,
      counts: Object.fromEntries(groups.map((g) => [g.status, g._count])),
    };
  });
}
export async function POST(req: Request) {
  return endpoint(async () => {
    await originCheck(req);
    const body = await jsonBody(
      req,
      integer("CSV_MAX_BYTES", 1048576, 10000000) * 2 + 4096,
    );
    if (body.action === "login") {
      await rateLimit("admin:login:global", 20, 900);
      const parsed = z
        .object({
          username: z.string().trim().min(1).max(100),
          password: z.string().min(1).max(200),
        })
        .safeParse(body);
      if (!parsed.success)
        throw new AppError(400, "Įveskite vardą ir slaptažodį.");
      await rateLimit(`admin:login:${hash(parsed.data.username)}`, 5, 900);
      const admin = await db.admin.findUnique({
        where: { username: parsed.data.username },
      });
      const fallback = passwordHash("unused-timing-password");
      if (
        !checkPassword(parsed.data.password, admin?.passwordHash || fallback) ||
        !admin
      )
        throw new AppError(401, "Neteisingas vardas arba slaptažodis.");
      const token = randomBytes(32).toString("hex");
      await db.adminSession.create({
        data: {
          id: hash(token),
          adminId: admin.id,
          expiresAt: new Date(Date.now() + 8 * 3600000),
        },
      });
      (await cookies()).set("admin", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 8 * 3600,
      });
      return { ok: true };
    }
    const session = await requireAdmin();
    await rateLimit(`admin:${session.adminId}`, 30);
    if (body.action === "logout") {
      await db.adminSession.delete({ where: { id: session.id } });
      (await cookies()).delete("admin");
      return { ok: true };
    }
    if (body.action === "preview" || body.action === "import") {
      if (typeof body.csv !== "string")
        throw new AppError(400, "Pasirinkite CSV failą.");
      if (body.action === "import" && body.confirm !== true)
        throw new AppError(400, "Patvirtinkite importą.");
      return body.action === "preview"
        ? previewInventory(body.csv)
        : importInventory(body.csv);
    }
    if (body.action === "archive") {
      const parsed = z
        .object({
          ids: z.array(z.uuid()).min(1).max(500),
          confirm: z.literal(true),
        })
        .safeParse(body);
      if (!parsed.success)
        throw new AppError(
          400,
          "Pasirinkite eilutes ir patvirtinkite pašalinimą.",
        );
      return archiveInventory([...new Set(parsed.data.ids)]);
    }
    if (body.action === "retry") {
      const p = z.object({ jobId: z.uuid() }).safeParse(body);
      if (!p.success) throw new AppError(400, "Netinkama užduotis.");
      const result = await db.deliveryJob.updateMany({
        where: { id: p.data.jobId, status: "failed" },
        data: {
          status: "pending",
          attempts: 0,
          nextAttemptAt: new Date(),
          safeError: null,
        },
      });
      return { retried: result.count };
    }
    throw new AppError(400, "Netinkama užklausa.");
  });
}
