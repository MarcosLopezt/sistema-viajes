import { isBefore, type CalendarDate } from "./calendar";

/**
 * Reglas puras del paso de itinerario del wizard de presupuesto.
 *
 * Funciones puras, testeadas en tests/domain/itinerary.test.ts.
 */

/**
 * Paradas cuyas fechas quedaron fuera del rango del viaje.
 *
 * No es un error: el viaje pudo crearse con fechas y después acortarse o
 * correrse, y en ese momento el itinerario ya tenía paradas cargadas. No se
 * bloquea nada por esto — un itinerario que no se puede editar hasta
 * corregir cada parada sería peor que el problema — pero hay que poder
 * listarlas para avisar.
 */
export function findStopsOutOfTripRange<
  T extends { fromDate: CalendarDate; toDate: CalendarDate },
>(stops: readonly T[], tripStartDate: CalendarDate, tripEndDate: CalendarDate): T[] {
  return stops.filter(
    (stop) =>
      isBefore(stop.fromDate, tripStartDate) ||
      isBefore(tripEndDate, stop.toDate),
  );
}

/**
 * ¿Un destino a medio cargar tiene ALGO, o está completamente vacío?
 *
 * La distinción importa para "Siguiente": vacío se descarta sin avisar
 * (nunca se abrió con intención de cargar nada), cualquier otra cosa se
 * intenta guardar — completo se agrega solo, incompleto frena la salida.
 */
export function isBlankStop(stop: {
  city: string;
  country: string;
  fromDate: string;
  toDate: string;
}): boolean {
  return (
    stop.city.trim() === "" &&
    stop.country.trim() === "" &&
    stop.fromDate === "" &&
    stop.toDate === ""
  );
}

/**
 * Igual que `isBlankStop`, para el formulario de "agregar hotel".
 *
 * `nights` no cuenta: el campo arranca en 1 y un <input type="number"> no
 * se vacía a "" al borrarlo, así que nunca es la señal de "no cargué nada".
 */
export function isBlankAccommodation(accommodation: {
  hotelName: string;
  pricePerNightDouble: string;
  pricePerNightSingle: string;
}): boolean {
  return (
    accommodation.hotelName.trim() === "" &&
    accommodation.pricePerNightDouble.trim() === "" &&
    accommodation.pricePerNightSingle.trim() === ""
  );
}

/** Igual que `isBlankStop`, para una fila de costo directo o indirecto. */
export function isBlankCost(row: { concept: string; amount: string }): boolean {
  return row.concept.trim() === "" && row.amount.trim() === "";
}
