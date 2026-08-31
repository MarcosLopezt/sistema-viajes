/**
 * La convención de paths del bucket, en un solo lugar.
 *
 * ── Por qué existe este módulo ────────────────────────────────────────────
 *
 * La regla es simple: todo archivo de una persona vive bajo
 * `{tripId}/{personId}/`. Eso es lo que impide que alguien pida —o pise— el
 * archivo de otra pasando una path a mano.
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
 *
 * ── Por qué personId y no passengerId ─────────────────────────────────────
 *
 * Hasta la fase 7 el segundo segmento era el `passengerId`. En la fase 8 pasó
 * a ser el `personId`, y no es un detalle de nombres: es lo que hace que una
 * INTERESADA pueda subir el comprobante de la seña.
 *
 * Una interesada no tiene `Passenger` —esa ausencia es todo su aislamiento, ver
 * el docblock del modelo Interest— pero sí tiene `Person` desde el minuto cero
 * del registro público. Y convertirla en pasajera NO copia la Person: crea un
 * Passenger contra la que ya está. O sea que el `personId` es el mismo antes y
 * después de la conversión, y el `passengerId` no existía antes.
 *
 * La consecuencia práctica es la que importa: **la conversión no toca el
 * bucket**. El comprobante que subió como interesada sigue estando donde
 * estaba, con la path que ya se guardó, y el guard de descarga lo sigue
 * aceptando sin un caso especial. La alternativa —guardarlo bajo el interestId
 * y moverlo al convertir— metía una operación de red al lado de una
 * transacción de base: si el move falla, la conversión ya ocurrió y la fila
 * apunta a un archivo que no está.
 *
 * Que el dueño del archivo sea la persona y no su rol en un viaje es además lo
 * que ya decía el resto del sistema. `Person` es la identidad que sobrevive a
 * la conversión; `Passenger` es una relación con un viaje.
 *
 * El `{tripId}/` de adelante no se movió: los archivos siguen separados por
 * viaje. Alguien que viaja dos veces sube su cobertura dos veces, igual que
 * antes.
 */

/** Los dos tipos de archivo que el sistema guarda. */
export type StorageFileKind = "cobertura-medica" | "comprobante-pago";

/** La carpeta de una persona. Todo lo suyo cuelga de acá y de ningún otro lado. */
export function personFolder(tripId: string, personId: string): string {
  return `${tripId}/${personId}/`;
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
  personId: string,
  kind: StorageFileKind,
  unique: string,
  extension: string,
): string {
  return `${personFolder(tripId, personId)}${kind}-${unique}.${extension}`;
}

/**
 * ¿Esta path pertenece a esta persona en este viaje?
 *
 * Es el guard que se aplica antes de firmar una descarga y antes de aceptar
 * una subida. Rechaza dos cosas distintas:
 *
 *   · lo que no cuelga de la carpeta de la persona — el caso del seed, y el de
 *     cualquiera que intente pedir el archivo de otra;
 *   · lo que contiene `..` — el clásico intento de salirse de la carpeta.
 *
 * El `..` se chequea sobre la path entera y no solo al principio: un
 * `{tripId}/{personId}/../../otro/archivo.pdf` empieza con el prefijo correcto
 * y aun así apunta afuera.
 */
export function isInsidePersonFolder(
  path: string,
  tripId: string,
  personId: string,
): boolean {
  if (path.includes("..")) return false;

  const prefix = personFolder(tripId, personId);
  if (!path.startsWith(prefix)) return false;

  // Tiene que quedar un nombre de archivo después del prefijo, y no otra
  // carpeta: `{tripId}/{personId}/sub/archivo.pdf` no es lo que arma
  // `buildStoragePath` y no tiene por qué aceptarse.
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/");
}
