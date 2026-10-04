import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  emailSchema,
  claimSchema,
  purchaseSchema,
} from "../src/lib/validation";
import {
  ClientError,
  requestJson,
  userErrorMessage,
  requestFailed,
  connectionFailed,
  invalidResponse,
} from "../src/lib/client-errors";
import { CommandError, commandErrorMessage } from "../src/lib/cli-errors";
test("Visi validavimo klaidų variantai pateikiami lietuviškai", () => {
  assert.equal(
    emailSchema.safeParse(123).error!.issues[0].message,
    "Užpildykite šį lauką tekstu.",
  );
  const input = {
    email: "test@example.lt",
    box: 1,
    consent: true,
    consentVersion: "dev-1",
    consentText: "Sutinku",
    requestKey: crypto.randomUUID(),
  };
  for (const box of [undefined, "1", 0, 6, 1.5])
    assert.equal(
      claimSchema.safeParse({ ...input, box }).error!.issues[0].message,
      "Pasirinkite vieną iš penkių dovanų.",
    );
  for (const result of [
    claimSchema.safeParse({}),
    purchaseSchema().safeParse({ channel: "unknown" }),
    purchaseSchema().safeParse(null),
    z.string().min(3).safeParse(""),
  ]) {
    assert.equal(result.success, false);
    for (const issue of result.error!.issues)
      assert.doesNotMatch(
        issue.message,
        /Invalid input|expected|Too small|Too big|Invalid option|Invalid type/,
      );
  }
});
test("Tinklo ir netinkamo JSON klaidos pakeičiamos lietuviškais pranešimais", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(requestJson("/api/contest"), {
      message: connectionFailed,
    });
    for (const response of [
      new Response("<html>Error</html>"),
      Response.json(null),
      Response.json([]),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(requestJson("/api/contest"), {
        message: invalidResponse,
      });
    }
    globalThis.fetch = async () =>
      Response.json(
        { error: "Įveskite vardą ir slaptažodį." },
        { status: 400 },
      );
    const result = await requestJson("/api/admin");
    assert.equal(result.response.status, 400);
    assert.equal(
      userErrorMessage(new ClientError(result.data.error)),
      "Įveskite vardą ir slaptažodį.",
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("Nežinomos techninės klaidos nepatenka į vartotojo pranešimus", () => {
  assert.equal(
    userErrorMessage(new Error("Unexpected token <")),
    requestFailed,
  );
  assert.equal(userErrorMessage(new ClientError(undefined)), requestFailed);
  assert.equal(
    commandErrorMessage(new CommandError("Netinkamas vardas.")),
    "Netinkamas vardas.",
  );
  assert.match(
    commandErrorMessage(new Error("database password secret")),
    /Komandos įvykdyti nepavyko/,
  );
  const duplicate = new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed",
    { code: "P2002", clientVersion: "6.19.3" },
  );
  assert.match(commandErrorMessage(duplicate), /Įrašas jau yra duomenų bazėje/);
});
