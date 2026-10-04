import { Prisma } from "@prisma/client";
export class CommandError extends Error {}
export function commandErrorMessage(error: unknown) {
  if (error instanceof CommandError) return error.message;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
    return "Įrašas jau yra duomenų bazėje. Pasirinkite kitą administratoriaus vardą arba patikrinkite kodus.";
  if (error instanceof Prisma.PrismaClientInitializationError)
    return "Nepavyksta prisijungti prie duomenų bazės. Patikrinkite, ar ji paleista ir tinkamai sukonfigūruota.";
  return "Komandos įvykdyti nepavyko. Patikrinkite duomenų bazės konfigūraciją ir bandykite dar kartą.";
}
