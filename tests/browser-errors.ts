import { chromium, expect } from "@playwright/test";
import { connectionFailed, invalidResponse } from "../src/lib/client-errors";
async function main() {
  const browser = await chromium.launch();
  try {
    for (const [path, api] of [
      ["/", "/api/contest"],
      ["/admin", "/api/admin**"],
    ]) {
      const page = await browser.newPage();
      await page.route(`**${api}`, (route) => route.abort("failed"));
      await page.goto(`http://localhost:3000${path}`);
      await expect(page.locator(".error[role=alert]")).toHaveText(
        connectionFailed,
      );
      await page.close();
    }
    const page = await browser.newPage();
    await page.route("**/api/contest", (route) =>
      route.fulfill({
        status: 502,
        contentType: "text/html",
        body: "Bad Gateway",
      }),
    );
    await page.goto("http://localhost:3000");
    await expect(page.locator(".error[role=alert]")).toHaveText(
      invalidResponse,
    );
    await page.unroute("**/api/contest");
    await page.goto("http://localhost:3000/nera-tokio-puslapio");
    await expect(
      page.getByRole("heading", { name: "Puslapis nerastas" }),
    ).toBeVisible();
    await page.close();
    console.log(
      "Naršyklėje patikrinti lietuviški kliento ir admin tinklo klaidų, netinkamo atsakymo ir 404 pranešimai.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
