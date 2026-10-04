import { chromium, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { db } from "../src/lib/db";
import { passwordHash } from "../src/lib/security";
import { vilniusDate } from "../src/lib/validation";
async function main() {
  if (
    process.env.RUN_DATABASE_TESTS !== "1" ||
    !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")
  )
    throw new Error(
      "Naršyklės testui reikia atskiros *_test bazės ir RUN_DATABASE_TESTS=1.",
    );
  const base = process.env.TEST_BASE_URL || "http://localhost:3001";
  await db.$executeRawUnsafe(
    'TRUNCATE "DeliveryJob","Claim","Eligibility","Visitor","Gift","AdminSession","Admin","RateLimit" CASCADE',
  );
  await db.gift.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({
      code: `SMOKE-FAKE-${i}`,
      title: "Netikra testinė dovana",
    })),
  });
  const username = `test-${randomUUID()}`,
    password = randomBytes(24).toString("hex");
  const admin = await db.admin.create({
    data: { username, passwordHash: passwordHash(password) },
  });
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  await mkdir("test-results", { recursive: true });
  try {
    const unauthorized = await browser.newContext();
    assertStatus(
      await unauthorized.request.post(`${base}/api/admin`, {
        headers: { Origin: base },
        data: { action: "import", csv: "", confirm: true },
      }),
      401,
    );
    assertStatus(
      await unauthorized.request.post(`${base}/api/admin`, {
        headers: { Origin: base },
        data: { action: "archive", ids: [], confirm: true },
      }),
      401,
    );
    assertStatus(
      await unauthorized.request.post(`${base}/api/admin`, {
        headers: { Origin: "https://untrusted.example" },
        data: { action: "login", username, password },
      }),
      403,
    );
    await unauthorized.request.get(`${base}/api/contest`);
    const bypass = await unauthorized.request.post(`${base}/api/contest`, {
      headers: { Origin: base },
      data: {
        action: "claim",
        input: {
          email: "bypass@example.lt",
          box: 1,
          consent: true,
          consentVersion: "dev-1",
          consentText: "Sutinku gauti naujienlaiškius el. paštu.",
          requestKey: randomUUID(),
        },
      },
    });
    assertStatus(bypass, 403);
    await unauthorized.close();
    const channels = [
      "Internete",
      "Mūsų parduotuvėje",
      "Pas prekybos partnerį",
    ];
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({
        viewport:
          i === 2 ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => pageErrors.push(e.message));
      await page.goto(base);
      await expect(page.getByRole("button", { name: "Tęsti" })).toBeEnabled();
      await page
        .getByRole("button", { name: channels[i], exact: true })
        .click();
      await page.getByRole("button", { name: "Tęsti" }).click();
      const fixture = `TEST-00${i + 1}`;
      if (i === 0) {
        await page.getByLabel("Užsakymo numeris").fill("INVALID");
        await page.getByLabel("Pirkėjo el. paštas").fill("buyer@example.lt");
        await page.getByRole("button", { name: "Tęsti" }).click();
        await expect(page.locator(".error[role=alert]")).toContainText(
          "Patikrinkite",
        );
        await expect(
          page.getByRole("button", { name: "Dovana 1", exact: true }),
        ).toHaveCount(0);
        await page.getByLabel("Užsakymo numeris").fill(fixture);
      } else {
        await page.getByLabel("Dovanų kupono brūkšninis kodas").fill(fixture);
        if (i === 1)
          await page.getByLabel("Kasos kvito numeris").fill("000123");
        else await page.getByLabel("Pirkimo data").fill(vilniusDate());
      }
      await page.getByRole("button", { name: "Tęsti" }).click();
      await expect(
        page.getByRole("heading", { name: "Pasirinkite savo kalėdinę dovaną" }),
      ).toBeVisible();
      await expect(page.locator(".present")).toHaveCount(5);
      for (const button of await page.locator(".present").all())
        await expect(button).toBeInViewport();
      await page.getByRole("button", { name: "Dovana 3", exact: true }).focus();
      await page.keyboard.press("Space");
      await expect(
        page.getByRole("button", { name: "Dovana 3", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("checkbox")).not.toBeChecked();
      await page
        .getByLabel("Jūsų el. paštas")
        .fill(`recipient-${i}@example.lt`);
      await page.getByRole("button", { name: "Gauti dovaną" }).click();
      await expect(page.locator("#consent-error")).toBeVisible();
      await page.getByRole("checkbox").check();
      await page.screenshot({
        path: `test-results/customer-${i}.png`,
        fullPage: true,
      });
      const finalResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/contest") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Gauti dovaną" }).click();
      const response = await finalResponse;
      const text = await response.text();
      if (text.includes("SMOKE-FAKE"))
        throw new Error("Viešas atsakymas atskleidė kodą.");
      await expect(
        page.getByRole("heading", { name: "Ačiū, kad dalyvaujate!" }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Ačiū, kad dalyvaujate!" }),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      if (overflow) throw new Error("Mobilus puslapis slenka horizontaliai.");
      await context.close();
      console.log(`Patikrintas kanalas: ${channels[i]}`);
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${base}/admin`);
    await page.getByLabel("Administratoriaus vardas").fill(username);
    await page.getByLabel("Slaptažodis").fill(password);
    await page
      .getByRole("button", { name: "Prisijungti", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Dovanų sąrašas" }),
    ).toBeVisible();
    const upload =
      'dovanos_kodas;dovanos_pavadinimas\n0000099;"Lietuviška, netikra dovana"';
    await page
      .getByLabel("CSV failas (UTF-8)")
      .setInputFiles({
        name: "test.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(upload),
      });
    await expect(page.getByText("Iš viso: 1. Klaidos: 0.")).toBeVisible();
    await page.getByRole("button", { name: "Importuoti 1 dovanų" }).click();
    await page
      .getByRole("button", { name: "Patvirtinti", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Importuota: 1");
    await page
      .getByRole("checkbox", { name: "Pasirinkti kodą 0000099", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Pašalinti pasirinktas (1)" })
      .click();
    await page
      .getByRole("button", { name: "Patvirtinti", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Pašalinta: 1");
    const g = await db.gift.findUniqueOrThrow({ where: { code: "0000099" } });
    if (g.status !== "archived") throw new Error("Kodas nearchyvuotas.");
    await page.screenshot({ path: "test-results/admin.png", fullPage: true });
    await context.close();
    if ((await db.claim.count()) !== 3)
      throw new Error("Perkrovimas sukūrė papildomą registraciją.");
    if (pageErrors.length) throw new Error(pageErrors.join("\n"));
    console.log(
      "Patikrinta administravimo autentifikacija, CSV importas, pašalinimas ir CSRF apsauga.",
    );
  } finally {
    await browser.close();
    await db.admin.delete({ where: { id: admin.id } });
    await db.$disconnect();
  }
}
function assertStatus(response: { status(): number }, status: number) {
  if (response.status() !== status)
    throw new Error(`Tikėtasi HTTP ${status}, gauta ${response.status()}`);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
