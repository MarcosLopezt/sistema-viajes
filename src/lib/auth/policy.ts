import type { GlobalRole, TripRole } from "@/generated/prisma/enums";

/**
 * Decisiones de autorización, como funciones puras.
 *
 * Están separadas de los guards (que resuelven la sesión y hablan con la base)
 * para que la matriz de permisos se pueda testear exhaustivamente sin HTTP ni
 * base de datos. Los guards son cáscaras finas sobre estas funciones: no hay
 * una segunda copia de las reglas en ningún otro lado.
 *
 * No usamos RLS de Postgres: Prisma corre con la service role y la bypassearía.
 * Tener las reglas duplicadas en policies SQL y en código es peor que tenerlas
 * en un solo lugar bien testeado, porque cuando divergen ninguna de las dos es
 * la verdad. Esta es la única capa de autorización del sistema.
 *
 * Testeado en tests/auth/policy.test.ts.
 */

/** Quién está mirando, siempre resuelto en el servidor desde la sesión. */
export interface ViewerContext {
  userId: string;
  /** Rol global: ADMIN puede todo, incluida la gestión de usuarios. */
  globalRole: GlobalRole;
  /** Rol en ESTE viaje. `null` si no es miembro del viaje. */
  tripRole: TripRole | null;
  /**
   * El Passenger propio del viewer en ESTE viaje, si viaja.
   * Se resuelve en el servidor desde `userId`: jamás se toma del cliente.
   */
  ownPassengerId: string | null;
}

/**
 * Acciones controladas. Se corresponden una a una con las filas de la matriz
 * de permisos del documento de requisitos.
 */
export type Capability =
  /** Crear/editar viajes, itinerario y costos. */
  | "trip:edit"
  /** Ver costos, presupuesto y margen. El pasajero NUNCA la tiene. */
  | "trip:viewFinancials"
  | "passenger:invite"
  /**
   * Ver y mover el embudo de interesadas, y convertir una en pasajera.
   *
   * Es una capability propia y no `passenger:invite` reciclada porque son dos
   * hechos distintos: invitar es mandarle un link a alguien que ya decidiste
   * sumar; esto es leer los datos de contacto de gente que todavía no es
   * nadie del viaje. Que la matriz los distinga deja abierta la puerta a que
   * algún día uno se dé sin el otro.
   */
  | "interest:manage"
  /** Ver los datos de todos los pasajeros del viaje. */
  | "passenger:viewAll"
  /** Editar los datos de cualquier pasajero (queda auditado). */
  | "passenger:editAny"
  /** Definir precio y plan de pagos. */
  | "payment:definePlan"
  /** Confirmar o rechazar un pago. */
  | "payment:review"
  | "communication:send"
  /** Gestionar usuarios y roles. Exclusiva de ADMIN. */
  | "user:manage";

const COORDINATOR_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "trip:edit",
  "trip:viewFinancials",
  "passenger:invite",
  "interest:manage",
  "passenger:viewAll",
  "passenger:editAny",
  "payment:definePlan",
  "payment:review",
  "communication:send",
]);

export function isAdmin(viewer: ViewerContext): boolean {
  return viewer.globalRole === "ADMIN";
}

export function isCoordinator(viewer: ViewerContext): boolean {
  return viewer.tripRole === "COORDINADOR";
}

/**
 * ¿Puede el viewer ejecutar esta acción sobre este viaje?
 *
 * Un PASAJERO no obtiene ninguna capability: todo lo que puede hacer sobre sus
 * propios datos pasa por `canViewPassenger` / `canEditPassenger`.
 */
export function can(viewer: ViewerContext, capability: Capability): boolean {
  if (isAdmin(viewer)) return true;
  if (capability === "user:manage") return false;
  if (isCoordinator(viewer)) return COORDINATOR_CAPABILITIES.has(capability);
  return false;
}

/**
 * ¿Puede ver los datos personales de este pasajero?
 * El pasajero solo se ve a sí mismo. La comparación es contra
 * `ownPassengerId`, que viene de la sesión, nunca de la URL.
 */
export function canViewPassenger(
  viewer: ViewerContext,
  passengerId: string,
): boolean {
  if (can(viewer, "passenger:viewAll")) return true;
  return viewer.ownPassengerId !== null &&
    viewer.ownPassengerId === passengerId;
}

/** Mismo criterio para editar: el pasajero solo edita lo propio. */
export function canEditPassenger(
  viewer: ViewerContext,
  passengerId: string,
): boolean {
  if (can(viewer, "passenger:editAny")) return true;
  return viewer.ownPassengerId !== null &&
    viewer.ownPassengerId === passengerId;
}

/**
 * ¿La edición debe quedar registrada en AuditLog?
 *
 * Se audita toda modificación hecha por un coordinador o admin sobre datos de
 * un pasajero. El pasajero editando lo suyo no genera auditoría.
 */
export function editRequiresAudit(
  viewer: ViewerContext,
  passengerId: string,
): boolean {
  return viewer.ownPassengerId !== passengerId;
}

/**
 * Filtro de visibilidad para listar pasajeros de un viaje.
 *
 * Devuelve el fragmento de `where` de Prisma que acota la consulta a lo que el
 * viewer tiene derecho a ver. Que el alcance se arme acá — y no repitiendo un
 * `if` en cada endpoint — es lo que hace que un pasajero no pueda ampliar su
 * alcance ni pasando ids a mano.
 *
 * Para alguien sin acceso devuelve una condición imposible en lugar de `{}`:
 * si por error se omitiera el guard, la consulta trae cero filas en vez de
 * traerlas todas. Fallar cerrado, no abierto.
 */
export function passengerVisibilityFilter(
  viewer: ViewerContext,
): { id?: string } {
  if (can(viewer, "passenger:viewAll")) return {};
  if (viewer.ownPassengerId !== null) return { id: viewer.ownPassengerId };
  return { id: "__sin-acceso__" };
}
