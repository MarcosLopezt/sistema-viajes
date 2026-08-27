import { describe, expect, it } from "vitest";
import {
  derivePlan,
  impute,
  lateDueDates,
  splitIntoInstallments,
  suggestDueDates,
  worstLight,
  MAX_INSTALLMENTS,
  PaymentPlanError,
  type PaymentInput,
} from "@/lib/domain/payments";
import { sum, toDecimal } from "@/lib/domain/money";

/**
 * Tests del motor de pagos.
 *
 * Dos cosas se prueban con especial saña, porque son las dos que si fallan
 * fallan en silencio:
 *
 *   - que la suma de las cuotas sea EXACTAMENTE el total, para toda cantidad
 *     de cuotas y con montos de los feos;
 *   - que "vencida" se derive bien en los bordes: vence hoy, venció ayer,
 *     pagada y vencida, cancelada.
 */

/**
 * Las fechas de este test son `CalendarDate`: días, no instantes. El motor no
 * acepta otra cosa, justamente para que ningún huso pueda correr un
 * vencimiento. Ver src/lib/domain/calendar.ts y tests/domain/calendar.test.ts.
 */
const day = (iso: string) => iso;

// ------------------------- Reparto de las cuotas ---------------------------

describe("splitIntoInstallments · la suma cierra siempre", () => {
  /**
   * El caso del enunciado y una tanda de montos elegidos para que la división
   * no dé nunca exacta: terminaciones en 1, 3, 7 y 9 céntimos, y montos donde
   * el tercio y el sexto son periódicos.
   */
  const AMOUNTS = [
    "3499.43",
    "3990.00",
    "0.01",
    "0.07",
    "1.00",
    "10.00",
    "100.01",
    "1234.56",
    "9999.99",
    "3333.33",
    "4100.07",
    "1.99",
    "0.05",
    "12345.67",
  ];

  for (const total of AMOUNTS) {
    for (let n = 1; n <= MAX_INSTALLMENTS; n += 1) {
      it(`${total} en ${n} cuota(s) suma exactamente ${total}`, () => {
        const cuotas = splitIntoInstallments(total, n);
        expect(cuotas).toHaveLength(n);

        const total_ = sum(cuotas.map((c) => c.toString()));
        // `equals` de decimal.js, no toBe sobre strings: 3990 y 3990.00 son el
        // mismo número y las dos formas son correctas.
        expect(total_.equals(toDecimal(total))).toBe(true);

        // Ninguna cuota puede ser negativa: el redondeo se absorbe, no se
        // compensa dándole plata al pasajero.
        for (const cuota of cuotas) {
          expect(cuota.greaterThanOrEqualTo(0)).toBe(true);
          expect(cuota.decimalPlaces()).toBeLessThanOrEqual(2);
        }
      });
    }
  }

  it("el caso del enunciado: £3.499,43 en 3 · la última absorbe", () => {
    const [a, b, c] = splitIntoInstallments("3499.43", 3);
    expect(a!.toFixed(2)).toBe("1166.48");
    expect(b!.toFixed(2)).toBe("1166.48");
    // 3499.43 − 2332.96 = 1166.47: un centavo menos, en la última.
    expect(c!.toFixed(2)).toBe("1166.47");
  });

  it("una sola cuota es el total, sin tocar", () => {
    expect(splitIntoInstallments("3499.43", 1)[0]!.toFixed(2)).toBe("3499.43");
  });

  it("la diferencia SIEMPRE cae en la última, nunca en la primera", () => {
    const cuotas = splitIntoInstallments("100.01", 3);
    expect(cuotas[0]!.toFixed(2)).toBe("33.34");
    expect(cuotas[1]!.toFixed(2)).toBe("33.34");
    expect(cuotas[2]!.toFixed(2)).toBe("33.33");
  });

  it("rechaza cantidades de cuotas fuera de 1..6", () => {
    for (const n of [0, -1, 7, 12, 1.5]) {
      expect(() => splitIntoInstallments("1000.00", n)).toThrow(
        PaymentPlanError,
      );
    }
  });

  it("rechaza un total que no es plata cobrable", () => {
    for (const total of ["0", "0.00", "-100.00"]) {
      expect(() => splitIntoInstallments(total, 3)).toThrow(PaymentPlanError);
    }
  });
});

// ----------------------------- Vencimientos --------------------------------

