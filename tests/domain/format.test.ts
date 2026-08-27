import { describe, expect, it } from "vitest";
import { formatDateTimeInZone } from "@/lib/format";

/**
 * `formatDateTimeInZone` sella las exportaciones.
 *
 * Vive en `lib/format.ts` y no en `lib/domain/`, pero es una función pura y su
 * test corre con el resto de los unitarios.
 *
 * Lo que se prueba es lo único que puede salir mal de forma invisible: que la
 * hora se convierta al huso del viaje y no quede la del proceso. En Vercel el
 * proceso corre en UTC, así que un error acá pondría una hora equivocada en un
 * archivo que se lee semanas después, sin nada que delate el problema.
 */

const NOCHE = new Date("2026-08-27T19:30:00.000Z");

describe("formatDateTimeInZone", () => {
  it("convierte al huso pedido", () => {
    // 19:30 UTC son las 16:30 en Buenos Aires (UTC-3).
    expect(formatDateTimeInZone(NOCHE, "America/Argentina/Buenos_Aires")).toBe(
      "27/08/2026 16:30 (America/Argentina/Buenos_Aires)",
    );
  });

  it("da una hora distinta en otro huso, para el mismo instante", () => {
    // Agosto: Londres está en horario de verano, UTC+1.
    expect(formatDateTimeInZone(NOCHE, "Europe/London")).toBe(
      "27/08/2026 20:30 (Europe/London)",
    );
  });

  it("escribe el huso en la salida, no solo lo aplica", () => {
    // Quien recibe el archivo no tiene por qué adivinar en qué reloj está.
    expect(formatDateTimeInZone(NOCHE, "UTC")).toContain("(UTC)");
  });

  it("cruza el cambio de día cuando corresponde", () => {
    // 02:00 UTC del 28 son las 23:00 del 27 en Buenos Aires.
    const madrugada = new Date("2026-08-28T02:00:00.000Z");
    expect(
      formatDateTimeInZone(madrugada, "America/Argentina/Buenos_Aires"),
    ).toBe("27/08/2026 23:00 (America/Argentina/Buenos_Aires)");
  });

  it("usa reloj de 24 horas", () => {
    const tarde = new Date("2026-08-27T23:45:00.000Z");
    expect(formatDateTimeInZone(tarde, "UTC")).toBe("27/08/2026 23:45 (UTC)");
  });

  it("no muestra medianoche como 24:00", () => {
    // Intl con hour12:false devuelve "24" en algunos entornos. Si eso pasara,
    // el sello diría "24:00" del día anterior, que no existe.
    const medianoche = new Date("2026-08-27T00:00:00.000Z");
    expect(formatDateTimeInZone(medianoche, "UTC")).toBe(
      "27/08/2026 00:00 (UTC)",
    );
  });

  it("cae a UTC si el huso es inválido, en vez de tirar", () => {
    // `Trip.timezone` tiene default y no tiene UI, así que esto no debería
    // pasar nunca. Pero si pasara, la exportación tiene que salir igual: un
    // 500 al descargar es peor que una hora en UTC bien etiquetada.
    const salida = formatDateTimeInZone(NOCHE, "Marte/Olympus_Mons");
    expect(salida).toBe("27/08/2026 19:30 (UTC)");
  });
});
