import { describe, expect, it } from "vitest";
import {
  calculateTripCost,
  calculateTripMargin,
  compareCost,
  type PassengerMixInput,
  type TripCostInput,
} from "@/lib/domain/pricing";

/**
 * El viaje de referencia es el mismo que carga el seed, para que los números
 * de los tests se puedan cruzar con lo que se ve en pantalla:
 *
 *   hoteles doble  = 4×95 + 5×110 + 5×100 = 1430
 *   hoteles single = 4×150 + 5×175 + 5×160 = 2275
 *   directos       = 45 + 38 + 85 + 120 + 60 = 348
 *   indirectos     = 18200 + 2100 + 3800 = 24100
 *   budgeted       = 14
 */
const BASE: TripCostInput = {
  budgetedPassengers: 14,
  accommodations: [
    { nights: 4, pricePerNightDouble: "95.00", pricePerNightSingle: "150.00" },
    { nights: 5, pricePerNightDouble: "110.00", pricePerNightSingle: "175.00" },
    { nights: 5, pricePerNightDouble: "100.00", pricePerNightSingle: "160.00" },
  ],
  directCosts: [
    { amountPerPassenger: "45.00" },
    { amountPerPassenger: "38.00" },
    { amountPerPassenger: "85.00" },
    { amountPerPassenger: "120.00" },
    { amountPerPassenger: "60.00" },
  ],
  indirectCosts: [
    { totalAmount: "18200.00" },
    { totalAmount: "2100.00" },
    { totalAmount: "3800.00" },
  ],
};

const passenger = (
  overrides: Partial<PassengerMixInput> = {},
): PassengerMixInput => ({
  roomType: "DOBLE",
  isCoordinator: false,
  status: "CONFIRMADO",
  ...overrides,
});

describe("calculateTripCost — viaje de referencia", () => {
  const result = calculateTripCost(BASE);

  it("suma el hospedaje por noches y el resto de los directos", () => {
    expect(result.directDouble.toString()).toBe("1778"); // 1430 + 348
    expect(result.directSingle.toString()).toBe("2623"); // 2275 + 348
  });

  it("suma los indirectos del viaje", () => {
    expect(result.indirectTotal.toString()).toBe("24100");
  });

  it("prorratea los indirectos entre los presupuestados", () => {
    // 24100 / 14 = 1721.428571… → ROUND_UP → 1721.43
    expect(result.indirectPerPassenger.toString()).toBe("1721.43");
  });

  it("compone el total sumando directo e indirecto", () => {
    expect(result.totalDouble.toString()).toBe("3499.43");
    expect(result.totalSingle.toString()).toBe("4344.43");
  });
});

describe("división no exacta y residuo de redondeo", () => {
  it("redondea hacia arriba el prorrateo (£8.437 / 14)", () => {
    const result = calculateTripCost({
      ...BASE,
      indirectCosts: [{ totalAmount: "8437.00" }],
    });
    // 8437 / 14 = 602.642857… → 602.65
    expect(result.indirectPerPassenger.toString()).toBe("602.65");
  });

  it("expone el residuo en vez de esconderlo", () => {
    const result = calculateTripCost({
      ...BASE,
      indirectCosts: [{ totalAmount: "8437.00" }],
    });
    // 602.65 × 14 = 8437.10 → sobran 0.10
    expect(result.roundingResidue.toString()).toBe("0.1");
  });

  it("lo prorrateado nunca queda por debajo del costo real", () => {
    for (const total of ["8437.00", "24100.00", "1.00", "999.99", "10000.01"]) {
      const r = calculateTripCost({
        ...BASE,
        indirectCosts: [{ totalAmount: total }],
      });
      expect(
        r.indirectPerPassenger
          .times(BASE.budgetedPassengers)
          .greaterThanOrEqualTo(r.indirectTotal),
        `total ${total}`,
      ).toBe(true);
      expect(r.roundingResidue.isNegative(), `total ${total}`).toBe(false);
    }
  });

  it("no deja residuo cuando la división es exacta", () => {
    const result = calculateTripCost({
      ...BASE,
      indirectCosts: [{ totalAmount: "14000.00" }],
    });
    expect(result.indirectPerPassenger.toString()).toBe("1000");
    expect(result.roundingResidue.toString()).toBe("0");
  });
});

