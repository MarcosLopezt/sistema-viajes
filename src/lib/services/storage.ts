import "server-only";

import { randomUUID } from "node:crypto";
import {
  requireInterestAccess,
  requirePassengerAccess,
} from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/auth/errors";
import { createSupabaseAdminClient, storageBucket } from "@/lib/supabase/admin";
import {
  buildStoragePath,
  isInsidePersonFolder,
  personFolder,
  type StorageFileKind,
} from "@/lib/domain/storage-paths";

/**
 * Archivos privados: certificados de cobertura médica y comprobantes de pago.
 *
 * Todo cuelga de `{tripId}/{personId}/`. La carpeta es de la PERSONA y no del
 * pasajero: es la identidad que sobrevive a la conversión de interesada a
 * pasajera, así que el comprobante de la seña no cambia de lugar cuando la
 * convierten. El detalle está en `lib/domain/storage-paths.ts`.
 *
 * ── Por qué la subida NO pasa por el servidor ─────────────────────────────
 *
 * El navegador sube directo al bucket con una signed upload URL. Si el
 * archivo pasara por un Route Handler chocaría con dos límites de Vercel a la
 * vez —el tamaño del body y el timeout de la función— y una foto de pasaporte
 * sacada con el celular los toca sin esfuerzo.
 *
 * ── Y entonces, ¿dónde se valida? ────────────────────────────────────────
 *
 * En dos momentos, los dos en el servidor:
 *
 *  1. Al pedir la URL firmada se valida lo que el cliente DECLARA (tipo y
 *     tamaño) y se decide la path. El cliente no elige dónde escribe.
 *  2. Después de subir, `confirmUpload` consulta el objeto real en el bucket
 *     y verifica su tipo y su tamaño de verdad. Recién ahí la path se guarda
 *     en la base.
 *
 * El paso 2 no es redundante: lo declarado en el paso 1 es lo que dice el
 * cliente, y el cliente no es confiable.
 */

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

