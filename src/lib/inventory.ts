import { parse } from "csv-parse/sync";
import { db } from "./db";
import { AppError } from "./security";
import { integer } from "./config";
export type Preview = {
  rows: { code: string; title: string; line: number }[];
  errors: { line: number; message: string }[];
  total: number;
};
export function parseInventory(text: string): Preview {
  const errors: Preview["errors"] = [];
  let records: { record: string[]; info: { lines: number } }[];
  try {
    const delimiter = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/, 1)[0]
      .includes(";")
      ? ";"
      : ",";
    records = parse(text, {
      bom: true,
      delimiter,
      skip_empty_lines: true,
      info: true,
      relax_column_count: true,
      max_record_size: 4096,
    }) as unknown as typeof records;
  } catch {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message: "Netinkamas CSV formatas arba neuždarytos kabutės.",
        },
      ],
      total: 0,
    };
  }
  const header = records.shift()?.record;
  if (
    !header ||
    header.length !== 2 ||
    header[0] !== "dovanos_kodas" ||
    header[1] !== "dovanos_pavadinimas"
  )
    errors.push({
      line: 1,
      message: "Antraštės turi būti dovanos_kodas,dovanos_pavadinimas.",
    });
  if (records.length > integer("CSV_MAX_ROWS", 5000, 100000))
    errors.push({ line: 1, message: "Faile per daug eilučių." });
  const seen = new Set<string>();
  const rows: Preview["rows"] = [];
  for (const { record, info } of records) {
    const [code, title] = record.map((s) => s.trim());
    if (
      record.length !== 2 ||
      !code ||
      !title ||
      code.length > 128 ||
      title.length > 200
    ) {
      errors.push({
        line: info.lines,
        message:
          "Reikia dviejų netuščių laukų: kodas iki 128, pavadinimas iki 200 simbolių.",
      });
      continue;
    }
    if (seen.has(code))
      errors.push({ line: info.lines, message: "Kodas faile kartojasi." });
    seen.add(code);
    rows.push({ code, title, line: info.lines });
  }
  if (!records.length) errors.push({ line: 2, message: "Faile nėra dovanų." });
  return { rows, errors, total: records.length };
}
export async function previewInventory(text: string) {
  if (
    Buffer.byteLength(text, "utf8") >
    integer("CSV_MAX_BYTES", 1048576, 10000000)
  )
    throw new AppError(413, "CSV failas per didelis.");
  const p = parseInventory(text);
  if (!p.errors.length) {
    const exists = await db.gift.findMany({
      where: { code: { in: p.rows.map((r) => r.code) } },
      select: { code: true },
    });
    const set = new Set(exists.map((r) => r.code));
    for (const r of p.rows)
      if (set.has(r.code))
        p.errors.push({
          line: r.line,
          message: "Kodas jau yra duomenų bazėje.",
        });
  }
  return p;
}
export async function importInventory(text: string) {
  const p = await previewInventory(text);
  if (p.errors.length)
    throw new AppError(
      400,
      "Importas neįvykdytas. Ištaisykite visas CSV klaidas.",
    );
  try {
    await db.$transaction(async (tx) => {
      await tx.gift.createMany({
        data: p.rows.map(({ code, title }) => ({ code, title })),
      });
    });
  } catch {
    throw new AppError(
      409,
      "Importas neįvykdytas: kodai jau yra bazėje arba įvyko konfliktas.",
    );
  }
  return { imported: p.rows.length };
}
export async function archiveInventory(ids: string[]) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(730124)::text`;
      const removed = await tx.gift.updateMany({
        where: { id: { in: ids }, status: "available" },
        data: { status: "archived" },
      });
      const skipped = await tx.gift.findMany({
        where: { id: { in: ids }, status: { not: "archived" } },
        select: { id: true },
      });
      return {
        removed: removed.count,
        skipped: ids.length - removed.count,
        protectedIds: skipped.map((r) => r.id),
      };
    },
    { timeout: 10000 },
  );
}