describe("casos de borde", () => {
  it("sin costos indirectos, el total es solo el directo", () => {
    const result = calculateTripCost({ ...BASE, indirectCosts: [] });
    expect(result.indirectTotal.toString()).toBe("0");
    expect(result.indirectPerPassenger.toString()).toBe("0");
    expect(result.roundingResidue.toString()).toBe("0");
    expect(result.totalDouble.toString()).toBe("1778");
    expect(result.totalSingle.toString()).toBe("2623");
  });

  it("sin hospedajes cargados, el directo es solo comidas y eventos", () => {
    const result = calculateTripCost({ ...BASE, accommodations: [] });
    expect(result.directDouble.toString()).toBe("348");
    expect(result.directSingle.toString()).toBe("348");
    // Sin hoteles, doble y single cuestan lo mismo: la diferencia entre
    // ambas bases sale enteramente del alojamiento.
    expect(result.directDouble.equals(result.directSingle)).toBe(true);
  });

  it("un viaje recién creado, sin nada cargado, devuelve ceros y no falla", () => {
    // El wizard llama a esta función desde el paso 1 para el panel en vivo.
    const result = calculateTripCost({
      budgetedPassengers: 14,
      accommodations: [],
      directCosts: [],
      indirectCosts: [],
    });
    expect(result.totalDouble.toString()).toBe("0");
    expect(result.totalSingle.toString()).toBe("0");
  });

  it("rechaza un budgetedPassengers inválido en vez de dividir por cero", () => {
    for (const value of [0, -3, 2.5, Number.NaN]) {
      expect(() =>
        calculateTripCost({ ...BASE, budgetedPassengers: value }),
      ).toThrow();
    }
  });

  it("una noche con precio cero no rompe nada", () => {
    const result = calculateTripCost({
      ...BASE,
      accommodations: [
        { nights: 2, pricePerNightDouble: "0", pricePerNightSingle: "0" },
      ],
    });
    expect(result.directDouble.toString()).toBe("348");
  });
});

describe("cambio de budgetedPassengers", () => {
  it("mueve el indirecto por pasajero pero no el costo directo", () => {
    const con14 = calculateTripCost(BASE);
    const con10 = calculateTripCost({ ...BASE, budgetedPassengers: 10 });

    expect(con14.indirectPerPassenger.toString()).toBe("1721.43");
    expect(con10.indirectPerPassenger.toString()).toBe("2410");

    // El directo no depende del divisor.
    expect(con10.directDouble.equals(con14.directDouble)).toBe(true);
    expect(con10.directSingle.equals(con14.directSingle)).toBe(true);
  });

  it("menos pasajeros presupuestados encarece a cada uno", () => {
    const con14 = calculateTripCost(BASE);
    const con10 = calculateTripCost({ ...BASE, budgetedPassengers: 10 });
    expect(con10.totalDouble.greaterThan(con14.totalDouble)).toBe(true);
  });

  it("el divisor son los presupuestados, no los confirmados", () => {
    // Es la razón de ser de budgetedPassengers: con 9 confirmados de 14, el
    // costo por pasajero tiene que seguir siendo el de 14.
    const result = calculateTripCost(BASE);
    expect(result.indirectPerPassenger.toString()).toBe("1721.43");
  });
});

describe("invariante: el single nunca cuesta menos que el doble", () => {
  it("se cumple en el viaje de referencia", () => {
    const r = calculateTripCost(BASE);
    expect(r.directSingle.greaterThanOrEqualTo(r.directDouble)).toBe(true);
    expect(r.totalSingle.greaterThanOrEqualTo(r.totalDouble)).toBe(true);
  });

  it("se cumple con cualquier combinación válida de noches y precios", () => {
    const cases = [
      { nights: 1, d: "10.00", s: "10.00" }, // iguales: el borde
      { nights: 30, d: "0.01", s: "999.99" },
      { nights: 7, d: "88.50", s: "132.75" },
    ];
    for (const c of cases) {
      const r = calculateTripCost({
        ...BASE,
        accommodations: [
          {
            nights: c.nights,
            pricePerNightDouble: c.d,
            pricePerNightSingle: c.s,
          },
        ],
      });
      expect(
        r.totalSingle.greaterThanOrEqualTo(r.totalDouble),
        JSON.stringify(c),
      ).toBe(true);
    }
  });

  it("el indirecto por pasajero es idéntico para doble y para single", () => {
    // Los indirectos no dependen del tipo de habitación: toda la diferencia
    // entre las dos bases viene del alojamiento.
    const r = calculateTripCost(BASE);
    expect(r.totalSingle.minus(r.totalDouble).toString()).toBe(
      r.directSingle.minus(r.directDouble).toString(),
    );
  });
});

