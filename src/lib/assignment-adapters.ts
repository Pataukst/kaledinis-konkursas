import { createHash } from "node:crypto";
import { db } from "./db";
import { mockEnvironmentAllowed } from "./config";
import {
  assignmentRequestSchema,
  assignmentResponseSchema,
  validationRequestSchema,
  validationResponseSchema,
  type AssignmentRequest,
  type ValidationRequest,
} from "./api-contract";
export type ApiError =
  | "timeout"
  | "unavailable"
  | "unconfigured"
  | "malformed"
  | "mismatch"
  | "throttled";
export type ValidationOutcome =
  | { kind: "valid"; customerGuid: string }
  | { kind: "invalid" }
  | { kind: "error"; code: ApiError };
export type AssignmentOutcome =
  | { kind: "ok" }
  | { kind: "rejected"; code: "ASSIGNMENT_REJECTED" }
  | { kind: "unknown"; code: ApiError };
const mockAllowed = mockEnvironmentAllowed;
export function stableGuid(barcode: string) {
  const h = createHash("sha256").update(barcode).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function checkPurchase(
  input: ValidationRequest,
): Promise<ValidationOutcome> {
  validationRequestSchema.parse(input);
  if (process.env.PURCHASE_ADAPTER !== "mock" || !mockAllowed())
    return { kind: "error", code: "unconfigured" };
  if (input.barcode === "TIMEOUT") return { kind: "error", code: "timeout" };
  if (input.barcode === "UNAVAILABLE")
    return { kind: "error", code: "unavailable" };
  if (/^DEMO-ORDER-\d{3}$/.test(input.barcode)) {
    const orders = await db.$queryRaw<{ barcode: string }[]>`
      SELECT barcode FROM "DemoOrder"
      WHERE barcode=${input.barcode} AND "purchaseDate"=${input.activationDate}`;
    return orders.length
      ? { kind: "valid", customerGuid: stableGuid(input.barcode) }
      : { kind: "invalid" };
  }
  const response: unknown =
    input.barcode === "MALFORMED"
      ? { validation: true, customerGuid: "" }
      : /^(TEST-00[1-9]|0001234567890)$/.test(input.barcode)
        ? { validation: true, customerGuid: stableGuid(input.barcode) }
        : {
            validation: false,
            customerGuid: null,
            errorCode: "PURCHASE_NOT_VALID",
          };
  const p = validationResponseSchema.safeParse(response);
  if (!p.success) return { kind: "error", code: "malformed" };
  return p.data.validation
    ? { kind: "valid", customerGuid: p.data.customerGuid }
    : { kind: "invalid" };
}
export function classifyAssignment(
  response: unknown,
  input: AssignmentRequest,
): AssignmentOutcome {
  const p = assignmentResponseSchema.safeParse(response);
  if (!p.success) return { kind: "unknown", code: "malformed" };
  if (p.data.status === "Failure")
    return { kind: "rejected", code: p.data.errorCode };
  if (
    p.data.customerGuid !== input.customerGuid ||
    p.data.giftId !== input.giftId
  )
    return { kind: "unknown", code: "mismatch" };
  return { kind: "ok" };
}
export async function assignGift(
  input: AssignmentRequest,
  key: string,
): Promise<AssignmentOutcome> {
  assignmentRequestSchema.parse(input);
  // Replaceable real adapter deliberately has no URL/authentication until IT confirms the contract.
  if (process.env.DELIVERY_ADAPTER !== "mock" || !mockAllowed())
    return { kind: "unknown", code: "unconfigured" };
  const mode = process.env.MOCK_ASSIGNMENT || "ok";
  if (mode === "timeout-before") return { kind: "unknown", code: "timeout" };
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(730125)::text`;
    const prior = await tx.$queryRaw<
      { payload: string; response: unknown }[]
    >`SELECT payload,response FROM "MockAssignment" WHERE key=${key}`;
    const payload = JSON.stringify(input);
    if (prior[0])
      return prior[0].payload === payload ? prior[0].response : null;
    const duplicate = await tx.$queryRaw<
      { key: string }[]
    >`SELECT key FROM "MockAssignment" WHERE "giftId"=${input.giftId}`;
    const rejected = mode === "failure" || duplicate.length > 0;
    let response: unknown = rejected
      ? {
          status: "Failure",
          errorCode: "ASSIGNMENT_REJECTED",
          retryable: false,
        }
      : { status: "OK", ...input };
    if (mode === "malformed") response = { status: "OK" };
    if (mode === "swapped-guid")
      response = {
        status: "OK",
        ...input,
        customerGuid: stableGuid("swapped"),
      };
    if (mode === "swapped-gift")
      response = { status: "OK", ...input, giftId: "SWAPPED" };
    await tx.$executeRaw`INSERT INTO "MockAssignment" (key,payload,response,"giftId") VALUES (${key},${payload},${JSON.stringify(response)}::jsonb,${rejected ? null : input.giftId})`;
    return response;
  });
  if (mode === "timeout-after") {
    // First processing loses the response; a repeat returns the persisted original outcome.
    const rows = await db.$queryRaw<
      { attempts: number }[]
    >`SELECT attempts FROM "AssignmentJob" WHERE "idempotencyKey"=${key}`;
    if (rows[0]?.attempts === 1) return { kind: "unknown", code: "timeout" };
  }
  return classifyAssignment(result, input);
}
