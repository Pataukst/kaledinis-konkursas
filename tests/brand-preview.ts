import { chromium, expect } from "@playwright/test";

async function main() {
  const browser = await chromium.launch();
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({
        httpCredentials: { username: "team", password: process.env.SITE_PASSWORD! },
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 },
        reducedMotion: mobile ? "reduce" : "no-preference",
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto("http://localhost:3000");
      await expect(page.locator(".progress")).toHaveCount(0);
      await expect(page.getByText(/ŽINGSNIS IŠ/)).toHaveCount(0);
      await expect(page.getByLabel("Dovanų kupono brūkšninis kodas")).toBeVisible();
      const name = mobile ? "mobile" : "desktop";
      await page.screenshot({ path: `test-results/brand-${name}-home.png`, fullPage: true });
      await page.getByLabel("Dovanų kupono brūkšninis kodas").fill("DEMO-ORDER-098");
      await page.getByLabel("Pirkimo data").fill("2026-10-01");
      await page.getByRole("button", { name: "Tęsti", exact: true }).click();
      await expect(page.getByRole("button", { name: "Dovana 1", exact: true })).toBeVisible();
      await expect(page.locator(".gift-label")).toHaveCount(0);
      await expect(page.getByText(/Dovana rezervuota iki/)).toHaveCount(0);
      await page.screenshot({ path: `test-results/brand-${name}-boxes.png`, fullPage: true });
      await page.getByRole("button", { name: "Dovana 2", exact: true }).click();
      if (!mobile) {
        await expect(page.locator(".presents")).toHaveClass(/opening/);
        await expect(page.locator(".fireworks i")).toHaveCount(24);
      }
      const details = page.getByRole("dialog", { name: "Dar vienas žingsnis iki dovanos" });
      await expect(details).toBeVisible();
      await expect(page.getByRole("checkbox")).not.toBeChecked();
      await expect(page.locator("#contest-consent-text")).toHaveText("Susipažinau su privatumo politika ir sutinku gauti naujienlaiškius el. paštu.");
      await page.getByLabel("Gavėjo el. paštas").fill("preview@example.com");
      await details.getByRole("link", { name: "privatumo politika", exact: true }).click();
      const policy = page.getByRole("dialog", { name: "Privatumo politika", exact: true });
      await expect(policy).toBeVisible();
      await expect(policy.getByRole("heading", { level: 3 })).toHaveCount(12);
      await expect(policy.locator(".policy-source")).toHaveCount(0);
      await expect(page.locator("#contest-consent")).not.toBeChecked();
      await page.screenshot({ path: `test-results/brand-${name}-policy.png` });
      await page.keyboard.press("Escape");
      await expect(policy).not.toBeVisible();
      await details.getByRole("link", { name: "privatumo politika", exact: true }).click();
      await page.mouse.click(3, 3);
      await expect(policy).not.toBeVisible();
      await expect(details).toBeVisible();
      await expect(page.getByLabel("Gavėjo el. paštas")).toHaveValue("preview@example.com");
      await page.screenshot({ path: `test-results/brand-${name}-email.png` });
      await page.getByRole("button", { name: "Gauti dovaną", exact: true }).click();
      await expect(page.locator("#consent-error")).toBeVisible();
      await page.getByRole("button", { name: "Keisti dėžutę" }).click();
      await page.getByRole("button", { name: "Atgal", exact: true }).click();
      await expect(page.getByLabel("Dovanų kupono brūkšninis kodas")).toBeVisible();
      await page.route("**/api/contest", async route => {
        const request = route.request();
        if (request.method() !== "POST") return route.continue();
        const body = request.postDataJSON();
        if (body.action === "validate") return route.fulfill({ json: {
          eligible: true, serverTime: new Date().toISOString(),
          reservation: { id: crypto.randomUUID(), validationId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 43200000).toISOString() },
        } });
        if (body.action === "claim") return route.fulfill({ json: {
          id: crypto.randomUUID(), email: body.input.email, status: "PENDING_ASSIGNMENT",
          delayed: true, giftTitle: "Poilsis dviem", box: body.input.box,
        } });
        return route.continue();
      });
      await page.getByLabel("Dovanų kupono brūkšninis kodas").fill("DEMO-ORDER-098");
      await page.getByLabel("Pirkimo data").fill("2026-10-01");
      await page.getByRole("button", { name: "Tęsti", exact: true }).click();
      await page.getByRole("button", { name: "Dovana 4", exact: true }).click();
      await expect(details).toBeVisible();
      await expect(details.getByText("Dovana jau pakeliui į jūsų el. pašto dėžutę")).toBeVisible();
      await page.getByLabel("Gavėjo el. paštas").fill("preview@example.com");
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Gauti dovaną", exact: true }).click();
      await expect(page.locator(".delivery-message")).toHaveText("Sveikiname, jūsų dovana Poilsis dviem jau pakeliui į jūsų pašto dėžutę");
      await expect(page.locator(".delivery-present")).toHaveClass(/p4/);
      await expect(page.getByRole("button", { name: "Atnaujinti būseną" })).toHaveCount(0);
      await page.screenshot({ path: `test-results/brand-${name}-result.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) throw new Error(`${name}: horizontal overflow`);
      if (errors.length) throw new Error(errors.join("\n"));
      console.log(`${name}: dialogs, consent, policy, animation and navigation passed.`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

