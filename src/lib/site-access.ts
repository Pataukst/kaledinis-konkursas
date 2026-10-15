import { createHash, timingSafeEqual } from "node:crypto";

export function validSiteCredentials(header: string | null, password: string) {
  if (!header?.startsWith("Basic ") || header.length > 4096) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0 || decoded.slice(0, separator) !== "team") return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(decoded.slice(separator + 1)), digest(password));
}