describe("suggestDueDates", () => {
  const today = day("2026-08-26");
  const departure = day("2027-05-10");

  it("reparte las cuotas entre hoy y una semana antes de la salida", () => {
    const dates = suggestDueDates(3, today, departure);
    expect(dates.map((d) => d.dueDate)).toEqual([
      "2026-11-17",
      "2027-02-09",
      "2027-05-03",
    ]);
  });

  it("la última cuota vence antes de la salida", () => {
    for (let n = 1; n <= MAX_INSTALLMENTS; n += 1) {
      const dates = suggestDueDates(n, today, departure);
      const last = dates[dates.length - 1]!;
      expect(last.dueDate < departure).toBe(true);
      expect(last.afterDeparture).toBe(false);
    }
  });

  it("las fechas son estrictamente crecientes", () => {
    for (let n = 1; n <= MAX_INSTALLMENTS; n += 1) {
      const dates = suggestDueDates(n, today, departure);
      for (let i = 1; i < dates.length; i += 1) {
        expect(dates[i]!.dueDate > dates[i - 1]!.dueDate).toBe(true);
      }
    }
  });

  it("ninguna cuota vence hoy o antes: la primera es siempre a futuro", () => {
    const dates = suggestDueDates(6, today, departure);
    for (const d of dates) {
      expect(d.dueDate > today).toBe(true);
    }
  });

  /**
   * El viaje sale en cuatro días y el coordinador pide seis cuotas. No se
   * inventa nada ni se falla: las cuotas se separan un día y las que caen
   * tarde vuelven marcadas para que la pantalla lo advierta.
   */
  it("con la salida encima, avisa en vez de esconderlo", () => {
    const soon = day("2026-08-30");
    const dates = suggestDueDates(6, today, soon);

    expect(dates.some((d) => d.afterDeparture)).toBe(true);
    expect(lateDueDates(dates, soon).length).toBeGreaterThan(0);
    // Siguen siendo seis fechas distintas.
    expect(new Set(dates.map((d) => d.dueDate)).size).toBe(6);
  });

  it("lateDueDates devuelve los números de las cuotas tardías", () => {
    const soon = day("2026-08-29");
    const dates = suggestDueDates(4, today, soon);
    expect(lateDueDates(dates, soon)).toEqual(
      dates.filter((d) => d.afterDeparture).map((d) => d.number),
    );
  });
});

// ------------------------- Derivación del estado ---------------------------

const TODAY = day("2026-08-26");

interface Fixture {
  amounts?: string[];
  dueDates?: string[];
  payments?: Partial<PaymentInput>[];
  today?: string;
  frozen?: boolean;
  tolerance?: string;
  total?: string;
}

function plan(fixture: Fixture = {}) {
  const amounts = fixture.amounts ?? ["1330.00", "1330.00", "1330.00"];
  const dueDates = fixture.dueDates ?? [
    "2026-07-15",
    "2026-08-15",
    "2026-11-15",
  ];

  return derivePlan({
    totalAmount:
      fixture.total ?? sum(amounts).toFixed(2),
    installments: amounts.map((amount, index) => ({
      id: `c${index + 1}`,
      number: index + 1,
      dueDate: day(dueDates[index]!),
      amount,
    })),
    payments: (fixture.payments ?? []).map((p, index) => ({
      id: p.id ?? `p${index + 1}`,
      installmentId: p.installmentId ?? null,
      kind: p.kind ?? "PAGO",
      status: p.status ?? "CONFIRMADO",
      amountInTripCurrency: p.amountInTripCurrency ?? "0",
    })),
    today: fixture.today ?? TODAY,
    frozen: fixture.frozen,
    tolerance: fixture.tolerance,
  });
}

