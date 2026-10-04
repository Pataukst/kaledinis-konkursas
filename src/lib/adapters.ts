import { setTimeout as delay } from "node:timers/promises";
// Node-only adapter module; never import into a client component.
import type { Purchase } from "./validation";
export type ValidationResult =
  | { outcome: "valid"; purchaseId: string }
  | { outcome: "invalid" }
  | { outcome: "error"; reason: "timeout" | "unavailable" | "unconfigured" };
export type DeliveryRequest = {
  recipientEmail: string;
  giftCode: string;
  claimId: string;
  idempotencyKey: string;
};
export type DeliveryResult =
  | { outcome: "accepted" }
  | { outcome: "error"; reason: "timeout" | "unavailable" | "unconfigured" };
// Application-owned contract. Map to documented internal request/response fields here later.
export async function realPurchase(
  _input: Purchase,
): Promise<ValidationResult> {
  return { outcome: "error", reason: "unconfigured" };
}
export async function realDelivery(
  _input: DeliveryRequest,
): Promise<DeliveryResult> {
  return { outcome: "error", reason: "unconfigured" };
}
export async function mockPurchase(input: Purchase): Promise<ValidationResult> {
  await delay(50);
  const key = input.channel === "online" ? input.orderNumber : input.barcode;
  if (key === "TIMEOUT") return { outcome: "error", reason: "timeout" };
  if (key === "UNAVAILABLE") return { outcome: "error", reason: "unavailable" };
  if (!/^TEST-00[1-9]$/.test(key)) return { outcome: "invalid" };
  if (input.channel === "shop" && input.receiptNumber !== "000123")
    return { outcome: "invalid" };
  return { outcome: "valid", purchaseId: `fixture:${key}` };
}
export async function mockDelivery(
  _input: DeliveryRequest,
): Promise<DeliveryResult> {
  return process.env.MOCK_DELIVERY === "failed"
    ? { outcome: "error", reason: "unavailable" }
    : { outcome: "accepted" };
}
export async function validatePurchase(input: Purchase) {
  return process.env.PURCHASE_ADAPTER === "mock"
    ? mockPurchase(input)
    : realPurchase(input);
}
export async function deliver(input: DeliveryRequest) {
  return process.env.DELIVERY_ADAPTER === "mock"
    ? mockDelivery(input)
    : realDelivery(input);
}
// Newsletter synchronization is pending. Saved consent does not imply mailing-list membership.
export type NewsletterConsentMapping = {
  email: string;
  text: string;
  version: string;
  acceptedAt: Date;
};
