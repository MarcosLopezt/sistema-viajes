import type { CurrencyCode } from "@/lib/format";

/**
 * Forma de los datos del viaje del lado del cliente.
 *
 * Todo llega serializado: las fechas como "aaaa-mm-dd" (lo que consume un
 * <input type="date">) y los montos como string. Ningún Decimal ni Date cruza
 * la frontera servidor→cliente.
 */

export interface WizardAccommodation {
  id: string;
  hotelName: string;
  nights: number;
  pricePerNightDouble: string;
  pricePerNightSingle: string;
  notes: string | null;
}

export interface WizardStop {
  id: string;
  order: number;
  city: string;
  country: string;
  fromDate: string;
  toDate: string;
  notes: string | null;
  accommodations: WizardAccommodation[];
}

export interface WizardDirectCost {
  id: string;
  stopId: string | null;
  concept: string;
  amountPerPassenger: string;
  type: "COMIDA" | "EVENTO" | "TRANSPORTE" | "OTRO";
}

export interface WizardIndirectCost {
  id: string;
  concept: string;
  totalAmount: string;
  type: "CHARTER" | "TRANSFER" | "HOSPEDAJE_COORDINADOR" | "OTRO";
}

export interface WizardTrip {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  currency: CurrencyCode;
  status: "BORRADOR" | "ABIERTO" | "CERRADO" | "FINALIZADO";
  minPassengers: number;
  maxPassengers: number;
  budgetedPassengers: number;
  coordinatorCount: number;
  passportValidityMonths: number;
  requireFullPassportValidity: boolean;
  priceDouble: string | null;
  priceSingle: string | null;
  stops: WizardStop[];
  directCosts: WizardDirectCost[];
  indirectCosts: WizardIndirectCost[];
}

/** Mix de pasajeros confirmados, para el margen total del paso 5. */
export interface WizardPassengerMix {
  roomType: "DOBLE" | "SINGLE";
  isCoordinator: boolean;
  status: "INVITADO" | "REGISTRADO" | "CONFIRMADO" | "CANCELADO";
  priceOverride: string | null;
}

export const WIZARD_STEPS = [
  "general",
  "itinerary",
  "directCosts",
  "indirectCosts",
  "prices",
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];