describe("el coordinador no altera el costo", () => {
  it("el costo directo no depende de la lista de pasajeros", () => {
    // Por construcción: calculateTripCost ni siquiera recibe pasajeros. El
    // alojamiento del coordinador se carga como IndirectCost.
    const result = calculateTripCost(BASE);
    expect(result.directDouble.toString()).toBe("1778");
    expect(result.directSingle.toString()).toBe("2623");
  });

  it("un coordinador con roomType asignado no entra en los ingresos", () => {
    const breakdown = calculateTripCost(BASE);
    const prices = { priceDouble: "3990.00", priceSingle: "4890.00" };

    const sinCoordinador = calculateTripMargin(
      breakdown,
      prices,
      [passenger(), passenger()],
      14,
    );
    const conCoordinador = calculateTripMargin(
      breakdown,
      prices,
      [
        passenger(),
        passenger(),
        // Ocupa una single y está CONFIRMADO, pero no se le factura.
        passenger({ isCoordinator: true, roomType: "SINGLE" }),
      ],
      14,
    );

    expect(conCoordinador.totals[0]!.revenue.toString()).toBe(
      sinCoordinador.totals[0]!.revenue.toString(),
    );
    expect(conCoordinador.totals[0]!.margin.toString()).toBe(
      sinCoordinador.totals[0]!.margin.toString(),
    );
    expect(conCoordinador.totals[0]!.basis).toEqual({
      kind: "CONFIRMADOS",
      doubleCount: 2,
      singleCount: 0,
    });
  });
});

describe("margen por pasajero", () => {
  const breakdown = calculateTripCost(BASE);

  it("es precio menos costo, para cada base", () => {
    const result = calculateTripMargin(
      breakdown,
      { priceDouble: "3990.00", priceSingle: "4890.00" },
      [],
      14,
    );
    expect(result.perPassengerDouble!.margin.toString()).toBe("490.57");
    expect(result.perPassengerSingle!.margin.toString()).toBe("545.57");
  });

  it("expresa el porcentaje sobre el precio, no sobre el costo", () => {
    const result = calculateTripMargin(
      breakdown,
      { priceDouble: "3990.00" },
      [],
      14,
    );
    // 490.57 / 3990 = 12.29%  (sobre costo daría 14.02%)
    expect(result.perPassengerDouble!.marginPercent.toString()).toBe("12.29");
  });

  it("devuelve null para el precio que todavía no se fijó", () => {
    const result = calculateTripMargin(
      breakdown,
      { priceDouble: "3990.00", priceSingle: null },
      [],
      14,
    );
    expect(result.perPassengerDouble).not.toBeNull();
    expect(result.perPassengerSingle).toBeNull();
  });

  it("admite margen negativo si el precio quedó por debajo del costo", () => {
    const result = calculateTripMargin(
      breakdown,
      { priceDouble: "3000.00" },
      [],
      14,
    );
    expect(result.perPassengerDouble!.margin.isNegative()).toBe(true);
    expect(result.perPassengerDouble!.marginPercent.isNegative()).toBe(true);
  });
});

