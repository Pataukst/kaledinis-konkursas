import { z } from "zod";
import { validDate } from "./validation";
export const validationRequestSchema = z
  .object({
    customerIp: z.ipv4().or(z.ipv6()),
    barcode: z.string().min(1).max(128),
    activationDate: z
      .string()
      .max(10)
      .refine((s) => validDate(s)),
  })
  .strict();
export const validationResponseSchema = z.discriminatedUnion("validation", [
  z.object({ validation: z.literal(true), customerGuid: z.uuid() }).strict(),
  z
    .object({
      validation: z.literal(false),
      customerGuid: z.null(),
      errorCode: z.literal("PURCHASE_NOT_VALID"),
    })
    .strict(),
]);
export const assignmentRequestSchema = z
  .object({
    customerGuid: z.uuid(),
    giftId: z.string().min(1).max(128),
  })
  .strict();
export const assignmentResponseSchema = z.union([
  z
    .object({
      status: z.literal("OK"),
      customerGuid: z.uuid(),
      giftId: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      status: z.literal("Failure"),
      errorCode: z.literal("ASSIGNMENT_REJECTED"),
      retryable: z.literal(false),
    })
    .strict(),
]);
export type ValidationRequest = z.infer<typeof validationRequestSchema>;
export type AssignmentRequest = z.infer<typeof assignmentRequestSchema>;
