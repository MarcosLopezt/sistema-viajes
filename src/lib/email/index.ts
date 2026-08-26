import { BrevoEmailProvider } from "./brevo-provider";
import { ConsoleEmailProvider } from "./console-provider";
import type { EmailProvider } from "./types";

export * from "./types";
export { BrevoEmailProvider } from "./brevo-provider";
export { ConsoleEmailProvider } from "./console-provider";

let cached: EmailProvider | null = null;

/**
 * Devuelve el proveedor configurado en EMAIL_PROVIDER.
 *
 * Cambiar de proveedor es cambiar una variable de entorno: ningún llamador
 * conoce a Brevo. Cuando haya que migrar a otro servicio se agrega un
 * adaptador acá y no se toca una sola línea del resto del sistema.
 */
export function getEmailProvider(): EmailProvider {
  if (cached) return cached;

  const configured = (process.env.EMAIL_PROVIDER ?? "console").toLowerCase();

  if (configured === "brevo") {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      throw new Error(
        "EMAIL_PROVIDER=brevo pero falta BREVO_API_KEY. Ver .env.example.",
      );
    }
    cached = new BrevoEmailProvider(
      apiKey,
      process.env.EMAIL_FROM_NAME ?? "Viajes",
      process.env.EMAIL_FROM_ADDRESS ?? "no-reply@example.com",
    );
    return cached;
  }

  if (configured !== "console") {
    throw new Error(
      `EMAIL_PROVIDER="${configured}" no es válido. Valores: "console" | "brevo".`,
    );
  }

  cached = new ConsoleEmailProvider();
  return cached;
}

/** Solo para tests: descarta el proveedor memoizado. */
export function resetEmailProvider(): void {
  cached = null;
}
