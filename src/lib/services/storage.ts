import "server-only";

import { randomUUID } from "node:crypto";
import { requirePassengerAccess } from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/auth/errors";
import { createSupabaseAdminClient, storageBucket } from "@/lib/supabase/admin";

/**
 * Archivos privados: certificados de cobertura médica y, más adelante,
 * comprobantes de pago.
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

export type FileKind = "cobertura-medica" | "comprobante-pago";

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
 * Autoriza una subida y decide dónde va el archivo.
 *
 * La path la arma el servidor a partir del pasajero: el cliente no puede
 * elegir sobreescribir el archivo de otra persona.
 */
export async function createSignedUpload(
  passengerId: string,
  kind: FileKind,
  contentType: string,
  size: number,
): Promise<SignedUpload> {
  const { tripId } = await requirePassengerAccess(passengerId, "edit");
  assertDeclared(contentType, size);

  const extension = ALLOWED_MIME[contentType]!;
  const path = `${tripId}/${passengerId}/${kind}-${randomUUID()}.${extension}`;

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
 * Verifica el archivo YA SUBIDO contra el bucket y devuelve su path.
 *
 * Se consulta el objeto real: acá no hay nada declarado por el cliente. Si el
 * archivo no cumple, se borra del bucket antes de fallar, para no dejar
 * basura colgada que nadie va a limpiar.
 */
export async function confirmUpload(
  passengerId: string,
  path: string,
): Promise<string> {
  const { tripId } = await requirePassengerAccess(passengerId, "edit");

  // La path tiene que caer dentro de la carpeta de este pasajero: sin este
  // chequeo se podría "confirmar" el archivo de otro y quedárselo.
  const expectedPrefix = `${tripId}/${passengerId}/`;
  if (!path.startsWith(expectedPrefix) || path.includes("..")) {
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
  const { tripId } = await requirePassengerAccess(passengerId, "view");

  if (!path.startsWith(`${tripId}/${passengerId}/`) || path.includes("..")) {
    throw new ForbiddenError();
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(storageBucket())
    .createSignedUrl(path, DOWNLOAD_TTL_SECONDS);

  if (error || !data) {
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

/** Elimina todos los archivos de un pasajero. Para el borrado de datos. */
export async function removePassengerFiles(
  tripId: string,
  passengerId: string,
): Promise<number> {
  const admin = createSupabaseAdminClient();
  const bucket = storageBucket();
  const directory = `${tripId}/${passengerId}`;

  const { data } = await admin.storage.from(bucket).list(directory);
  if (!data || data.length === 0) return 0;

  await admin.storage
    .from(bucket)
    .remove(data.map((file) => `${directory}/${file.name}`));

  return data.length;
}
