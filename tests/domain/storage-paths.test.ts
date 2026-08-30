import { describe, expect, it } from "vitest";
import {
  buildStoragePath,
  isInsidePassengerFolder,
  passengerFolder,
} from "@/lib/domain/storage-paths";

/**
 * La convención de paths del bucket.
 *
 * Esto es lo que impide que alguien pida —o pise— el archivo de otra persona,
 * así que se testea el guard de verdad y no una copia. Antes la regla estaba
 * escrita tres veces en storage.ts y no la ejercía ningún test; el resultado
 * fue que el seed escribió `{tripId}/certificados/{key}.pdf` durante tres
 * fases sin que nadie se enterara, y el síntoma fue un 404 que no decía por
 * qué.
 */

const TRIP = "11111111-1111-4111-8111-111111111111";
const PASAJERO = "22222222-2222-4222-8222-222222222222";
const OTRO_PASAJERO = "33333333-3333-4333-8333-333333333333";
const OTRO_VIAJE = "44444444-4444-4444-8444-444444444444";

describe("buildStoragePath", () => {
  it("arma la path con el viaje, el pasajero y el tipo", () => {
    expect(
      buildStoragePath(TRIP, PASAJERO, "cobertura-medica", "abc123", "pdf"),
    ).toBe(`${TRIP}/${PASAJERO}/cobertura-medica-abc123.pdf`);
  });

  it("lo que arma siempre pasa su propio guard", () => {
    for (const kind of ["cobertura-medica", "comprobante-pago"] as const) {
      const path = buildStoragePath(TRIP, PASAJERO, kind, "x1", "jpg");
      expect(isInsidePassengerFolder(path, TRIP, PASAJERO)).toBe(true);
    }
  });
});

describe("passengerFolder", () => {
  it("termina en barra, para que el prefijo no matchee de más", () => {
    // Sin la barra final, `{trip}/{pasajero}extra/x.pdf` pasaría el
    // startsWith y caería fuera de la carpeta.
    expect(passengerFolder(TRIP, PASAJERO)).toBe(`${TRIP}/${PASAJERO}/`);
  });
});

describe("isInsidePassengerFolder", () => {
  it("acepta un archivo dentro de la carpeta del pasajero", () => {
    expect(
      isInsidePassengerFolder(`${TRIP}/${PASAJERO}/cobertura-medica-a.pdf`, TRIP, PASAJERO),
    ).toBe(true);
  });

  it("RECHAZA la forma que usaba el seed", () => {
    // Este es el bug concreto: el segundo segmento era la palabra
    // "certificados" en vez del passengerId.
    expect(
      isInsidePassengerFolder(`${TRIP}/certificados/ana.pdf`, TRIP, PASAJERO),
    ).toBe(false);
  });

  it("rechaza el archivo de otro pasajero del mismo viaje", () => {
    expect(
      isInsidePassengerFolder(`${TRIP}/${OTRO_PASAJERO}/x.pdf`, TRIP, PASAJERO),
    ).toBe(false);
  });

  it("rechaza el mismo pasajero en otro viaje", () => {
    expect(
      isInsidePassengerFolder(`${OTRO_VIAJE}/${PASAJERO}/x.pdf`, TRIP, PASAJERO),
    ).toBe(false);
  });

  it("rechaza el salto de carpeta aunque el prefijo sea correcto", () => {
    // Empieza bien y apunta afuera: por eso `..` se busca en la path entera
    // y no solo al principio.
    expect(
      isInsidePassengerFolder(
        `${TRIP}/${PASAJERO}/../${OTRO_PASAJERO}/x.pdf`,
        TRIP,
        PASAJERO,
      ),
    ).toBe(false);
  });

  it("rechaza una subcarpeta", () => {
    // `buildStoragePath` nunca genera esto, así que no hay razón para aceptarlo.
    expect(
      isInsidePassengerFolder(`${TRIP}/${PASAJERO}/sub/x.pdf`, TRIP, PASAJERO),
    ).toBe(false);
  });

  it("rechaza la carpeta sin archivo", () => {
    expect(isInsidePassengerFolder(`${TRIP}/${PASAJERO}/`, TRIP, PASAJERO)).toBe(false);
  });

  it("rechaza un prefijo que se parece pero no es", () => {
    // El passengerId real es un prefijo del que viene en la path.
    expect(
      isInsidePassengerFolder(`${TRIP}/${PASAJERO}-bis/x.pdf`, TRIP, PASAJERO),
    ).toBe(false);
  });

  it("rechaza una URL en vez de una path", () => {
    // En la base nunca va una URL: si aparece una, es un bug de otro lado.
    expect(
      isInsidePassengerFolder(
        `https://x.supabase.co/storage/v1/object/public/${TRIP}/${PASAJERO}/x.pdf`,
        TRIP,
        PASAJERO,
      ),
    ).toBe(false);
  });

  it("rechaza el string vacío", () => {
    expect(isInsidePassengerFolder("", TRIP, PASAJERO)).toBe(false);
  });
});
