import { db } from "../src/lib/db";
import { passwordHash } from "../src/lib/security";
import { participationAllowed } from "../src/lib/config";

async function main() {
  if (process.env.HOSTED_DEMO !== "true" || !participationAllowed())
    throw new Error("Protected hosted demo configuration is required.");
  const username = process.env.DEMO_ADMIN_USERNAME || "demo-admin";
  const password = process.env.DEMO_ADMIN_PASSWORD || "";
  if (username.length > 100 || password.length < 14 || password.length > 200)
    throw new Error("Configure a demo administrator password of 14–200 characters.");
  const existing = await db.admin.findUnique({ where: { username } });
  if (!existing) await db.admin.create({ data: { username, passwordHash: passwordHash(password) } });
  console.log("Demo administrator ready; existing credentials preserved.");
}
main().catch(() => { console.error("Demo administrator setup failed. Check configuration."); process.exitCode = 1; })
  .finally(() => db.$disconnect());
