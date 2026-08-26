/**
 * Regla de alerta de pasaporte.
 *
 * Base (siempre activa):
 *   🔴 BLOQUEANTE   vencimiento <= fin del viaje
 *   🟡 ADVERTENCIA  vencimiento <= fin del viaje + passportValidityMonths
 *   🟢 OK           en cualquier otro caso
 *
 * Modificador por viaje: si `requireFullPassportValidity` está activo, la
 * franja amarilla pasa a ser bloqueante. Se usa para destinos donde esos meses
 * de validez posterior son requisito real de entrada y no una recomendación
 * (Schengen exige 3 meses). Lo activa el coordinador según el destino.
 *
 * Sin dependencias de infraestructura: función pura, testeada en
 * tests/domain/passport.test.ts.
 */

export type PassportAlertLevel =
  | "OK"
  | "ADVERTENCIA"
  | "BLOQUEANTE"
  | "SIN_DATO";

export interface PassportRules {
  /** Fecha de regreso del viaje. */
  tripEndDate: Date;
  /** Meses de validez posterior al regreso. Default de negocio: 3. */
  passportValidityMonths: number;
  /** Promueve la advertencia amarilla a bloqueante. */
  requireFullPassportValidity: boolean;
}

export interface PassportEvaluation {
  level: PassportAlertLevel;
  /** Si es true, el pasajero no puede pasar a CONFIRMADO. */
  blocksConfirmation: boolean;
  /** Vencimiento mínimo que deja el pasaporte en verde. */
  minimumExpiryForOk: Date;
  /** Vencimiento mínimo que permite confirmar al pasajero. */
  minimumExpiryToConfirm: Date;
}

/** Normaliza a medianoche UTC: las fechas de negocio no tienen hora. */
function atUtcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Suma meses en UTC, con clamp al último día del mes.
 *
 * No usamos `addMonths` de date-fns porque opera en hora local: con fechas
 * guardadas a medianoche UTC eso corre un día para atrás en cualquier huso al
 * oeste de Greenwich, y el usuario está en UTC-3.
 *
 * El clamp importa: 30/11 + 3 meses en JS da 02/03 (rollover), no 28/02.
 */
function addMonthsUtc(date: Date, months: number): Date {
  const base = atUtcMidnight(date);
  const day = base.getUTCDate();
  const result = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, day),
  );
  if (result.getUTCDate() !== day) {
    // Hubo rollover al mes siguiente: retrocedemos al último día del mes previo.
    result.setUTCDate(0);
  }
  return result;
}

function addDaysUtc(date: Date, days: number): Date {
  const result = atUtcMidnight(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function evaluatePassport(
  passportExpiryDate: Date | null | undefined,
  rules: PassportRules,
): PassportEvaluation {
  const endDate = atUtcMidnight(rules.tripEndDate);
  const warningFloor = addMonthsUtc(endDate, rules.passportValidityMonths);

  const minimumExpiryForOk = addDaysUtc(warningFloor, 1);
  const minimumExpiryToConfirm = rules.requireFullPassportValidity
    ? minimumExpiryForOk
    : addDaysUtc(endDate, 1);

  const base = { minimumExpiryForOk, minimumExpiryToConfirm };

  if (!passportExpiryDate) {
    return { level: "SIN_DATO", blocksConfirmation: true, ...base };
  }

  const expiry = atUtcMidnight(passportExpiryDate);

  if (expiry.getTime() <= endDate.getTime()) {
    return { level: "BLOQUEANTE", blocksConfirmation: true, ...base };
  }

  if (expiry.getTime() <= warningFloor.getTime()) {
    return rules.requireFullPassportValidity
      ? { level: "BLOQUEANTE", blocksConfirmation: true, ...base }
      : { level: "ADVERTENCIA", blocksConfirmation: false, ...base };
  }

  return { level: "OK", blocksConfirmation: false, ...base };
}
