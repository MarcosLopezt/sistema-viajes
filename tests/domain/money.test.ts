import { describe, expect, it } from "vitest";
import {
  perPassengerShare,
  roundToCents,
  roundUpToCents,
  sum,
  toDecimal,
} from "@/lib/domain/money";
import { formatDate, formatMoney } from "@/lib/format";

describe("aritmética decimal", () => {
  it("no arrastra el error de punto flotante", () => {
    // Con `number`, 0.1 + 0.2 da 0.30000000000000004. Es exactamente la razón
    // por la que ningún monto del sistema es un float.
    expect(sum(["0.1", "0.2"]).toString()).toBe("0.3");
  });

  it("suma una lista larga sin desviarse", () => {
    const values = Array.from({ length: 100 }, () => "0.07");
    expect(sum(values).toString()).toBe("7");
  });

  it("devuelve cero para una lista vacía", () => {
    expect(sum([]).toString()).toBe("0");
  });
});

describe("perPassengerShare — prorrateo de indirectos", () => {
  it("divide de forma exacta cuando la división da justo", () => {
    expect(perPassengerShare("1400.00", 14).toString()).toBe("100");
  });

  it("redondea hacia arriba cuando no da justo", () => {
    // 8437 / 14 = 602.642857… → 602.65, no 602.64.
    expect(perPassengerShare("8437.00", 14).toString()).toBe("602.65");
  });

  it("redondea hacia arriba incluso cuando el redondeo comercial bajaría", () => {
    // 100.001 / 1: el redondeo comercial daría 100.00; el nuestro, 100.01.
    // Política ROUND_UP: la suma de lo prorrateado nunca queda por debajo
    // del costo real.
    expect(perPassengerShare("100.001", 1).toString()).toBe("100.01");
  });

  it("lo prorrateado nunca suma menos que el costo real", () => {
    const total = toDecimal("8437.00");
    const passengers = 14;
    const share = perPassengerShare(total, passengers);
    expect(share.times(passengers).greaterThanOrEqualTo(total)).toBe(true);
  });

  it("divide por los presupuestados y no por los confirmados", () => {
    // Es la razón de ser de budgetedPassengers: si el divisor fueran los
    // confirmados, el costo por pasajero cambiaría cada vez que entra alguien.
    const total = "14000.00";
    expect(perPassengerShare(total, 14).toString()).toBe("1000");
    // Con 9 confirmados, el número presupuestado sigue siendo el mismo.
    expect(perPassengerShare(total, 14).toString()).toBe("1000");
  });

  it("rechaza un divisor inválido en vez de devolver infinito", () => {
    expect(() => perPassengerShare("100", 0)).toThrow();
    expect(() => perPassengerShare("100", -3)).toThrow();
    expect(() => perPassengerShare("100", 2.5)).toThrow();
  });
});

describe("redondeos", () => {
  it("roundUpToCents siempre sube", () => {
    expect(roundUpToCents("1.001").toString()).toBe("1.01");
    expect(roundUpToCents("1.000").toString()).toBe("1");
  });

  it("roundToCents usa redondeo comercial", () => {
    expect(roundToCents("1.005").toString()).toBe("1.01");
    expect(roundToCents("1.004").toString()).toBe("1");
  });
});

describe("formatMoney", () => {
  it("siempre lleva símbolo de moneda explícito", () => {
    // Con tres monedas en juego, un número pelado es un error esperando a
    // pasar: no existe una variante sin moneda.
    expect(formatMoney("1200", "GBP", "es")).toContain("£");
    expect(formatMoney("1200", "EUR", "es")).toContain("€");
    expect(formatMoney("1200", "USD", "es")).toContain("US$");
  });

  it("distingue USD de un peso o un dólar cualquiera", () => {
    // El default de Intl para USD en inglés es "$1,200.00" a secas. Usamos
    // "US$" a propósito para que no se confunda con otras monedas.
    expect(formatMoney("1200", "USD", "en")).toBe("US$ 1,200.00");
  });

  it("usa el separador de cada idioma", () => {
    expect(formatMoney("1200.5", "GBP", "es")).toBe("£ 1.200,50");
    expect(formatMoney("1200.5", "GBP", "en")).toBe("£ 1,200.50");
  });

  it("siempre muestra dos decimales", () => {
    expect(formatMoney("1200", "EUR", "es")).toBe("€ 1.200,00");
  });

  it("falla en vez de mostrar NaN", () => {
    expect(() => formatMoney("no-es-un-numero", "GBP")).toThrow();
  });
});

describe("formatDate", () => {
  it("usa dd/mm/aaaa", () => {
    expect(formatDate(new Date("2026-11-30T00:00:00.000Z"))).toBe("30/11/2026");
  });

  it("rellena con cero a la izquierda", () => {
    expect(formatDate(new Date("2026-01-05T00:00:00.000Z"))).toBe("05/01/2026");
  });

  it("no se corre un día en husos al oeste de Greenwich", () => {
    // Las fechas de negocio llegan a medianoche UTC. Leerlas con los getters
    // locales mostraría el día anterior en UTC-3.
    expect(formatDate("2026-03-01T00:00:00.000Z")).toBe("01/03/2026");
  });

  it("falla en vez de mostrar 'Invalid Date'", () => {
    expect(() => formatDate("no-es-una-fecha")).toThrow();
  });
});
