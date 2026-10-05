export const demoNotice =
  "Demonstracinis režimas: pirkimo tikrinimas ir dovanos priskyrimas imituojami. Tikri pirkimai netikrinami, el. laiškai nesiunčiami.";
export function integer(name: string, fallback: number, max = 1000000) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > max)
    throw new Error(`Netinkama konfigūracija: ${name}`);
  return n;
}
export function consent() {
  return {
    text:
      process.env.CONSENT_TEXT || "Sutinku gauti naujienlaiškius el. paštu.",
    version: process.env.CONSENT_VERSION || "dev-1",
  };
}
export function isMock() {
  return (
    process.env.PURCHASE_ADAPTER === "mock" ||
    process.env.DELIVERY_ADAPTER === "mock"
  );
}
// Real adapters remain deliberately unconfigured until approved API mappings are implemented.
export function participationAllowed() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.PURCHASE_ADAPTER === "mock" &&
    process.env.DELIVERY_ADAPTER === "mock"
  );
}
