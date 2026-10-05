import { processAssignment } from "../src/lib/assignment-worker";
import { db } from "../src/lib/db";
import { integer, participationAllowed } from "../src/lib/config";
let stop = false;
process.on("SIGINT", () => (stop = true));
process.on("SIGTERM", () => (stop = true));
async function main() {
  if (!participationAllowed())
    throw new Error("Darbuotojas sustabdytas: integracijos neparuoštos.");
  while (!stop) {
    try {
      const worked = await processAssignment();
      if (!worked)
        await new Promise((r) =>
          setTimeout(r, integer("WORKER_POLL_MS", 1000, 60000)),
        );
    } catch {
      console.error("Dovanos priskyrimo užduoties nepavyko apdoroti.");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await db.$disconnect();
}
main().catch(() => {
  console.error("Darbuotojo nepavyko paleisti. Patikrinkite konfigūraciją.");
  process.exitCode = 1;
});
