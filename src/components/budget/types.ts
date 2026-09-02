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
  /** La seña. Null mientras no la hayan decidido: es un estado válido. */
  depositAmount: string | null;
  /** Defaults del plan con seña. Solo intervienen si hay seña. */
  defaultInstallmentCount: number;
  installmentIntervalMonths: number;
  stops: WizardStop[];
  directCosts: WizardDirectCost[];
  indirectCosts: WizardIndirectCost[];
  publicZone: WizardPublicZone;
}

/**
 * Los textos de marca y el switch de captación.
 *
 * Son DATO: los escriben y los mantienen las coordinadoras. Viajan al cliente
 * como strings comunes y se muestran como texto, nunca como HTML.
 */
export interface WizardPublicZone {
  acceptingInterest: boolean;
  infoForInterestedEs: string;
  infoForInterestedEn: string;
  welcomeMessageEs: string;
  welcomeMessageEn: string;
  nextStepMessageEs: string;
  nextStepMessageEn: string;
  emailSignatureEs: string;
  emailSignatureEn: string;
  closedMessageEs: string;
  closedMessageEn: string;
  /**
   * La condición de no reembolsable de la seña y dónde transferir.
   *
   * Van con el resto de los textos de marca porque son lo mismo: los escriben
   * las coordinadoras, no quien programa. La condición además se COPIA a cada
   * aceptación, así que editarla acá no toca ninguna aceptación ya guardada.
   */
  depositTermsEs: string;
  depositTermsEn: string;
  paymentInstructionsEs: string;
  paymentInstructionsEn: string;
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
  // Sexto paso, fase 7. Va al final y no al principio a propósito: la zona
  // pública se abre cuando el viaje ya tiene precio, no antes.
  "publicZone",
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];
