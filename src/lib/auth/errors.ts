/**
 * Errores de autorización.
 *
 * `ForbiddenError` se traduce a 404, no a 403, en todo lo que cuelga de un
 * recurso identificable por URL. Un 403 le confirma a quien está probando ids
 * a mano que ese pasajero existe; un 404 no le dice nada. La distinción entre
 * "no existe" y "no es tuyo" se mantiene solo en los logs del servidor.
 */

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Necesitás iniciar sesión.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "No tenés permiso para hacer esto.") {
    super(message);
    this.name = "ForbiddenError";
  }
}