const ALLOWED_MIME: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export class StorageError extends Error {
  constructor(
    message: string,
    readonly reason: "TIPO" | "TAMANO" | "NO_ENCONTRADO" | "FALLO",
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/** Alias del tipo de dominio: los valores viven junto a la convención de paths. */
export type FileKind = StorageFileKind;

export const MAX_UPLOAD_BYTES = MAX_BYTES;
export const ACCEPTED_MIME_TYPES = Object.keys(ALLOWED_MIME);

function assertDeclared(contentType: string, size: number): void {
  if (!(contentType in ALLOWED_MIME)) {
    throw new StorageError(
      "Ese tipo de archivo no sirve. Subí una foto (JPG, PNG o WEBP) o un PDF.",
      "TIPO",
    );
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
    throw new StorageError(
      "El archivo es demasiado grande. El máximo son 8 MB.",
      "TAMANO",
    );
  }
}

export interface SignedUpload {
  /** Path interna del bucket. Es lo que se guarda en la base, nunca una URL. */
  path: string;
  /** Token de subida de Supabase, para `uploadToSignedUrl` en el navegador. */
  token: string;
  /**
   * Nombre del bucket. Viaja al cliente junto con el token en vez de exponerse
   * como variable NEXT_PUBLIC_: el navegador solo necesita saberlo en el
   * momento de subir, y así hay una variable de entorno menos que mantener
   * sincronizada entre servidor y cliente.
   */
  bucket: string;
}

/**
 * ── Dos puertas de autorización, un solo mecanismo ────────────────────────
 *
 * Los archivos los suben dos actores distintos: una PASAJERA, que se autoriza
 * contra su Passenger, y una INTERESADA, que no tiene Passenger y se autoriza
 * contra su Interest. Las dos terminan en el mismo lugar —una carpeta de
 * persona— porque la carpeta es de la persona y no del rol.
 *
 * Lo que sigue debajo de las dos puertas es exactamente el mismo código: la
 * path la arma el servidor, la subida se verifica contra el bucket, y el guard
 * de carpeta es la misma función pura. Está escrito así, y no como dos flujos
 * paralelos, porque dos flujos paralelos son dos lugares donde olvidarse el
 * chequeo, y solo uno de los dos tendría un test.
 *
 * Lo ÚNICO que cambia entre las dos es de dónde sale el `(tripId, personId)`.
 */
async function signUploadInto(
  tripId: string,
  personId: string,
  kind: FileKind,
  contentType: string,
  size: number,
): Promise<SignedUpload> {
  assertDeclared(contentType, size);

  const extension = ALLOWED_MIME[contentType]!;
  const path = buildStoragePath(tripId, personId, kind, randomUUID(), extension);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(storageBucket())
    .createSignedUploadUrl(path);

  if (error || !data) {
    throw new StorageError(
      "No pudimos preparar la subida. Probá de nuevo.",
      "FALLO",
    );
  }

  return { path: data.path, token: data.token, bucket: storageBucket() };
}

/**
 * Autoriza la subida de una PASAJERA y decide dónde va el archivo.
 *
 * El `personId` sale del guard, nunca del input: es la misma lectura que ya
 * autorizó el acceso, así que el cliente no puede elegir sobreescribir el
 * archivo de otra.
 */
export async function createSignedUpload(
  passengerId: string,
  kind: FileKind,
  contentType: string,
  size: number,
): Promise<SignedUpload> {
  const { tripId, personId } = await requirePassengerAccess(passengerId, "edit");
  return signUploadInto(tripId, personId, kind, contentType, size);
}

/**
 * Autoriza la subida de una INTERESADA: el comprobante de su seña.
 *
 * No recibe ningún identificador. El viaje y la persona salen enteros de la
 * sesión —ver `requireInterestAccess`—, así que no hay ningún id del cliente
 * que pudiera apuntar a otra persona. Es la versión más fuerte de la regla del
 * módulo de guards, no una excepción a ella.
 */
export async function createSignedUploadForInterest(
  kind: FileKind,
  contentType: string,
  size: number,
): Promise<SignedUpload> {
  const { tripId, personId } = await requireInterestAccess();
  return signUploadInto(tripId, personId, kind, contentType, size);
}

/**
 * Verifica el archivo YA SUBIDO contra el bucket y devuelve su path.
 *
 * Se consulta el objeto real: acá no hay nada declarado por el cliente. Si el
 * archivo no cumple, se borra del bucket antes de fallar, para no dejar
 * basura colgada que nadie va a limpiar.
 */
async function verifyUploadedInto(
  tripId: string,
  personId: string,
  path: string,
): Promise<string> {
  // La path tiene que caer dentro de la carpeta de esta persona: sin este
  // chequeo se podría "confirmar" el archivo de otra y quedárselo.
  if (!isInsidePersonFolder(path, tripId, personId)) {
    console.warn(
      `[storage] subida rechazada: la path no cae en ${personFolder(tripId, personId)}`,
    );
    throw new ForbiddenError();
  }

  const admin = createSupabaseAdminClient();
  const bucket = storageBucket();

  const directory = path.slice(0, path.lastIndexOf("/"));
  const filename = path.slice(path.lastIndexOf("/") + 1);

  const { data, error } = await admin.storage
    .from(bucket)
    .list(directory, { search: filename, limit: 1 });

  const object = data?.[0];
  if (error || !object) {
    throw new StorageError("No encontramos el archivo subido.", "NO_ENCONTRADO");
  }

  const actualType = object.metadata?.["mimetype"] as string | undefined;
  const actualSize = object.metadata?.["size"] as number | undefined;

  try {
    assertDeclared(actualType ?? "", actualSize ?? 0);
  } catch (validationError) {
    await admin.storage.from(bucket).remove([path]);
    throw validationError;
  }

  return path;
}

/** Verifica el archivo YA SUBIDO por una PASAJERA. */
export async function confirmUpload(
  passengerId: string,
  path: string,
): Promise<string> {
  const { tripId, personId } = await requirePassengerAccess(passengerId, "edit");
  return verifyUploadedInto(tripId, personId, path);
}

/**
 * Verifica el archivo YA SUBIDO por una INTERESADA.
 *
 * Como en la subida, no recibe identificadores: el par (viaje, persona) contra
 * el que se valida la path sale de la sesión.
 */
export async function confirmUploadForInterest(path: string): Promise<string> {
  const { tripId, personId } = await requireInterestAccess();
  return verifyUploadedInto(tripId, personId, path);
}

/**
 * URL temporal para ver o descargar un archivo.
 *
 * Corta a propósito: el bucket es privado y estas URLs se pueden reenviar.
 * Un minuto alcanza para que el navegador abra el archivo y no para que la
 * URL siga sirviendo si alguien la pega en otro lado.
 */
const DOWNLOAD_TTL_SECONDS = 60;

export async function createSignedDownloadUrl(
  passengerId: string,
  path: string,
): Promise<string> {
  const { tripId, personId } = await requirePassengerAccess(passengerId, "view");
  return signDownloadWithinPersonFolder(tripId, personId, path, passengerId);
}

/**
 * Firma una descarga DENTRO de la carpeta de una persona.
 *
 * ⚠️ ESTA FUNCIÓN NO AUTORIZA A NADIE. Verifica la convención de carpeta y
 * firma; quién puede ver el archivo lo decidió el que llama, ANTES.
 *
 * Existe porque los comprobantes tienen dos dueños posibles con reglas de
 * acceso distintas: el de una pasajera se autoriza contra su Passenger
 * (`createSignedDownloadUrl`, acá arriba), y el de la seña de una interesada
 * se autoriza contra su Interest o contra la capability de la coordinadora
 * —una regla de negocio que vive en `services/deposits.ts` y no acá—.
 *
 * El par `(tripId, personId)` que recibe TIENE que salir de una lectura del
 * servidor, nunca del cliente. Si algún día alguien le pasa un personId que
 * llegó en un input, este módulo firma alegremente el archivo de otra persona:
 * la última línea de defensa que queda es la convención de carpeta, y esa solo
 * comprueba que el par sea coherente consigo mismo, no que sea el correcto.
 */
export async function signDownloadWithinPersonFolder(
  tripId: string,
  personId: string,
  path: string,
  /** Solo para el log del diagnóstico. No participa de ninguna decisión. */
  requestedBy: string,
): Promise<string> {

  // ── Las dos causas de un 404, separadas en el log ──────────────────────
  //
  // Quien pide el archivo ve el MISMO 404 en los dos casos, y eso es
  // deliberado: un 403 le confirmaría a alguien que ese pago existe. Pero del
  // lado del servidor las dos situaciones no se parecen en nada, y sin
  // distinguirlas el próximo diagnóstico arranca de cero.
  //
  //   PATH_FUERA_DE_CARPETA  la path guardada no respeta la convención, o
  //                          alguien está pidiendo el archivo de otro. Es un
  //                          problema de DATOS o un intento de acceso.
  //   OBJETO_INEXISTENTE     la path está bien pero el archivo no está en el
  //                          bucket. Es un problema de STORAGE: subida
  //                          abandonada, borrado manual, o una restauración
  //                          de la base sin los archivos.
  //
  // Se loguean tripId y passengerId, que son ids internos, nunca datos de la
  // persona.
  if (!isInsidePersonFolder(path, tripId, personId)) {
    console.warn(
      `[storage] PATH_FUERA_DE_CARPETA · esperaba ${personFolder(tripId, personId)} · pedido por ${requestedBy}`,
    );
    throw new ForbiddenError();
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(storageBucket())
    .createSignedUrl(path, DOWNLOAD_TTL_SECONDS);

  if (error || !data) {
    console.warn(
      `[storage] OBJETO_INEXISTENTE · path "${path}" · bucket "${storageBucket()}" · ${error?.message ?? "sin datos"}`,
    );
    throw new StorageError("No pudimos abrir el archivo.", "FALLO");
  }

  return data.signedUrl;
}

/**
 * Borra el archivo anterior cuando se reemplaza.
 * Se hace después de guardar la path nueva: si fallara el borrado, queda un
 * archivo huérfano, que es mucho mejor que perder el que sí vale.
 */
export async function removeFile(path: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.storage.from(storageBucket()).remove([path]);
}

/** Elimina todos los archivos de una persona en un viaje. Para el borrado de datos. */
export async function removePersonFiles(
  tripId: string,
  personId: string,
): Promise<number> {
  const admin = createSupabaseAdminClient();
  const bucket = storageBucket();
  const directory = `${tripId}/${personId}`;

  const { data } = await admin.storage.from(bucket).list(directory);
  if (!data || data.length === 0) return 0;

  await admin.storage
    .from(bucket)
    .remove(data.map((file) => `${directory}/${file.name}`));

  return data.length;
}
