import { randomUUID, createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { integer } from "./config";
export type Tx = Prisma.TransactionClient;
// Only server-created, allowlisted summaries are accepted. No raw request/response dumps.
export function token(value: string) {
  const key = process.env.AUDIT_HMAC_KEY;
  if (!key) throw new Error("Trūksta AUDIT_HMAC_KEY.");
  return createHmac("sha256", key).update(value).digest("hex");
}
export async function audit(
  tx: Tx | typeof db,
  event: string,
  metadata: Record<string, unknown>,
  correlationId = randomUUID(),
) {
  const days = integer("AUDIT_RETENTION_DAYS", 365, 36500);
  await tx.$executeRaw`INSERT INTO "AuditEvent" ("eventType","correlationId",metadata) VALUES (${event},${correlationId},${JSON.stringify(metadata)}::jsonb || jsonb_build_object('timestamp',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'retainUntil',to_char((clock_timestamp()+${days}*INTERVAL '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`;
}
