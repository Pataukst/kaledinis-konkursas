import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

process.env.NODE_ENV = "production";
process.env.APP_ORIGIN ||= process.env.RENDER_EXTERNAL_URL;
const env = process.env;
if (env.HOSTED_DEMO !== "true" || env.PURCHASE_ADAPTER !== "mock" ||
    env.DELIVERY_ADAPTER !== "mock" || (env.SITE_PASSWORD?.length ?? 0) < 14 ||
    !env.APP_ORIGIN?.startsWith("https://") || !env.DATABASE_URL ||
    (env.AUDIT_HMAC_KEY?.length ?? 0) < 32 ||
    (env.DEMO_ADMIN_PASSWORD?.length ?? 0) < 14) {
  console.error("Hosted demo requires HTTPS origin, database, mock adapters, shared/admin passwords and audit key. See docs/RENDER_NEON.md.");
  process.exit(1);
}

const root = fileURLToPath(new URL("../", import.meta.url));
function run(args, overrides = {}) {
  return spawn(process.execPath, args, { cwd: root, env: { ...env, ...overrides }, stdio: "inherit" });
}
async function setup(args, overrides) {
  const child = run(args, overrides);
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error("Hosted setup step failed.")));
  });
}
try {
  await setup(["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { DATABASE_URL: env.MIGRATION_DATABASE_URL || env.DATABASE_URL });
  await setup(["node_modules/tsx/dist/cli.mjs", "scripts/seed-team.ts"]);
  await setup(["node_modules/tsx/dist/cli.mjs", "scripts/hosted-admin.ts"]);
} catch {
  console.error("Hosted demo setup failed; website was not started.");
  process.exit(1);
}

const children = [
  run([resolve(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "0.0.0.0", "--port", env.PORT || "10000"]),
  run(["node_modules/tsx/dist/cli.mjs", "scripts/worker.ts"]),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 8000);
  Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve() : new Promise(resolve => child.once("exit", resolve))))
    .then(() => { clearTimeout(timer); process.exit(code); });
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
for (const child of children) {
  child.on("error", () => stop(1));
  child.on("exit", () => { if (!stopping) stop(1); });
}
