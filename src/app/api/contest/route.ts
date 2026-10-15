import "server-only";
import { logContestRequest } from "@/lib/http-log";
import {
  endpoint,
  visitor,
  originCheck,
  rateLimit,
  jsonBody,
  AppError,
} from "@/lib/security";
import { participationAllowed, isMock, consent, mockEnvironmentAllowed } from "@/lib/config";
import {
  flowState,
  invalidateFlow,
  submitReservation,
  validateAndReserve,
} from "@/lib/reservations";
import { isIP } from "node:net";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function customerIp(req: Request) {
  // Ingress must strip and overwrite this header; Next routes do not expose the socket.
  const name = process.env.TRUSTED_CUSTOMER_IP_HEADER;
  if (name) {
    const ip = req.headers.get(name)?.trim();
    if (!ip || !isIP(ip))
      throw new AppError(503, "Pirkimo tikrinimo ryšys nesukonfigūruotas.");
    return ip;
  }
  if (
    mockEnvironmentAllowed() &&
    process.env.PURCHASE_ADAPTER === "mock"
  )
    return "127.0.0.1";
  throw new AppError(503, "Pirkimo tikrinimo ryšys nesukonfigūruotas.");
}
export async function GET(req: Request) {
  return logContestRequest(req, () => endpoint(async () => {
    await rateLimit("bootstrap:global", 1200);
    const s = await visitor(true);
    return {
      mock: isMock(),
      allowed: participationAllowed(),
      consent: consent(),
      maxLength: 128,
      ...(await flowState(s.id)),
    };
  }));
}
export async function POST(req: Request) {
  return logContestRequest(req, () => endpoint(async () => {
    await originCheck(req);
    const s = await visitor();
    await rateLimit(`contest:${s.id}`, 20);
    await rateLimit("contest:global", 300);
    if (!participationAllowed())
      throw new AppError(
        503,
        "Dalyvavimas šiuo metu negalimas: integracijos neparuoštos.",
      );
    const body = await jsonBody(req);
    if (body.action === "invalidate") {
      await invalidateFlow(s.id);
      return { eligible: false };
    }
    if (body.action === "validate")
      return validateAndReserve(s.id, body.input, customerIp(req));
    if (body.action === "claim") return submitReservation(s.id, body.input);
    throw new AppError(400, "Netinkama užklausa.");
  }));
}
