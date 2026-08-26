import { describe, expect, it } from "vitest";
import {
  convert,
  deriveRate,
  equivalences,
  FxError,
  parseFxSnapshot,
  type FxSnapshot,
} from "@/lib/domain/fx";

/** Cotización del 24/08/2026 (viernes), con base USD. */
const SNAPSHOT: FxSnapshot = {
  base: "USD",
  date: new Date("2026-08-24T00:00:00.000Z"),
  rates: { USD: "1", EUR: "0.8571", GBP: "0.7402" },
};

describe("deriveRate", () => {
  it("devuelve 1 para la misma moneda", () => {
    expect(deriveRate(SNAPSHOT, "GBP", "GBP").toString()).toBe("1");
  });

  it("usa la tasa directa contra el dólar", () => {
    expect(deriveRate(SNAPSHOT, "USD", "GBP").toString()).toBe("0.7402");
    expect(deriveRate(SNAPSHOT, "USD", "EUR").toString()).toBe("0.8571");
  });

  it("deriva el cruce GBP↔EUR desde el dólar", () => {
    // EUR/GBP = 0.8571 / 0.7402 = 1.1579302891…
    // Se usa toFixed y no toString porque toString descarta el cero final.
    const rate = deriveRate(SNAPSHOT, "GBP", "EUR");
    expect(rate.toFixed(6)).toBe("1.157930");
  });

  it("el cruce inverso es el recíproco exacto", () => {
    // Nunca guardamos cruces precalculados: derivarlos garantiza que ida y
    // vuelta sean consistentes entre sí.
    const ida = deriveRate(SNAPSHOT, "GBP", "EUR");
    const vuelta = deriveRate(SNAPSHOT, "EUR", "GBP");
    expect(ida.times(vuelta).toDecimalPlaces(10).toString()).toBe("1");
  });

  it("falla ante una cotización inválida en vez de propagar NaN", () => {
    const roto: FxSnapshot = {
      ...SNAPSHOT,
      rates: { USD: "1", EUR: "0", GBP: "0.7402" },
    };
    expect(() => deriveRate(roto, "EUR", "GBP")).toThrow(FxError);
  });
});

describe("convert", () => {
  it("no toca el importe si la moneda es la misma", () => {
    expect(convert("1330.00", "GBP", "GBP", SNAPSHOT).toString()).toBe("1330");
  });

  it("convierte de la moneda del viaje al dólar", () => {
    // 1330 GBP / 0.7402 = 1796.81…
    expect(convert("1330.00", "GBP", "USD", SNAPSHOT).toString()).toBe(
      "1796.81",
    );
  });

  it("convierte cruzado entre libras y euros", () => {
    // 1330 × (0.8571 / 0.7402) = 1540.05…
    expect(convert("1330.00", "GBP", "EUR", SNAPSHOT).toString()).toBe(
      "1540.05",
    );
  });

  it("redondea una sola vez, al final", () => {
    // Si se redondeara el tipo de cambio antes de multiplicar, el error
    // crecería con el importe. Con 1.157931 truncado a 4 decimales el
    // resultado se desviaría más de un centavo en importes grandes.
    const grande = convert("1000000.00", "GBP", "EUR", SNAPSHOT);
    expect(grande.toString()).toBe("1157930.29");
  });

  it("ida y vuelta no se desvía más de un centavo", () => {
    const ida = convert("3990.00", "GBP", "EUR", SNAPSHOT);
    const vuelta = convert(ida, "EUR", "GBP", SNAPSHOT);
    expect(vuelta.minus("3990.00").abs().lessThanOrEqualTo("0.01")).toBe(true);
  });
});

describe("equivalences", () => {
  it("devuelve las otras dos monedas, nunca la propia", () => {
    const result = equivalences("3990.00", "GBP", SNAPSHOT);
    expect(result.values.map((v) => v.currency).sort()).toEqual(["EUR", "USD"]);
  });

  it("viaja siempre con la fecha de la cotización", () => {
    // Un importe convertido sin decir de cuándo es el TC induce a error.
    const result = equivalences("3990.00", "GBP", SNAPSHOT);
    expect(result.rateDate).toEqual(SNAPSHOT.date);
  });

  it("usa la fecha del BCE, no la de consulta", () => {
    // La API se consultó un domingo pero devolvió el viernes: la leyenda
    // "cotización del …" tiene que decir viernes.
    const result = equivalences("100", "USD", SNAPSHOT);
    expect(result.rateDate.toISOString().slice(0, 10)).toBe("2026-08-24");
  });
});

describe("parseFxSnapshot", () => {
  it("acepta el formato que guarda PaymentPlan.fxSnapshot", () => {
    const parsed = parseFxSnapshot({
      base: "USD",
      date: "2026-08-24",
      rates: { EUR: "0.8571", GBP: "0.7402" },
    });
    expect(parsed.date.toISOString().slice(0, 10)).toBe("2026-08-24");
    expect(parsed.rates.GBP).toBe("0.7402");
  });

  it("completa USD = 1 aunque no venga en el JSON", () => {
    const parsed = parseFxSnapshot({
      base: "USD",
      date: "2026-08-24",
      rates: { EUR: "0.8571", GBP: "0.7402" },
    });
    expect(parsed.rates.USD).toBe("1");
  });

  it("acepta números además de strings", () => {
    const parsed = parseFxSnapshot({
      base: "USD",
      date: "2026-08-24",
      rates: { EUR: 0.8571, GBP: 0.7402 },
    });
    expect(parsed.rates.EUR).toBe("0.8571");
  });

  it("rechaza un snapshot incompleto en vez de convertir mal", () => {
    const invalidos: unknown[] = [
      null,
      "no soy un objeto",
      { base: "EUR", date: "2026-08-24", rates: { GBP: "0.74" } },
      { base: "USD", date: "2026-08-24", rates: { EUR: "0.8571" } },
      { base: "USD", rates: { EUR: "0.8571", GBP: "0.7402" } },
      { base: "USD", date: "2026-08-24" },
    ];
    for (const value of invalidos) {
      expect(() => parseFxSnapshot(value), JSON.stringify(value)).toThrow(
        FxError,
      );
    }
  });
});

describe("congelamiento del tipo de cambio", () => {
  it("un plan viejo sigue convirtiendo con SU cotización", () => {
    // Los importes de las cuotas no se recalculan: el snapshot guardado en el
    // plan es el que manda, aunque hoy el mercado esté en otro lado.
    const congelado = parseFxSnapshot({
      base: "USD",
      date: "2026-08-24",
      rates: { EUR: "0.8571", GBP: "0.7402" },
    });
    const hoy: FxSnapshot = {
      base: "USD",
      date: new Date("2027-02-01T00:00:00.000Z"),
      rates: { USD: "1", EUR: "0.9100", GBP: "0.8000" },
    };

    const conCongelado = convert("1330.00", "GBP", "EUR", congelado);
    const conActual = convert("1330.00", "GBP", "EUR", hoy);

    expect(conCongelado.toString()).toBe("1540.05");
    expect(conActual.toString()).toBe("1512.88");
    expect(conCongelado.equals(conActual)).toBe(false);
  });
});
