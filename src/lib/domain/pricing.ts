import {
  roundToCents,
  roundUpToCents,
  sum,
  toDecimal,
  ZERO,
  type Decimal,
  type MoneyInput,
} from "./money";

/**
 * Motor de cálculo de costos y márgenes.
 *
 * Funciones puras: no conocen Prisma, ni React, ni la base. Reciben
 * estructuras planas y devuelven Decimals. Todo lo que decide plata del
 * sistema pasa por acá y está testeado en tests/domain/pricing.test.ts.
 *
 * Deliberadamente NO importa nada de `@/generated/prisma`: si el motor
 * dependiera del modelo de datos no se podría testear sin una base, y la
 * tentación de meterle lógica de presentación sería cuestión de tiempo.
 */

// ------------------------------- Entradas ----------------------------------

export interface AccommodationInput {
  nights: number;
  /** Precio por noche POR PERSONA compartiendo habitación doble. */
  pricePerNightDouble: MoneyInput;
  /** Precio por noche POR PERSONA en habitación single. */
  pricePerNightSingle: MoneyInput;
}

export interface DirectCostInput {
  /** Se le imputa igual a cada pasajero facturable, sin importar el cuarto. */
  amountPerPassenger: MoneyInput;
}

export interface IndirectCostInput {
  /** Total del viaje. Se prorratea entre budgetedPassengers. */
  totalAmount: MoneyInput;
}

export interface TripCostInput {
  /**
   * Divisor de los indirectos. Cuenta SOLO pasajeros facturables: los
   * coordinadores quedan afuera, y tampoco se usan los confirmados (si el
   * divisor cambiara con cada alta, el precio se movería solo).
   */
  budgetedPassengers: number;
  accommodations: readonly AccommodationInput[];
  directCosts: readonly DirectCostInput[];
  indirectCosts: readonly IndirectCostInput[];
}

// ------------------------------- Salidas -----------------------------------

export interface TripCostBreakdown {
  /** Costo directo por pasajero en base doble. */
  directDouble: Decimal;
  /** Costo directo por pasajero en base single. */
  directSingle: Decimal;
  /** Suma de todos los costos indirectos del viaje. */
  indirectTotal: Decimal;
  /** Parte de los indirectos que carga cada pasajero (ROUND_UP al centavo). */
  indirectPerPassenger: Decimal;
  /** directDouble + indirectPerPassenger */
  totalDouble: Decimal;
  /** directSingle + indirectPerPassenger */
  totalSingle: Decimal;
  /**
   * Lo que sobra del redondeo hacia arriba:
   * `indirectPerPassenger × budgetedPassengers − indirectTotal`.
   *
   * Siempre ≥ 0 y menor a un centavo por pasajero. Se devuelve explícito para
   * mostrárselo al coordinador en vez de esconderlo: es plata que el
   * presupuesto recauda de más, y quien fija el precio tiene que saberlo.
   */
  roundingResidue: Decimal;
}

/**
 * Calcula el costo por pasajero de un viaje.
 *
 * Un viaje sin hospedajes ni costos cargados devuelve todo en cero, no falla:
 * el wizard llama a esta función desde el paso 1, cuando todavía no hay nada
 * cargado, para poder mostrar el panel de costo en vivo desde el arranque.
 */
export function calculateTripCost(input: TripCostInput): TripCostBreakdown {
  const { budgetedPassengers, accommodations, directCosts, indirectCosts } =
    input;

  if (!Number.isInteger(budgetedPassengers) || budgetedPassengers <= 0) {
    throw new Error(
      `budgetedPassengers debe ser un entero positivo, recibido: ${budgetedPassengers}`,
    );
  }

  const lodgingDouble = sum(
    accommodations.map((a) =>
      toDecimal(a.pricePerNightDouble).times(a.nights).toString(),
    ),
  );
  const lodgingSingle = sum(
    accommodations.map((a) =>
      toDecimal(a.pricePerNightSingle).times(a.nights).toString(),
    ),
  );

  // Los costos directos (cenas, entradas, trenes) se imputan igual a todos:
  // no dependen del tipo de habitación.
  const perPassengerExtras = sum(
    directCosts.map((c) => toDecimal(c.amountPerPassenger).toString()),
  );

  const directDouble = roundToCents(lodgingDouble.plus(perPassengerExtras));
  const directSingle = roundToCents(lodgingSingle.plus(perPassengerExtras));

  const indirectTotal = roundToCents(
    sum(indirectCosts.map((c) => toDecimal(c.totalAmount).toString())),
  );

  // ROUND_UP: lo prorrateado nunca puede sumar menos que el costo real.
  const indirectPerPassenger = roundUpToCents(
    indirectTotal.dividedBy(budgetedPassengers),
  );

  const roundingResidue = roundToCents(
    indirectPerPassenger.times(budgetedPassengers).minus(indirectTotal),
  );

  return {
    directDouble,
    directSingle,
    indirectTotal,
    indirectPerPassenger,
    totalDouble: roundToCents(directDouble.plus(indirectPerPassenger)),
    totalSingle: roundToCents(directSingle.plus(indirectPerPassenger)),
    roundingResidue,
  };
}

