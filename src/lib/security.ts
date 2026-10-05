import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { audit } from "./audit";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function checkPassword(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  const a = scryptSync(password, salt, 64);
  const b = Buffer.from(digest, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function originCheck(req: Request) {
  if (
    req.headers.get("origin") !==
    new URL(process.env.APP_ORIGIN || "http://localhost:3000").origin
  )
    throw new AppError(403, "Užklausa neleidžiama.");
}
export async function rateLimit(key: string, limit: number, seconds = 60) {
  const rows = await db.$queryRaw<
    { count: number }[]
  >`INSERT INTO "RateLimit" ("key","count","resetAt") VALUES (${key},1, NOW()+${seconds}*INTERVAL '1 second') ON CONFLICT ("key") DO UPDATE SET "count"=CASE WHEN "RateLimit"."resetAt"<NOW() THEN 1 ELSE "RateLimit"."count"+1 END,"resetAt"=CASE WHEN "RateLimit"."resetAt"<NOW() THEN NOW()+${seconds}*INTERVAL '1 second' ELSE "RateLimit"."resetAt" END RETURNING "count"`;
  if (rows[0].count > limit)
    throw new AppError(429, "Per daug bandymų. Palaukite ir bandykite vėliau.");
}
export async function visitor(create = false) {
  const jar = await cookies();
  const token = jar.get("visitor")?.value;
  const session = token
    ? await db.visitor.findUnique({ where: { id: hash(token) } })
    : null;
  if (session && session.expiresAt > new Date()) return session;
  if (!create) {
    await audit(db, "authorization.rejected", {
      scope: "visitor",
      safeError: "SESSION_NOT_VALID",
    });
    throw new AppError(401, "Sesija baigėsi. Pradėkite iš naujo.");
  }
  const raw = randomBytes(32).toString("hex");
  const v = await db.visitor.create({
    data: { id: hash(raw), expiresAt: new Date(Date.now() + 86400000) },
  });
  jar.set("visitor", raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 86400,
  });
  return v;
}
export async function requireAdmin() {
  const raw = (await cookies()).get("admin")?.value;
  if (!raw) {
    await audit(db, "authorization.rejected", {
      scope: "admin",
      safeError: "SESSION_MISSING",
    });
    throw new AppError(401, "Prisijunkite prie administravimo.");
  }
  const s = await db.adminSession.findUnique({ where: { id: hash(raw) } });
  if (!s || s.expiresAt < new Date()) {
    await audit(db, "authorization.rejected", {
      scope: "admin",
      safeError: "SESSION_NOT_VALID",
    });
    throw new AppError(401, "Sesija baigėsi. Prisijunkite iš naujo.");
  }
  return s;
}
export async function jsonBody(req: Request, max = 16384) {
  const reader = req.body?.getReader();
  if (!reader) throw new AppError(400, "Trūksta duomenų.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError(413, "Duomenų kiekis per didelis.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "Netinkami duomenys.");
  }
}
export async function endpoint(fn: () => Promise<unknown>) {
  try {
    return Response.json(await fn(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof AppError)
      return Response.json(
        { error: e.message, fields: e.fields },
        { status: e.status },
      );
    return Response.json(
      { error: "Šiuo metu užklausos įvykdyti nepavyksta. Bandykite vėliau." },
      { status: 503 },
    );
  }
}
