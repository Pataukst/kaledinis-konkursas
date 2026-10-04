import { z } from "zod";

z.config(z.locales.lt());
export const emailSchema = z
  .string({ error: "Užpildykite šį lauką tekstu." })
  .trim()
  .max(254, "El. pašto adresas per ilgas.")
  .email("Įveskite galiojantį el. pašto adresą.")
  .transform((s) => s.toLowerCase());
export function vilniusDate(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vilnius",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function validDate(s: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return (
    !isNaN(d.valueOf()) &&
    d.toISOString().slice(0, 10) === s &&
    s <= vilniusDate(now)
  );
}
export function purchaseSchema(max = 128) {
  const id = z
    .string({ error: "Užpildykite šį lauką tekstu." })
    .trim()
    .min(1, "Užpildykite šį lauką.")
    .max(max, `Galima įvesti iki ${max} simbolių.`);
  return z.discriminatedUnion("channel", [
    z.object({
      channel: z.literal("online"),
      orderNumber: id,
      buyerEmail: emailSchema,
    }),
    z.object({ channel: z.literal("shop"), barcode: id, receiptNumber: id }),
    z.object({
      channel: z.literal("retail"),
      barcode: id,
      purchaseDate: z
        .string({ error: "Užpildykite šį lauką tekstu." })
        .refine(
          (s) => validDate(s),
          "Įveskite tikrą pirkimo datą, ne vėlesnę nei šiandien.",
        ),
    }),
  ]);
}
export type Purchase = z.infer<ReturnType<typeof purchaseSchema>>;
export const claimSchema = z.object({
  email: emailSchema,
  box: z
    .number({ error: "Pasirinkite vieną iš penkių dovanų." })
    .int("Pasirinkite vieną iš penkių dovanų.")
    .min(1, "Pasirinkite vieną iš penkių dovanų.")
    .max(5, "Pasirinkite vieną iš penkių dovanų."),
  consent: z.literal(true, {
    error: "Norėdami dalyvauti, patvirtinkite sutikimą.",
  }),
  consentVersion: z
    .string({
      error: "Atnaujinkite puslapį ir patvirtinkite sutikimą iš naujo.",
    })
    .min(1, "Trūksta sutikimo versijos. Atnaujinkite puslapį.")
    .max(128, "Netinkama sutikimo versija. Atnaujinkite puslapį."),
  consentText: z
    .string({
      error: "Atnaujinkite puslapį ir patvirtinkite sutikimą iš naujo.",
    })
    .min(1, "Trūksta sutikimo teksto. Atnaujinkite puslapį.")
    .max(4096, "Sutikimo tekstas per ilgas. Atnaujinkite puslapį."),
  requestKey: z.uuid("Netinkamas užklausos identifikatorius."),
});
export const labels = {
  online: [
    ["orderNumber", "Užsakymo numeris"],
    ["buyerEmail", "Pirkėjo el. paštas"],
  ],
  shop: [
    ["barcode", "Dovanų kupono brūkšninis kodas"],
    ["receiptNumber", "Kasos kvito numeris"],
  ],
  retail: [
    ["barcode", "Dovanų kupono brūkšninis kodas"],
    ["purchaseDate", "Pirkimo data"],
  ],
} as const;
