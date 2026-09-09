import { describe, expect, it } from "vitest";
import {
  findStopsOutOfTripRange,
  isBlankAccommodation,
  isBlankCost,
  isBlankStop,
} from "@/lib/domain/itinerary";

describe("findStopsOutOfTripRange · avisar, no bloquear", () => {
  it("no marca una parada que entra entera en el rango del viaje", () => {
    const stops = [{ id: "1", fromDate: "2027-05-11", toDate: "2027-05-13" }];
    expect(
      findStopsOutOfTripRange(stops, "2027-05-10", "2027-05-14"),
    ).toEqual([]);
  });

  it("no marca una parada que coincide exactamente con los bordes del viaje", () => {
    const stops = [{ id: "1", fromDate: "2027-05-10", toDate: "2027-05-14" }];
    expect(
      findStopsOutOfTripRange(stops, "2027-05-10", "2027-05-14"),
    ).toEqual([]);
  });

  it("marca una parada que empieza antes de que arranque el viaje", () => {
    const stops = [{ id: "1", fromDate: "2027-05-09", toDate: "2027-05-12" }];
    expect(
      findStopsOutOfTripRange(stops, "2027-05-10", "2027-05-14").map(
        (s) => s.id,
      ),
    ).toEqual(["1"]);
  });

  it("marca una parada que termina después de que el viaje ya volvió", () => {
    const stops = [{ id: "1", fromDate: "2027-05-12", toDate: "2027-05-15" }];
    expect(
      findStopsOutOfTripRange(stops, "2027-05-10", "2027-05-14").map(
        (s) => s.id,
      ),
    ).toEqual(["1"]);
  });

  it("reproduce el caso del pedido: acortar el viaje deja paradas viejas afuera", () => {
    // El viaje se creó 10→20, se cargaron paradas, y después se acortó a
    // 10→14. Las que ya no entran tienen que poder detectarse sin bloquear
    // nada: es exactamente lo que pide la advertencia del wizard.
    const stops = [
      { id: "adentro", fromDate: "2027-05-10", toDate: "2027-05-12" },
      { id: "afuera", fromDate: "2027-05-15", toDate: "2027-05-18" },
    ];
    expect(
      findStopsOutOfTripRange(stops, "2027-05-10", "2027-05-14").map(
        (s) => s.id,
      ),
    ).toEqual(["afuera"]);
  });
});

describe("isBlankStop / isBlankAccommodation / isBlankCost · vacío vs incompleto", () => {
  it("un destino sin ningún campo cargado es blanco", () => {
    expect(
      isBlankStop({ city: "", country: "", fromDate: "", toDate: "" }),
    ).toBe(true);
  });

  it("espacios sueltos siguen siendo blanco", () => {
    expect(
      isBlankStop({ city: "   ", country: "  ", fromDate: "", toDate: "" }),
    ).toBe(true);
  });

  it("un destino con UN campo cargado ya no es blanco (queda incompleto, no vacío)", () => {
    expect(
      isBlankStop({ city: "Londres", country: "", fromDate: "", toDate: "" }),
    ).toBe(false);
  });

  it("un hotel sin nombre ni precios es blanco", () => {
    expect(
      isBlankAccommodation({
        hotelName: "",
        pricePerNightDouble: "",
        pricePerNightSingle: "",
      }),
    ).toBe(true);
  });

  it("un hotel con el nombre tipeado ya no es blanco", () => {
    expect(
      isBlankAccommodation({
        hotelName: "Hotel Central",
        pricePerNightDouble: "",
        pricePerNightSingle: "",
      }),
    ).toBe(false);
  });

  it("una fila de costo sin concepto ni importe es blanca", () => {
    expect(isBlankCost({ concept: "", amount: "" })).toBe(true);
  });

  it("una fila de costo con solo el importe ya no es blanca", () => {
    expect(isBlankCost({ concept: "", amount: "10.00" })).toBe(false);
  });
});