describe("VENCIDA se deriva, y se deriva bien en los bordes", () => {
  it("vence HOY y no está pagada: todavía NO está vencida", () => {
    // El pasajero tiene todo el día para pagar. Marcarla vencida a las 00:00
    // del día del vencimiento es cobrarle un día antes de lo que se le dijo.
    const state = plan({
      dueDates: ["2026-08-26", "2026-09-26", "2026-10-26"],
    });
    expect(state.installments[0]!.state).toBe("PENDIENTE");
    expect(state.installments[0]!.overdue).toBe(false);
    expect(state.installments[0]!.daysUntilDue).toBe(0);
  });

  it("venció AYER y no está pagada: vencida", () => {
    const state = plan({
      dueDates: ["2026-08-25", "2026-09-26", "2026-10-26"],
    });
    expect(state.installments[0]!.state).toBe("VENCIDA");
    expect(state.installments[0]!.overdue).toBe(true);
    expect(state.overdueCount).toBe(1);
    expect(state.light).toBe("ROJO");
  });

  it("venció ayer PERO está pagada: no está vencida", () => {
    const state = plan({
      dueDates: ["2026-08-25", "2026-09-26", "2026-10-26"],
      payments: [{ installmentId: "c1", amountInTripCurrency: "1330.00" }],
    });
    expect(state.installments[0]!.state).toBe("PAGADA");
    expect(state.installments[0]!.overdue).toBe(false);
    expect(state.overdueCount).toBe(0);
  });

  it("un comprobante EN REVISIÓN no limpia una cuota vencida", () => {
    // Todavía no entró la plata. Decir que no está vencida porque alguien
    // subió un PDF sería confiar en el PDF.
    const state = plan({
      dueDates: ["2026-08-25", "2026-09-26", "2026-10-26"],
      payments: [
        {
          installmentId: "c1",
          status: "EN_REVISION",
          amountInTripCurrency: "1330.00",
        },
      ],
    });
    expect(state.installments[0]!.state).toBe("VENCIDA");
    expect(state.installments[0]!.overdue).toBe(true);
    // Pero se sabe que hay algo en revisión: la pantalla lo puede decir.
    expect(state.installments[0]!.hasPendingProof).toBe(true);
    expect(state.light).toBe("ROJO");
  });

  it("un pago RECHAZADO no cuenta para nada", () => {
    const state = plan({
      dueDates: ["2026-08-25", "2026-09-26", "2026-10-26"],
      payments: [
        {
          installmentId: "c1",
          status: "RECHAZADO",
          amountInTripCurrency: "1330.00",
        },
      ],
    });
    expect(state.installments[0]!.state).toBe("VENCIDA");
    expect(state.paidTotal.toFixed(2)).toBe("0.00");
  });

  it("no depende de que ningún cron haya corrido: mismo dato, otro día", () => {
    const dueDates = ["2026-08-27", "2026-09-26", "2026-10-26"];

    // Ayer, la cuota no estaba vencida.
    expect(plan({ dueDates, today: day("2026-08-26") }).light).not.toBe("ROJO");
    // Hoy tampoco: vence hoy.
    expect(
      plan({ dueDates, today: day("2026-08-27") }).installments[0]!.state,
    ).toBe("PENDIENTE");
    // Mañana sí, sin que nadie haya escrito nada en la base.
    expect(
      plan({ dueDates, today: day("2026-08-28") }).installments[0]!.state,
    ).toBe("VENCIDA");
  });
});

describe("pago parcial y tolerancia", () => {
  it("dentro de la tolerancia, la cuota se da por PAGADA", () => {
    // Llegaron £1.329,20 de una cuota de £1.330: se comió £0,80 el banco.
    const state = plan({
      payments: [{ installmentId: "c1", amountInTripCurrency: "1329.20" }],
    });
    expect(state.installments[0]!.state).toBe("PAGADA");
    expect(state.installments[0]!.remaining.toFixed(2)).toBe("0.00");
  });

  it("justo en el borde de la tolerancia, PAGADA", () => {
    const state = plan({
      payments: [{ installmentId: "c1", amountInTripCurrency: "1329.00" }],
    });
    expect(state.installments[0]!.state).toBe("PAGADA");
  });

  it("un centavo fuera de la tolerancia, NO está pagada", () => {
    const state = plan({
      dueDates: ["2026-12-01", "2027-01-01", "2027-02-01"],
      payments: [{ installmentId: "c1", amountInTripCurrency: "1328.99" }],
    });
    expect(state.installments[0]!.state).toBe("PENDIENTE");
    expect(state.installments[0]!.remaining.toFixed(2)).toBe("1.01");
  });

  it("la tolerancia es configurable", () => {
    const strict = plan({
      payments: [{ installmentId: "c1", amountInTripCurrency: "1329.20" }],
      tolerance: "0",
    });
    expect(strict.installments[0]!.state).toBe("VENCIDA");

    const loose = plan({
      payments: [{ installmentId: "c1", amountInTripCurrency: "1300.00" }],
      tolerance: "50.00",
    });
    expect(loose.installments[0]!.state).toBe("PAGADA");
  });

  it("dos pagos parciales que juntos cubren la cuota, la cubren", () => {
    const state = plan({
      payments: [
        { id: "p1", installmentId: "c1", amountInTripCurrency: "700.00" },
        { id: "p2", installmentId: "c1", amountInTripCurrency: "630.00" },
      ],
    });
    expect(state.installments[0]!.state).toBe("PAGADA");
    expect(state.installments[0]!.paid.toFixed(2)).toBe("1330.00");
  });

  it("la tolerancia NO se aplica al revés: lo que entra de más es exacto", () => {
    const state = plan({
      payments: [{ installmentId: "c1", amountInTripCurrency: "1330.50" }],
    });
    expect(state.installments[0]!.excess.toFixed(2)).toBe("0.50");
    expect(state.credit.toFixed(2)).toBe("0.50");
  });
});

