import { db } from "../src/lib/db";
import { participationAllowed } from "../src/lib/config";

async function main() {
  if (!participationAllowed())
    throw new Error("Team fixtures require the local mock environment.");
  await db.$transaction(async (tx) => {
    for (let i = 1; i <= 100; i++) {
      const number = String(i).padStart(3, "0");
      const code = `DEMO-PRODUCT-${number}`;
      const title = `Testinė dovana ${number} (netikra)`;
      await tx.gift.createMany({ data: [{ code, title,
        externalGiftId: `DEMO-GIFT-TEAM-${number}` }], skipDuplicates: true });
      await tx.$executeRaw`INSERT INTO "DemoOrder" (barcode, "purchaseDate", "productCode", "productTitle")
        VALUES (${`DEMO-ORDER-${number}`}, '2026-10-01', ${code}, ${title})
        ON CONFLICT (barcode) DO NOTHING`;
    }
  }, { timeout: 30000 });
  console.log("100 demo products and 100 demo orders prepared; existing records preserved.");
}
main().catch(() => { console.error("Team fixture setup failed."); process.exitCode = 1; })
  .finally(() => db.$disconnect());