// -------------------------------- Margen -----------------------------------

export type RoomType = "DOBLE" | "SINGLE";

/**
 * Un pasajero, para el cálculo del margen total.
 *
 * `isCoordinator` importa: el coordinador ocupa una cama y carga sus datos,
 * pero no paga. Contarlo inflaría los ingresos.
 */
export interface PassengerMixInput {
  roomType: RoomType;
  isCoordinator: boolean;
  status: "INVITADO" | "REGISTRADO" | "CONFIRMADO" | "CANCELADO";
  /** Precio pactado para este pasajero. Pisa el precio de lista del viaje. */
  priceOverride?: MoneyInput | null;
}

export interface TripPrices {
  priceDouble?: MoneyInput | null;
  priceSingle?: MoneyInput | null;
}

/** Margen unitario para un tipo de habitación. */
export interface UnitMargin {
  price: Decimal;
  cost: Decimal;
  /** price − cost. Puede ser negativo si el precio quedó por debajo. */
  margin: Decimal;
  /** Margen sobre el PRECIO, en porcentaje. Ver nota en marginPercent(). */
  marginPercent: Decimal;
}

/**
 * Sobre qué mix single/doble está calculado un margen total.
 *
 * Nunca se devuelve un total sin esto: "el margen del viaje es £6.800" no
 * significa nada si no se dice con cuántos singles.
 */
export type TotalMarginBasis =
  | {
      kind: "CONFIRMADOS";
      doubleCount: number;
      singleCount: number;
    }
  | {
      kind: "ESCENARIO";
      scenario: "TODOS_DOBLE" | "TODOS_SINGLE";
      passengerCount: number;
    };

export interface TotalMargin {
  basis: TotalMarginBasis;
  revenue: Decimal;
  cost: Decimal;
  margin: Decimal;
  marginPercent: Decimal;
}

export interface TripMarginResult {
  /** `null` cuando el coordinador todavía no fijó ese precio. */
  perPassengerDouble: UnitMargin | null;
  perPassengerSingle: UnitMargin | null;
  /**
   * Uno solo si hay pasajeros CONFIRMADOS (el mix real).
   * Dos escenarios —todos en doble y todos en single— si no hay ninguno,
   * porque con cero confirmados el mix es desconocido y un número único
   * sería una invención.
   */
  totals: readonly TotalMargin[];
}

/**
 * Margen sobre el precio de venta, no sobre el costo.
 *
 * `(precio − costo) / precio`. Es la convención del rubro: un margen del 12%
 * significa que 12 de cada 100 libras facturadas quedan. La otra lectura
 * posible —margen sobre costo, o markup— da un número más grande para la
 * misma operación, y mezclarlas es una fuente clásica de confusión.
 */
function marginPercent(margin: Decimal, price: Decimal): Decimal {
  if (price.isZero()) return ZERO;
  return margin.dividedBy(price).times(100).toDecimalPlaces(2);
}

function unitMargin(price: Decimal, cost: Decimal): UnitMargin {
  const margin = roundToCents(price.minus(cost));
  return { price, cost, margin, marginPercent: marginPercent(margin, price) };
}

/**
 * Calcula el margen por pasajero y el margen total del viaje.
 *
 * El margen por pasajero es directo: precio − costo, para doble y para single.
 * El margen TOTAL depende del mix, que hasta que no haya confirmados no se
 * conoce. Por eso `totals` puede traer dos escenarios en vez de uno.
 */
