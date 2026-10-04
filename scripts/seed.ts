import { db } from "../src/lib/db";
async function main() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.PURCHASE_ADAPTER !== "mock" ||
    process.env.DELIVERY_ADAPTER !== "mock"
  )
    throw new Error(
      "Testiniai duomenys leidžiami tik kūrimo aplinkoje su abiem imitacijomis.",
    );
  await db.gift.createMany({
    data: Array.from({ length: 25 }, (_, i) => ({
      code: `FAKE-${String(i + 1).padStart(6, "0")}`,
      title: "Testinė dovana (netikra)",
    })),
    skipDuplicates: true,
  });
  console.log("Įkelti tik netikri testiniai kodai.");
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
