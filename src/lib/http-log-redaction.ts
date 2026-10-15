const safeStrings = new Set([
  "validate", "claim", "invalidate", "pending", "assigned", "reserved",
  "expired", "available", "review", "failed", "rejected", "completed",
]);

// Unknown strings and credentials are masked by default, including nested data.
export function redactHttpBody(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[OMITTED]";
  if (value === null || typeof value === "boolean") return value;
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => redactHttpBody(item, depth + 1));
  if (typeof value !== "object") return "[REDACTED]";
  return Object.fromEntries(
    Object.entries(value).slice(0, 60).map(([key, item]) => {
      if (/password|cookie|authorization|token|secret|key|email|barcode|guid|code|^id$|Id$/i.test(key))
        return [key, "[REDACTED]"];
      if ((key === "action" || key === "status") && typeof item === "string" && safeStrings.has(item))
        return [key, item];
      if (key === "box" && Number.isInteger(item) && Number(item) >= 1 && Number(item) <= 5)
        return [key, item];
      return [key, redactHttpBody(item, depth + 1)];
    }),
  );
}
