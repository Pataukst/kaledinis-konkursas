import { cleanup } from "../src/lib/reservations";
import { db } from "../src/lib/db";
let stop = false;
process.on("SIGINT", () => {
  stop = true;
});
process.on("SIGTERM", () => {
  stop = true;
});
async function main() {
  while (!stop) {
    try {
      await cleanup();
    } catch {
      console.error("Rezervacijų valymo nepavyko atlikti. Bus kartojama.");
    }
    for (let i = 0; i < 60 && !stop; i++)
      await new Promise((r) => setTimeout(r, 1000));
  }
  await db.$disconnect();
}
main().catch(() => {
  console.error("Rezervacijų valymo darbuotojo nepavyko paleisti.");
  process.exitCode = 1;
});
