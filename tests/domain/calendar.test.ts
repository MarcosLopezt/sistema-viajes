import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  addCalendarMonths,
  calendarDateIn,
  CalendarError,
  compareCalendarDates,
  daysBetweenCalendarDates,
  DEFAULT_TIMEZONE,
  fromCalendarDate,
  isValidTimeZone,
  maxCalendarDate,
  minCalendarDate,
  resolveTimeZone,
  toCalendarDate,
} from "@/lib/domain/calendar";
import { derivePlan } from "@/lib/domain/payments";

/**
 * El bug que este módulo existe para que no vuelva a pasar:
 *
 *   Vercel corre en UTC. A las 22:00 del 26 de agosto en Buenos Aires ya es el
 *   27 en UTC. Comparando instantes, la cuota del 26 aparecía vencida tres
 *   horas antes de que terminara el día del pasajero.
 *
 * Los tests de abajo fijan el reloj a los dos lados de la medianoche local y
 * verifican que el día que se decide sea el día del pasajero.
 */

const BUENOS_AIRES = "America/Argentina/Buenos_Aires";

describe("calendarDateIn · qué día es acá", () => {
  it("a las 23:59 hora local sigue siendo hoy", () => {
    // 26/08 23:59 en Buenos Aires (UTC-3) = 27/08 02:59 UTC.
    const instant = new Date("2026-08-27T02:59:00.000Z");

    expect(calendarDateIn(instant, BUENOS_AIRES)).toBe("2026-08-26");
    // Y el mismo instante, mirado en UTC, ya es otro día: ESE es el bug.
    expect(calendarDateIn(instant, "UTC")).toBe("2026-08-27");
  });

  it("a las 00:01 hora local ya es mañana", () => {
    // 27/08 00:01 en Buenos Aires = 27/08 03:01 UTC.
    const instant = new Date("2026-08-27T03:01:00.000Z");
    expect(calendarDateIn(instant, BUENOS_AIRES)).toBe("2026-08-27");
  });

  it("justo en la medianoche local, es el día nuevo", () => {
    expect(
      calendarDateIn(new Date("2026-08-27T03:00:00.000Z"), BUENOS_AIRES),
    ).toBe("2026-08-27");
  });

  it("un segundo antes de la medianoche local, todavía no", () => {
    expect(
      calendarDateIn(new Date("2026-08-27T02:59:59.999Z"), BUENOS_AIRES),
    ).toBe("2026-08-26");
  });

  it("funciona al este de Greenwich, donde el corrimiento es al revés", () => {
    // 26/08 21:00 UTC ya es el 27 en Tokio (UTC+9).
    const instant = new Date("2026-08-26T21:00:00.000Z");
    expect(calendarDateIn(instant, "UTC")).toBe("2026-08-26");
    expect(calendarDateIn(instant, "Asia/Tokyo")).toBe("2026-08-27");
  });

  it("respeta el horario de verano de la zona", () => {
    // Madrid es UTC+1 en enero y UTC+2 en julio. Con la MISMA hora UTC
    // —22:30— el día local es distinto según la época del año: en enero son
    // las 23:30 del día 1, en julio las 00:30 del día 2. Un offset fijo
    // codificado a mano fallaría en la mitad del calendario.
    expect(
      calendarDateIn(new Date("2027-01-01T22:30:00.000Z"), "Europe/Madrid"),
    ).toBe("2027-01-01");
    expect(
      calendarDateIn(new Date("2027-07-01T22:30:00.000Z"), "Europe/Madrid"),
    ).toBe("2027-07-02");
  });

  it("sin zona, usa la de referencia del sistema", () => {
    const instant = new Date("2026-08-27T02:59:00.000Z");
    expect(calendarDateIn(instant)).toBe(
      calendarDateIn(instant, DEFAULT_TIMEZONE),
    );
  });

  it("rechaza un instante inválido en vez de devolver NaN-NaN-NaN", () => {
    expect(() => calendarDateIn(new Date("no es una fecha"))).toThrow(
      CalendarError,
    );
  });
});