describe("margen total — el mix nunca queda implícito", () => {
  const breakdown = calculateTripCost(BASE);
  const prices = { priceDouble: "3990.00", priceSingle: "4890.00" };

  it("sin confirmados devuelve DOS escenarios, no un número único", () => {
    const result = calculateTripMargin(breakdown, prices, [], 14);

    expect(result.totals).toHaveLength(2);
    expect(result.totals[0]!.basis).toEqual({
      kind: "ESCENARIO",
      scenario: "TODOS_DOBLE",
      passengerCount: 14,
    });
    expect(result.totals[1]!.basis).toEqual({
      kind: "ESCENARIO",
      scenario: "TODOS_SINGLE",
      passengerCount: 14,
    });
  });

  it("los escenarios usan los presupuestados", () => {
    const result = calculateTripMargin(breakdown, prices, [], 14);
    // 490.57 × 14 = 6867.98
    expect(result.totals[0]!.margin.toString()).toBe("6867.98");
    // 545.57 × 14 = 7637.98
    expect(result.totals[1]!.margin.toString()).toBe("7637.98");
  });

  it("los pasajeros no confirmados no cuentan como mix real", () => {
    // Invitados y registrados todavía pueden no viajar.
    const result = calculateTripMargin(
      breakdown,
      prices,
      [
        passenger({ status: "INVITADO" }),
        passenger({ status: "REGISTRADO" }),
        passenger({ status: "CANCELADO" }),
      ],
      14,
    );
    expect(result.totals).toHaveLength(2);
    expect(result.totals[0]!.basis.kind).toBe("ESCENARIO");
  });

  it("con confirmados devuelve UN total y dice de qué mix salió", () => {
    const result = calculateTripMargin(
      breakdown,
      prices,
      [
        passenger({ roomType: "DOBLE" }),
        passenger({ roomType: "DOBLE" }),
        passenger({ roomType: "SINGLE" }),
      ],
      14,
    );

    expect(result.totals).toHaveLength(1);
    expect(result.totals[0]!.basis).toEqual({
      kind: "CONFIRMADOS",
      doubleCount: 2,
      singleCount: 1,
    });
    // 3990×2 + 4890 = 12870
    expect(result.totals[0]!.revenue.toString()).toBe("12870");
    // 490.57×2 + 545.57 = 1526.71
    expect(result.totals[0]!.margin.toString()).toBe("1526.71");
  });

  it("todo total declara siempre su base de cálculo", () => {
    // La regla que evita el "£6.800 de margen" sin decir con cuántos singles.
    for (const passengers of [[], [passenger()], [passenger({ roomType: "SINGLE" })]]) {
      const result = calculateTripMargin(breakdown, prices, passengers, 14);
      for (const total of result.totals) {
        expect(total.basis).toBeDefined();
        expect(["CONFIRMADOS", "ESCENARIO"]).toContain(total.basis.kind);
      }
    }
  });

  it("respeta el priceOverride de un pasajero", () => {
    const result = calculateTripMargin(
      breakdown,
      prices,
      [
        passenger({ roomType: "DOBLE" }),
        // Se quedó sin compañero y el coordinador le pactó otro precio.
        passenger({ roomType: "DOBLE", priceOverride: "4200.00" }),
      ],
      14,
    );
    // 3990 + 4200 = 8190
    expect(result.totals[0]!.revenue.toString()).toBe("8190");
  });

  it("sin ningún precio fijado no inventa márgenes", () => {
    const result = calculateTripMargin(
      breakdown,
      { priceDouble: null, priceSingle: null },
      [passenger()],
      14,
    );
    expect(result.totals).toHaveLength(0);
    expect(result.perPassengerDouble).toBeNull();
    expect(result.perPassengerSingle).toBeNull();
  });

  it("omite al confirmado cuyo tipo de habitación no tiene precio", () => {
    // Contarlo como ingreso cero mostraría un margen falsamente negativo.
    const result = calculateTripMargin(
      breakdown,
      { priceDouble: "3990.00", priceSingle: null },
      [passenger({ roomType: "DOBLE" }), passenger({ roomType: "SINGLE" })],
      14,
    );
    expect(result.totals[0]!.basis).toEqual({
      kind: "CONFIRMADOS",
      doubleCount: 1,
      singleCount: 0,
    });
    expect(result.totals[0]!.revenue.toString()).toBe("3990");
  });
});

describe("compareCost — impacto antes de guardar", () => {
  it("informa el cambio en el costo por pasajero", () => {
    const before = calculateTripCost(BASE);
    const after = calculateTripCost({
      ...BASE,
      indirectCosts: [...BASE.indirectCosts, { totalAmount: "1400.00" }],
    });

    const impact = compareCost(before, after);
    expect(impact.double.before.toString()).toBe("3499.43");
    expect(impact.double.after.toString()).toBe("3599.43");
    expect(impact.double.delta.toString()).toBe("100");
    expect(impact.double.changed).toBe(true);
  });

  it("marca changed=false cuando el número no se movió", () => {
    const same = calculateTripCost(BASE);
    const impact = compareCost(same, calculateTripCost(BASE));
    expect(impact.double.changed).toBe(false);
    expect(impact.double.delta.toString()).toBe("0");
    expect(impact.single.changed).toBe(false);
  });

  it("informa una baja con delta negativo", () => {
    const before = calculateTripCost(BASE);
    const after = calculateTripCost({ ...BASE, indirectCosts: [] });
    const impact = compareCost(before, after);
    expect(impact.double.delta.toString()).toBe("-1721.43");
  });
});