export function calculateTripMargin(
  breakdown: TripCostBreakdown,
  prices: TripPrices,
  passengers: readonly PassengerMixInput[],
  budgetedPassengers: number,
): TripMarginResult {
  const priceDouble =
    prices.priceDouble != null ? toDecimal(prices.priceDouble) : null;
  const priceSingle =
    prices.priceSingle != null ? toDecimal(prices.priceSingle) : null;

  const perPassengerDouble =
    priceDouble !== null ? unitMargin(priceDouble, breakdown.totalDouble) : null;
  const perPassengerSingle =
    priceSingle !== null ? unitMargin(priceSingle, breakdown.totalSingle) : null;

  // Solo pasajeros facturables y confirmados. El coordinador no paga; los
  // invitados y registrados todavía pueden no viajar.
  const billable = passengers.filter(
    (p) => !p.isCoordinator && p.status === "CONFIRMADO",
  );

  const costOf = (roomType: RoomType): Decimal =>
    roomType === "SINGLE" ? breakdown.totalSingle : breakdown.totalDouble;

  const priceOf = (p: PassengerMixInput): Decimal | null => {
    if (p.priceOverride != null) return toDecimal(p.priceOverride);
    return p.roomType === "SINGLE" ? priceSingle : priceDouble;
  };

  // Sin precios fijados no hay margen que calcular.
  if (priceDouble === null && priceSingle === null) {
    return { perPassengerDouble, perPassengerSingle, totals: [] };
  }

  if (billable.length > 0) {
    let revenue = ZERO;
    let cost = ZERO;
    let doubleCount = 0;
    let singleCount = 0;

    for (const passenger of billable) {
      const price = priceOf(passenger);
      // Un pasajero cuyo tipo de habitación todavía no tiene precio fijado se
      // omite del total en vez de contarse como ingreso cero, que mostraría
      // un margen falsamente negativo.
      if (price === null) continue;

      revenue = revenue.plus(price);
      cost = cost.plus(costOf(passenger.roomType));
      if (passenger.roomType === "SINGLE") singleCount += 1;
      else doubleCount += 1;
    }

    const margin = roundToCents(revenue.minus(cost));
    return {
      perPassengerDouble,
      perPassengerSingle,
      totals: [
        {
          basis: { kind: "CONFIRMADOS", doubleCount, singleCount },
          revenue: roundToCents(revenue),
          cost: roundToCents(cost),
          margin,
          marginPercent: marginPercent(margin, revenue),
        },
      ],
    };
  }

  // Sin confirmados: dos escenarios sobre los pasajeros presupuestados.
  const scenarios: TotalMargin[] = [];

  const pushScenario = (
    scenario: "TODOS_DOBLE" | "TODOS_SINGLE",
    price: Decimal | null,
    unitCost: Decimal,
  ) => {
    if (price === null) return;
    const revenue = roundToCents(price.times(budgetedPassengers));
    const cost = roundToCents(unitCost.times(budgetedPassengers));
    const margin = roundToCents(revenue.minus(cost));
    scenarios.push({
      basis: {
        kind: "ESCENARIO",
        scenario,
        passengerCount: budgetedPassengers,
      },
      revenue,
      cost,
      margin,
      marginPercent: marginPercent(margin, revenue),
    });
  };

  pushScenario("TODOS_DOBLE", priceDouble, breakdown.totalDouble);
  pushScenario("TODOS_SINGLE", priceSingle, breakdown.totalSingle);

  return { perPassengerDouble, perPassengerSingle, totals: scenarios };
}

// --------------------------- Impacto de un cambio --------------------------

export interface CostImpact {
  before: Decimal;
  after: Decimal;
  delta: Decimal;
  /** true si el número se movió. Sirve para no mostrar un aviso vacío. */
  changed: boolean;
}

/**
 * Compara dos escenarios de costo.
 *
 * Es lo que alimenta el aviso previo a guardar: "el costo por pasajero pasa
 * de £1.200 a £1.340". Mostrar el impacto ANTES de confirmar es un criterio
 * de aceptación, no una cortesía.
 */
export function compareCost(
  before: TripCostBreakdown,
  after: TripCostBreakdown,
): { double: CostImpact; single: CostImpact } {
  const impact = (a: Decimal, b: Decimal): CostImpact => ({
    before: a,
    after: b,
    delta: roundToCents(b.minus(a)),
    changed: !a.equals(b),
  });

  return {
    double: impact(before.totalDouble, after.totalDouble),
    single: impact(before.totalSingle, after.totalSingle),
  };
}
