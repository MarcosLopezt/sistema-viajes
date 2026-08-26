import "server-only";

import { prisma } from "@/lib/db/prisma";
import { Decimal } from "@/lib/domain/money";

/**
 * Registro de auditoría.
 *
 * Se audita todo cambio de precio y de estado de pago, y toda modificación
 * que un coordinador o admin haga sobre datos de un pasajero.
 *
 * Se guarda campo por campo, con valor viejo y nuevo, y no un volcado del
 * objeto entero: cuando haya que responder "¿quién le cambió el precio a esta
 * persona y cuándo?", un diff campo a campo se lee; un JSON completo por
 * versión, no.
 *
 * Nunca se registran datos sensibles de salud ni números de pasaporte en
 * `oldValue`/`newValue` de forma indiscriminada: quien llame decide qué
 * campos audita, y para el módulo de presupuesto son montos y estados.
 */

export interface AuditEntry {
  entity: string;
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/**
 * Registra los cambios que efectivamente ocurrieron.
 *
 * Descarta las entradas donde el valor no cambió: un log lleno de "cambió X
 * de 100 a 100" hace ilegible al que sí importa.
 */
export async function recordAudit(
  actorUserId: string | null,
  entries: readonly AuditEntry[],
): Promise<number> {
  const changed = entries.filter((e) => e.oldValue !== e.newValue);
  if (changed.length === 0) return 0;

  await prisma.auditLog.createMany({
    data: changed.map((entry) => ({ ...entry, actorUserId })),
  });

  return changed.length;
}

/** Normaliza un valor a string para guardarlo en el log. */
export function auditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "toString" in value) return String(value);
  return String(value);
}

/**
 * Normaliza un monto a su forma canónica antes de auditarlo.
 *
 * Hace falta porque los dos lados de la comparación llegan escritos distinto:
 * de la base sale un Decimal que serializa como "4100", y del formulario llega
 * el string "4100.00". Comparados como texto son distintos, así que sin esto
 * se registraba un cambio de precio cada vez que el coordinador guardaba sin
 * tocar nada — y un log con cambios inventados es peor que no tener log.
 *
 * Se pasan los dos lados por acá y se guarda la forma canónica.
 */
export function auditMoney(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  const parsed = new Decimal(text);
  return parsed.isFinite() ? parsed.toString() : text;
}
