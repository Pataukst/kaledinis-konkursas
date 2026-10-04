export const requestFailed =
  "Šiuo metu užklausos įvykdyti nepavyksta. Bandykite vėliau.";
export const connectionFailed =
  "Nepavyksta susisiekti su serveriu. Patikrinkite interneto ryšį ir bandykite dar kartą.";
export const invalidResponse =
  "Gautas netinkamas serverio atsakymas. Bandykite vėliau.";
export class ClientError extends Error {
  constructor(message: unknown) {
    super(
      typeof message === "string" && message.trim() ? message : requestFailed,
    );
  }
}
export function userErrorMessage(error: unknown) {
  return error instanceof ClientError ? error.message : requestFailed;
}
export async function requestJson(url: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ClientError(connectionFailed);
  }
  try {
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    return { response, data };
  } catch {
    throw new ClientError(invalidResponse);
  }
}