describe("excedente", () => {
  it("queda como crédito y NO se imputa solo a la cuota siguiente", () => {
    const state = plan({
      dueDates: ["2026-12-01", "2027-01-01", "2027-02-01"],
      payments: [{ installmentId: "c1", amountInTripCurrency: "2000.00" }],
    });

    expect(state.installments[0]!.state).toBe("PAGADA");
    expect(state.credit.toFixed(2)).toBe("670.00");
    // La cuota 2 sigue intacta: la decisión de usar el crédito es del
    // coordinador, no un automatismo del sistema.
    expect(state.installments[1]!.state).toBe("PENDIENTE");
    expect(state.installments[1]!.paid.toFixed(2)).toBe("0.00");
    expect(state.installments[1]!.remaining.toFixed(2)).toBe("1330.00");
  });

  it("un pago confirmado sin cuota asignada también es crédito", () => {
    const state = plan({
      dueDates: ["2026-12-01", "2027-01-01", "2027-02-01"],
      payments: [{ installmentId: null, amountInTripCurrency: "500.00" }],
    });
    expect(state.credit.toFixed(2)).toBe("500.00");
    expect(state.installments.every((i) => i.state === "PENDIENTE")).toBe(true);
  });

  it("pagar de más no deja el saldo en negativo", () => {
    const state = plan({
      payments: [
        { id: "p1", installmentId: "c1", amountInTripCurrency: "5000.00" },
      ],
    });
    expect(state.balance.toFixed(2)).toBe("0.00");
  });
});

describe("reembolso", () => {
  it("no altera el estado de ninguna cuota", () => {
    const withoutRefund = plan({
      payments: [{ installmentId: "c1", amountInTripCurrency: "1330.00" }],
    });
    const withRefund = plan({
      payments: [
        { id: "p1", installmentId: "c1", amountInTripCurrency: "1330.00" },
        {
          id: "p2",
          installmentId: null,
          kind: "REEMBOLSO",
          amountInTripCurrency: "500.00",
        },
      ],
    });

    expect(withRefund.installments.map((i) => i.state)).toEqual(
      withoutRefund.installments.map((i) => i.state),
    );
    expect(withRefund.paidTotal.toFixed(2)).toBe(
      withoutRefund.paidTotal.toFixed(2),
    );
    expect(withRefund.balance.toFixed(2)).toBe(
      withoutRefund.balance.toFixed(2),
    );
    // Pero se ve, porque es plata que salió.
    expect(withRefund.refundedTotal.toFixed(2)).toBe("500.00");
  });

  it("tampoco cuenta como crédito", () => {
    const state = plan({
      payments: [
        {
          installmentId: null,
          kind: "REEMBOLSO",
          amountInTripCurrency: "500.00",
        },
      ],
    });
    expect(state.credit.toFixed(2)).toBe("0.00");
  });
});

describe("plan congelado · pasajero cancelado", () => {
  it("no genera vencidas aunque las fechas hayan pasado", () => {
    const state = plan({
      dueDates: ["2026-01-15", "2026-02-15", "2026-03-15"],
      frozen: true,
    });
    expect(state.overdueCount).toBe(0);
    expect(state.installments.every((i) => i.state === "CONGELADA")).toBe(true);
    expect(state.light).toBe("NEUTRO");
  });

  it("lo que ya pagó se sigue viendo: hay que devolvérselo", () => {
    const state = plan({
      dueDates: ["2026-01-15", "2026-02-15", "2026-03-15"],
      frozen: true,
      payments: [{ installmentId: "c1", amountInTripCurrency: "1330.00" }],
    });
    expect(state.paidTotal.toFixed(2)).toBe("1330.00");
    expect(state.installments[0]!.state).toBe("PAGADA");
  });
});

// -------------------------------- Semáforo ---------------------------------

