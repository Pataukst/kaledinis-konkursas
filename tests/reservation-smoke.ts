import { chromium, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { passwordHash } from "../src/lib/security";
import { processAssignment } from "../src/lib/assignment-worker";
import { vilniusDate } from "../src/lib/validation";
import { mkdir } from "node:fs/promises";
async function main() {
  if (
    process.env.RUN_DATABASE_TESTS !== "1" ||
    !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")
  )
    throw new Error("Naršyklės testui būtina atskira *_test bazė.");
  const base = process.env.TEST_BASE_URL || "http://localhost:3001";
  await db.$executeRawUnsafe(
    'TRUNCATE "AssignmentJob","AssignmentClaim","MockAssignment","Reservation","PurchaseValidation","Flow","DeliveryJob","Claim","Eligibility","Visitor","Gift","AdminSession","Admin","RateLimit" CASCADE',
  );
  await db.gift.createMany({
    data: Array.from({ length: 4 }, (_, i) => ({
      code: "BROWSER-FAKE-" + i,
      title: "Netikra dovana",
    })),
  });
  const username = "smoke-" + randomUUID(),
    password = randomBytes(24).toString("hex");
  await db.admin.create({
    data: { username, passwordHash: passwordHash(password) },
  });
  const browser = await chromium.launch();
  const errors: string[] = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await expect(
      page.getByLabel("Dovanų kupono brūkšninis kodas"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Internete", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Dovanų kupono brūkšninis kodas").fill("MALFORMED");
    await page.getByLabel("Pirkimo data").fill(vilniusDate());
    await page.getByRole("button", { name: "Tęsti", exact: true }).click();
    await expect(page.locator(".error[role=alert]")).toContainText("paslauga");
    await page.getByLabel("Dovanų kupono brūkšninis kodas").fill("TEST-001");
    await page.getByRole("button", { name: "Tęsti", exact: true }).click();
    await expect(
      page.getByText("Dovana rezervuota iki", { exact: false }),
    ).toBeVisible();
    const before = await context.request.get(base + "/api/contest");
    const first = await before.json();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Dovana 1", exact: true }),
    ).toBeVisible();
    expect(
      (await (await context.request.get(base + "/api/contest")).json())
        .reservation,
    ).toEqual(first.reservation);
    await page.getByRole("button", { name: "Dovana 1", exact: true }).click();
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await page.getByLabel("Gavėjo el. paštas").fill("Chosen+gift@Example.lt");
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Gauti dovaną", exact: true })
      .click();
    await expect(
      page.getByText(
        "Jūsų registracija išsaugota. Dovanos priskyrimas tikrinamas.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Ačiū, kad dalyvaujate!" }),
    ).toBeVisible();
    await processAssignment();
    await page.getByRole("button", { name: "Atnaujinti būseną" }).click();
    await expect(
      page.getByText("Dovana priskirta. Gavėjo el. paštas išsaugotas."),
    ).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("BROWSER-FAKE-");
    expect(html).not.toContain("customerGuid");
    const stranger = await browser.newContext();
    expect((await stranger.request.get(base + "/api/admin")).status()).toBe(
      401,
    );
    expect((await stranger.request.get(base + "/api/audit")).status()).toBe(
      404,
    );
    expect(
      (
        await stranger.request.post(base + "/api/admin", {
          headers: { Origin: base },
          data: {
            action: "archive",
            confirm: true,
            ids: [(await db.gift.findFirstOrThrow()).id],
          },
        })
      ).status(),
    ).toBe(401);
    await stranger.close();
    const abandoned = await browser.newContext();
    const expiry = await abandoned.newPage();
    await expiry.goto(base);
    await expiry.getByLabel("Dovanų kupono brūkšninis kodas").fill("TEST-002");
    await expiry.getByLabel("Pirkimo data").fill(vilniusDate());
    await expiry.getByRole("button", { name: "Tęsti", exact: true }).click();
    await expect(
      expiry.getByRole("button", { name: "Dovana 1", exact: true }),
    ).toBeVisible();
    const state = await (
      await abandoned.request.get(base + "/api/contest")
    ).json();
    // Test-only DB fixture: keep the exact 12-hour invariant while moving the entire reservation into the past.
    await db.$transaction(async (tx) => {
      // Only the guarded *_test database owner may prepare this past-time browser fixture.
      // The table lock and transactional DDL prevent another connection seeing disabled history protection.
      await tx.$executeRawUnsafe(
        'ALTER TABLE "Reservation" DISABLE TRIGGER protect_reservation_history',
      );
      await tx.$executeRaw`UPDATE "Reservation" SET "reservedAt"=NOW()-INTERVAL '12 hours 1 second',"expiresAt"=NOW()-INTERVAL '1 second' WHERE id=${state.reservation.id}`;
      await tx.$executeRawUnsafe(
        'ALTER TABLE "Reservation" ENABLE TRIGGER protect_reservation_history',
      );
    });
    await expiry.reload();
    await expect(
      expiry.getByLabel("Dovanų kupono brūkšninis kodas"),
    ).toBeVisible();
    await expect(expiry.locator(".error[role=alert]")).toContainText(
      "rezervacijos laikas baigėsi",
    );
    for (const [barcode, pending] of [
      ["TEST-003", true],
      ["TEST-004", false],
    ] as const) {
      const customer = await browser.newContext();
      await customer.request.get(base + "/api/contest");
      const response = await customer.request.post(base + "/api/contest", {
        headers: { Origin: base },
        data: {
          action: "validate",
          input: { barcode, purchaseDate: vilniusDate() },
        },
      });
      const data = await response.json();
      expect(response.status()).toBe(200);
      if (pending) {
        const claim = await customer.request.post(base + "/api/contest", {
          headers: { Origin: base },
          data: {
            action: "claim",
            input: {
              reservationId: data.reservation.id,
              validationId: data.reservation.validationId,
              email: "pending@example.lt",
              box: 2,
              consent: true,
              consentText:
                process.env.CONSENT_TEXT ||
                "Sutinku gauti naujienlaiškius el. paštu.",
              consentVersion: process.env.CONSENT_VERSION || "dev-1",
              requestKey: randomUUID(),
            },
          },
        });
        expect(claim.status()).toBe(200);
      }
      await customer.close();
    }
    const admin = await browser.newContext();
    const ap = await admin.newPage();
    await ap.goto(base + "/admin");
    await ap.getByLabel("Administratoriaus vardas").fill(username);
    await ap.getByLabel("Slaptažodis").fill(password);
    await ap.getByRole("button", { name: "Prisijungti", exact: true }).click();
    await expect(ap.locator(".counts")).toContainText("Rezervuota");
    await expect(ap.locator(".counts")).toContainText("Priskyrimas tikrinamas");
    await expect(ap.locator(".counts")).toContainText("Priskirta");
    const inventory = await (
      await admin.request.get(base + "/api/admin")
    ).json();
    expect(inventory.counts.reserved).toBe(1);
    expect(inventory.counts.pending).toBe(1);
    expect(inventory.counts.assigned).toBe(1);
    const protectedIds = inventory.rows
      .filter((r: { status: string }) =>
        ["reserved", "pending", "assigned"].includes(r.status),
      )
      .map((r: { id: string }) => r.id);
    const archive = await admin.request.post(base + "/api/admin", {
      headers: { Origin: base },
      data: { action: "archive", ids: protectedIds, confirm: true },
    });
    expect(archive.status()).toBe(200);
    expect((await archive.json()).removed).toBe(0);
    await mkdir("test-results", { recursive: true });
    await page.screenshot({
      path: "test-results/reservation-result.png",
      fullPage: true,
    });
    await ap.screenshot({
      path: "test-results/reservation-admin.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
    console.log(
      "Naršyklės patikra išlaikyta: pirkimas, rezervacija, atnaujinimas, sutikimas, rezultatas, galiojimas ir administravimas.",
    );
  } finally {
    await browser.close();
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error("Naršyklės patikra nepavyko.");
  process.exitCode = 1;
});
