/**
 * La convención de paths del bucket, en un solo lugar.
 *
 * ── Por qué existe este módulo ────────────────────────────────────────────
 *
 * La regla es simple: todo archivo de un pasajero vive bajo
 * `{tripId}/{passengerId}/`. Eso es lo que impide que alguien pida —o pise—
 * el archivo de otra persona pasando una path a mano.
 *
 * Estaba escrita tres veces: al armar la path en `createSignedUpload`, al
 * verificar la subida en `confirmUpload`, y al firmar la descarga en
 * `createSignedDownloadUrl`. Y no había un solo test que la ejerciera.
 *
 * El resultado previsible fue que el seed escribiera
 * `{tripId}/certificados/{key}.pdf` durante tres fases sin que nadie se
 * enterara: pasaba la validación de "es un string no vacío" y fallaba recién
 * al intentar abrir el archivo, con un 404 que no decía por qué.
 *
 * Ahora la convención es una función pura, testeada, y la usan tanto el código
 * de producción como el seed. Si vuelven a divergir, lo dice la suite.
 */

/** Los dos tipos de archivo que el sistema guarda. */
export type StorageFileKind = "cobertura-medica" | "comprobante-pago";

/** La carpeta de un pasajero. Todo lo suyo cuelga de acá y de ningún otro lado. */
export function passengerFolder(tripId: string, passengerId: string): string {
  return `${tripId}/${passengerId}/`;
}

/**
 * Arma la path de un archivo nuevo.
 *
 * `unique` entra como parámetro en lugar de generarse acá: este módulo es puro
 * y `randomUUID()` viene de `node:crypto`. Quien llama decide de dónde sale el
 * valor único, y en los tests puede ser fijo.
 */
export function buildStoragePath(
  tripId: string,
  passengerId: string,
  kind: StorageFileKind,
  unique: string,
  extension: string,
): string {
  return `${passengerFolder(tripId, passengerId)}${kind}-${unique}.${extension}`;
}

/**
 * ¿Esta path pertenece a este pasajero de este viaje?
 *
 * Es el guard que se aplica antes de firmar una descarga y antes de aceptar
 * una subida. Rechaza dos cosas distintas:
 *
 *   · lo que no cuelga de la carpeta del pasajero — el caso del seed, y el de
 *     cualquiera que intente pedir el archivo de otro;
 *   · lo que contiene `..` — el clásico intento de salirse de la carpeta.
 *
 * El `..` se chequea sobre la path entera y no solo al principio: un
 * `{tripId}/{passengerId}/../../otro/archivo.pdf` empieza con el prefijo
 * correcto y aun así apunta afuera.
 */
export function isInsidePassengerFolder(
  path: string,
  tripId: string,
  passengerId: string,
): boolean {
  if (path.includes("..")) return false;

  const prefix = passengerFolder(tripId, passengerId);
  if (!path.startsWith(prefix)) return false;

  // Tiene que quedar un nombre de archivo después del prefijo, y no otra
  // carpeta: `{tripId}/{passengerId}/sub/archivo.pdf` no es lo que arma
  // `buildStoragePath` y no tiene por qué aceptarse.
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/");
}