describe("semáforo de pagos", () => {
  it("🟢 sin vencidas, sin revisión y sin nada que venza pronto", () => {
    const state = plan({
      dueDates: ["2026-10-01", "2026-11-01", "2026-12-01"],
    });
    expect(state.light).toBe("VERDE");
  });

  it("🟡 con un comprobante en revisión", () => {
    const state = plan({
      dueDates: ["2026-10-01", "2026-11-01", "2026-12-01"],
      payments: [
        {
          installmentId: "c1",
          status: "EN_REVISION",
          amountInTripCurrency: "1330.00",
        },
      ],
    });
    expect(state.light).toBe("AMARILLO");
  });

  it("🟡 con una cuota que vence dentro de los 7 días", () => {
    const state = plan({
      dueDates: ["2026-09-02", "2026-11-01", "2026-12-01"],
    });
    expect(state.installments[0]!.daysUntilDue).toBe(7);
    expect(state.light).toBe("AMARILLO");
  });

  it("🟢 con una cuota que vence en 8 días", () => {
    const state = plan({
      dueDates: ["2026-09-03", "2026-11-01", "2026-12-01"],
    });
    expect(state.installments[0]!.daysUntilDue).toBe(8);
    expect(state.light).toBe("VERDE");
  });

  it("🔴 gana sobre el amarillo", () => {
    const state = plan({
      dueDates: ["2026-08-01", "2026-08-30", "2026-12-01"],
      payments: [
        {
          installmentId: "c2",
          status: "EN_REVISION",
          amountInTripCurrency: "1330.00",
        },
      ],
    });
    expect(state.light).toBe("ROJO");
  });

  it("🟢 todo pagado, aunque la última haya vencido", () => {
    const state = plan({
      dueDates: ["2026-01-01", "2026-02-01", "2026-03-01"],
      payments: [
        { id: "p1", installmentId: "c1", amountInTripCurrency: "1330.00" },
        { id: "p2", installmentId: "c2", amountInTripCurrency: "1330.00" },
        { id: "p3", installmentId: "c3", amountInTripCurrency: "1330.00" },
      ],
    });
    expect(state.light).toBe("VERDE");
    expect(state.nextInstallment).toBeNull();
    expect(state.balance.toFixed(2)).toBe("0.00");
  });

  it("worstLight resume el viaje entero", () => {
    expect(worstLight(["VERDE", "AMARILLO", "ROJO"])).toBe("ROJO");
    expect(worstLight(["VERDE", "AMARILLO"])).toBe("AMARILLO");
    expect(worstLight(["VERDE", "VERDE"])).toBe("VERDE");
    expect(worstLight(["NEUTRO"])).toBe("NEUTRO");
    expect(worstLight([])).toBe("NEUTRO");
  });
});

describe("próxima cuota", () => {
  it("es la primera sin saldar, no la primera de la lista", () => {
    const state = plan({
      dueDates: ["2026-07-15", "2026-09-15", "2026-11-15"],
      payments: [{ installmentId: "c1", amountInTripCurrency: "1330.00" }],
    });
    expect(state.nextInstallment?.number).toBe(2);
  });

  it("con una vencida, la próxima es la vencida", () => {
    const state = plan();
    expect(state.nextInstallment?.number).toBe(1);
    expect(state.nextInstallment?.state).toBe("VENCIDA");
  });
});

// ------------------------------- Imputación --------------------------------

describe("impute", () => {
  it("en la moneda del viaje no hay conversión ni TC", () => {
    expect(impute("1330.00", "GBP", "GBP", null).toFixed(2)).toBe("1330.00");
  });

  it("en otra moneda, multiplica por el TC del extracto", () => {
    // El caso del seed: 2.330 € al TC real del banco.
    expect(impute("2330.00", "EUR", "GBP", "0.86373391").toFixed(2)).toBe(
      "2012.50",
    );
  });

  it("sin TC en otra moneda, falla en vez de inventar uno", () => {
    expect(() => impute("2330.00", "EUR", "GBP", null)).toThrow(
      PaymentPlanError,
    );
  });

  it("rechaza un TC que no es un número usable", () => {
    for (const rate of ["0", "-1"]) {
      expect(() => impute("100.00", "EUR", "GBP", rate)).toThrow(
        PaymentPlanError,
      );
    }
  });

  it("redondea una sola vez, al final", () => {
    // 1234.56 × 0.79123456 = 976.83... Redondear el TC antes daría otro número.
    expect(impute("1234.56", "USD", "GBP", "0.79123456").toFixed(2)).toBe(
      "976.83",
    );
  });
});
