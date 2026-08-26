import { describe, expect, it } from "vitest";
import { evaluatePassport } from "@/lib/domain/passport";

/** Helper: fecha de negocio a medianoche UTC, como las guarda `@db.Date`. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const TRIP_END = d("2026-11-30");

const relaxed = {
  tripEndDate: TRIP_END,
  passportValidityMonths: 3,
  requireFullPassportValidity: false,
};

const strict = { ...relaxed, requireFullPassportValidity: true };

describe("evaluatePassport — regla base", () => {
  it("bloquea si vence antes del fin del viaje", () => {
    expect(evaluatePassport(d("2026-10-01"), relaxed).level).toBe("BLOQUEANTE");
  });

  it("bloquea si vence exactamente el día que termina el viaje", () => {
    // La regla es `<=`: un pasaporte que vence el mismo día del regreso no
    // sirve, porque hay que presentarlo al volver a entrar.
    const result = evaluatePassport(TRIP_END, relaxed);
    expect(result.level).toBe("BLOQUEANTE");
    expect(result.blocksConfirmation).toBe(true);
  });

  it("advierte si vence dentro de la ventana de 3 meses posteriores", () => {
    const result = evaluatePassport(d("2027-01-15"), relaxed);
    expect(result.level).toBe("ADVERTENCIA");
    // Advertencia NO bloquea: el coordinador igual puede confirmar.
    expect(result.blocksConfirmation).toBe(false);
  });

  it("advierte en el borde exacto de la ventana (fin + 3 meses)", () => {
    expect(evaluatePassport(d("2027-02-28"), relaxed).level).toBe(
      "ADVERTENCIA",
    );
  });

  it("está OK un día después del borde de la ventana", () => {
    expect(evaluatePassport(d("2027-03-01"), relaxed).level).toBe("OK");
  });

  it("está OK si vence mucho después", () => {
    const result = evaluatePassport(d("2030-01-01"), relaxed);
    expect(result.level).toBe("OK");
    expect(result.blocksConfirmation).toBe(false);
  });

  it("trata la fecha faltante como bloqueante, no como OK", () => {
    // Fallar cerrado: sin el dato no se puede confirmar a nadie.
    for (const value of [null, undefined]) {
      const result = evaluatePassport(value, relaxed);
      expect(result.level).toBe("SIN_DATO");
      expect(result.blocksConfirmation).toBe(true);
    }
  });
});

describe("evaluatePassport — requireFullPassportValidity", () => {
  it("promueve la advertencia a bloqueante", () => {
    const relaxedResult = evaluatePassport(d("2027-01-15"), relaxed);
    const strictResult = evaluatePassport(d("2027-01-15"), strict);

    expect(relaxedResult.level).toBe("ADVERTENCIA");
    expect(strictResult.level).toBe("BLOQUEANTE");
    expect(strictResult.blocksConfirmation).toBe(true);
  });

  it("no cambia nada para un pasaporte que ya estaba OK", () => {
    expect(evaluatePassport(d("2030-01-01"), strict).level).toBe("OK");
  });

  it("no cambia nada para un pasaporte que ya estaba bloqueado", () => {
    expect(evaluatePassport(d("2026-10-01"), strict).level).toBe("BLOQUEANTE");
  });

  it("exige la ventana completa para poder confirmar", () => {
    const { minimumExpiryToConfirm } = evaluatePassport(d("2027-01-15"), strict);
    // Fin del viaje 30/11/2026 + 3 meses = 28/02/2027 → mínimo 01/03/2027.
    expect(minimumExpiryToConfirm.toISOString().slice(0, 10)).toBe(
      "2027-03-01",
    );
  });

  it("con la regla relajada alcanza con superar el fin del viaje", () => {
    const { minimumExpiryToConfirm } = evaluatePassport(
      d("2027-01-15"),
      relaxed,
    );
    expect(minimumExpiryToConfirm.toISOString().slice(0, 10)).toBe(
      "2026-12-01",
    );
  });
});

describe("evaluatePassport — aritmética de fechas", () => {
  it("hace clamp al último día del mes en vez de desbordar", () => {
    // 31/08 + 3 meses no es 01/12: es 30/11. Sin el clamp, la ventana se
    // correría un día y un pasaporte del 30/11 quedaría mal clasificado.
    const rules = {
      tripEndDate: d("2026-08-31"),
      passportValidityMonths: 3,
      requireFullPassportValidity: false,
    };
    expect(evaluatePassport(d("2026-11-30"), rules).level).toBe("ADVERTENCIA");
    expect(evaluatePassport(d("2026-12-01"), rules).level).toBe("OK");
  });

  it("maneja el cruce de año", () => {
    const rules = {
      tripEndDate: d("2026-12-15"),
      passportValidityMonths: 3,
      requireFullPassportValidity: false,
    };
    expect(evaluatePassport(d("2027-03-15"), rules).level).toBe("ADVERTENCIA");
    expect(evaluatePassport(d("2027-03-16"), rules).level).toBe("OK");
  });

  it("respeta el año bisiesto", () => {
    const rules = {
      tripEndDate: d("2027-11-29"),
      passportValidityMonths: 3,
      requireFullPassportValidity: false,
    };
    // 29/11/2027 + 3 meses = 29/02/2028, que existe porque 2028 es bisiesto.
    expect(evaluatePassport(d("2028-02-29"), rules).level).toBe("ADVERTENCIA");
    expect(evaluatePassport(d("2028-03-01"), rules).level).toBe("OK");
  });

  it("respeta una ventana configurada distinta de 3 meses", () => {
    const rules = {
      tripEndDate: TRIP_END,
      passportValidityMonths: 6,
      requireFullPassportValidity: false,
    };
    expect(evaluatePassport(d("2027-04-01"), rules).level).toBe("ADVERTENCIA");
    expect(evaluatePassport(d("2027-06-01"), rules).level).toBe("OK");
  });

  it("no se corre un día por zona horaria al oeste de Greenwich", () => {
    // Regresión: con `addMonths` de date-fns (que opera en hora local) este
    // caso daba OK en UTC-3 cuando en realidad es ADVERTENCIA.
    const result = evaluatePassport(d("2027-02-28"), relaxed);
    expect(result.level).toBe("ADVERTENCIA");
  });
});