describe("zonas horarias inválidas", () => {
  it("reconoce las válidas", () => {
    expect(isValidTimeZone(BUENOS_AIRES)).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Europe/Madrid")).toBe(true);
  });

  it("reconoce las inválidas sin explotar", () => {
    expect(isValidTimeZone("America/Buenos_Aires_")).toBe(false);
    expect(isValidTimeZone("cualquier cosa")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  /**
   * Falla hacia el default, no hacia UTC. Un typo en la base es molesto;
   * empezar a contar los días en Greenwich sin que nadie se entere es el bug
   * que todo este módulo existe para evitar.
   */
  it("una zona con typo cae al default, no a UTC", () => {
    expect(resolveTimeZone("America/Buenos_Aires_")).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimeZone(null)).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimeZone("")).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("calendarDateIn con una zona rota no tira: usa el default", () => {
    const instant = new Date("2026-08-27T02:59:00.000Z");
    expect(calendarDateIn(instant, "Marte/Olympus_Mons")).toBe("2026-08-26");
  });
});

describe("ida y vuelta con las columnas @db.Date", () => {
  it("un Date a medianoche UTC es su fecha de calendario", () => {
    expect(toCalendarDate(new Date("2026-08-26T00:00:00.000Z"))).toBe(
      "2026-08-26",
    );
  });

  it("y la vuelta reconstruye el mismo instante", () => {
    expect(fromCalendarDate("2026-08-26").toISOString()).toBe(
      "2026-08-26T00:00:00.000Z",
    );
  });

  it("no se corre un día leyendo con getters UTC", () => {
    // Este es el caso que rompería con getters locales en UTC-3.
    const stored = new Date("2026-01-01T00:00:00.000Z");
    expect(toCalendarDate(stored)).toBe("2026-01-01");
  });

  it("rechaza una fecha que no existe en vez de desbordarla", () => {
    // JS convierte 31/02 en 02/03 en silencio. Acá no.
    expect(() => fromCalendarDate("2032-02-31")).toThrow(CalendarError);
    expect(() => fromCalendarDate("2026-13-01")).toThrow(CalendarError);
    expect(() => fromCalendarDate("26-08-2026")).toThrow(CalendarError);
    expect(() => fromCalendarDate("")).toThrow(CalendarError);
  });

  it("acepta el 29 de febrero de un año bisiesto", () => {
    expect(fromCalendarDate("2028-02-29").toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
    expect(() => fromCalendarDate("2027-02-29")).toThrow(CalendarError);
  });
});

describe("aritmética de días", () => {
  it("suma y resta días", () => {
    expect(addCalendarDays("2026-08-26", 1)).toBe("2026-08-27");
    expect(addCalendarDays("2026-08-26", -1)).toBe("2026-08-25");
    expect(addCalendarDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("cuenta días enteros, en los dos sentidos", () => {
    expect(daysBetweenCalendarDates("2026-08-26", "2026-08-27")).toBe(1);
    expect(daysBetweenCalendarDates("2026-08-26", "2026-08-26")).toBe(0);
    expect(daysBetweenCalendarDates("2026-08-26", "2026-08-25")).toBe(-1);
    expect(daysBetweenCalendarDates("2026-08-26", "2027-08-26")).toBe(365);
  });

  /**
   * El cambio de horario de verano no participa: las dos fechas se anclan a
   * medianoche UTC, así que entre dos días consecutivos siempre hay 24 horas
   * exactas aunque el reloj local haya saltado esa noche.
   */
  it("no se corre con el horario de verano", () => {
    // Último domingo de marzo: Europa adelanta una hora.
    expect(daysBetweenCalendarDates("2027-03-01", "2027-04-01")).toBe(31);
    expect(addCalendarDays("2027-03-27", 1)).toBe("2027-03-28");
    expect(addCalendarDays("2027-03-28", 1)).toBe("2027-03-29");
    // Primer domingo de noviembre: Estados Unidos atrasa una hora.
    expect(daysBetweenCalendarDates("2026-11-01", "2026-11-02")).toBe(1);
  });

  it("compara, y el orden lexicográfico es el cronológico", () => {
    expect(compareCalendarDates("2026-08-26", "2026-08-27")).toBe(-1);
    expect(compareCalendarDates("2026-08-27", "2026-08-26")).toBe(1);
    expect(compareCalendarDates("2026-08-26", "2026-08-26")).toBe(0);
    // El caso que justifica el padding a dos dígitos.
    expect("2026-09-01" < "2026-10-01").toBe(true);
    expect(minCalendarDate("2026-09-01", "2026-08-31")).toBe("2026-08-31");
    expect(maxCalendarDate("2026-09-01", "2026-08-31")).toBe("2026-09-01");
  });
});

// ------------------- El bug original, de punta a punta ---------------------

describe("una cuota no vence antes de que termine el día del pasajero", () => {
  const plan = (today: string) =>
    derivePlan({
      totalAmount: "1000.00",
      installments: [
        { id: "c1", number: 1, dueDate: "2026-08-26", amount: "1000.00" },
      ],
      payments: [],
      today,
    });

  it("23:59 en Buenos Aires del día del vencimiento: NO está vencida", () => {
    const instant = new Date("2026-08-27T02:59:00.000Z");
    const state = plan(calendarDateIn(instant, BUENOS_AIRES));

    expect(state.installments[0]!.state).toBe("PENDIENTE");
    expect(state.installments[0]!.overdue).toBe(false);
    expect(state.light).toBe("AMARILLO"); // vence hoy: amarillo, no rojo
  });

  it("el MISMO instante razonado en UTC la daría por vencida", () => {
    // Documenta el bug: no es que la diferencia sea teórica, es que con la
    // zona equivocada el resultado cambia.
    const instant = new Date("2026-08-27T02:59:00.000Z");
    const state = plan(calendarDateIn(instant, "UTC"));

    expect(state.installments[0]!.overdue).toBe(true);
    expect(state.light).toBe("ROJO");
  });

  it("00:01 del día siguiente en Buenos Aires: ahí sí", () => {
    const instant = new Date("2026-08-27T03:01:00.000Z");
    const state = plan(calendarDateIn(instant, BUENOS_AIRES));

    expect(state.installments[0]!.state).toBe("VENCIDA");
    expect(state.installments[0]!.overdue).toBe(true);
    expect(state.light).toBe("ROJO");
  });

  it("00:01 del día del vencimiento: el pasajero tiene todo el día", () => {
    const instant = new Date("2026-08-26T03:01:00.000Z");
    const state = plan(calendarDateIn(instant, BUENOS_AIRES));

    expect(state.installments[0]!.state).toBe("PENDIENTE");
    expect(state.installments[0]!.daysUntilDue).toBe(0);
  });
});

describe("addCalendarMonths", () => {
  it("suma meses sin tocar el día cuando el día existe en el destino", () => {
    expect(addCalendarMonths("2026-03-15", 3)).toBe("2026-06-15");
    expect(addCalendarMonths("2026-01-01", 1)).toBe("2026-02-01");
  });

  it("cruza el año, para adelante y para atrás", () => {
    expect(addCalendarMonths("2026-11-20", 3)).toBe("2027-02-20");
    expect(addCalendarMonths("2026-02-10", -3)).toBe("2025-11-10");
  });

  it("RECORTA al último día del mes en vez de desbordar", () => {
    // Este es el bug que la función existe para no tener. `new Date()` acepta
    // el 31 de febrero y devuelve marzo sin avisar: es el MISMO desborde
    // silencioso contra el que existe isRealIsoDate(). Con vencimientos de
    // cuota, eso los corre a otro mes y nadie lo nota hasta el reclamo.
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(addCalendarMonths("2026-08-31", 6)).toBe("2027-02-28");
  });

  it("respeta los años bisiestos al recortar", () => {
    // 2028 sí es bisiesto; 2026 no. Que el resultado dependa del año destino
    // es lo que descarta una tabla fija de días por mes.
    expect(addCalendarMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("sumar cero no mueve nada", () => {
    expect(addCalendarMonths("2026-01-31", 0)).toBe("2026-01-31");
  });

  it("recortar NO es reversible, y eso es correcto", () => {
    // Ida y vuelta desde el 31 no vuelve al 31: se perdió el día en el
    // recorte. Se afirma explícitamente para que nadie lo "arregle" más
    // adelante creyendo que es un bug — el 28 de febrero menos un mes es el
    // 28 de enero, que es exactamente lo que dice el calendario.
    const ida = addCalendarMonths("2026-01-31", 1);
    expect(addCalendarMonths(ida, -1)).toBe("2026-01-28");
  });

  it("rechaza una cantidad de meses que no sea entera", () => {
    expect(() => addCalendarMonths("2026-01-15", 1.5)).toThrow(CalendarError);
  });

  it("rechaza una fecha que no es de calendario", () => {
    expect(() => addCalendarMonths("2026-02-31", 1)).toThrow(CalendarError);
  });
});
