import { CommandError, commandErrorMessage } from "../src/lib/cli-errors";
import { db } from "../src/lib/db";
import { passwordHash } from "../src/lib/security";
import { createInterface } from "node:readline/promises";
async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const username = (await rl.question("Administratoriaus vardas: ")).trim();
  rl.close();
  if (!username || username.length > 100)
    throw new CommandError("Netinkamas vardas.");
  if (!process.stdin.isTTY)
    throw new CommandError("Slaptažodžiui būtinas interaktyvus terminalas.");
  process.stdout.write("Slaptažodis (bent 14 simbolių, įvestis paslėpta): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let password = "";
  await new Promise<void>((resolve, reject) => {
    const listener = (data: Buffer) => {
      for (const ch of data.toString()) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.off("data", listener);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          resolve();
          return;
        }
        if (ch === "\u0003") {
          reject(new CommandError("Nutraukta."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") password = password.slice(0, -1);
        else password += ch;
      }
    };
    process.stdin.on("data", listener);
  });
  if (password.length < 14 || password.length > 200)
    throw new CommandError("Slaptažodis turi būti 14–200 simbolių.");
  await db.admin.create({
    data: { username, passwordHash: passwordHash(password) },
  });
  console.log("\nAdministratorius sukurtas.");
}
main()
  .catch((e) => {
    console.error(commandErrorMessage(e));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
