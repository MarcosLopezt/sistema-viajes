/**
 * Migra el bucket de `{tripId}/{passengerId}/` a `{tripId}/{personId}/`.
 *
 * ── Qué cambió y por qué ──────────────────────────────────────────────────
 *
 * La convención de paths pasó a indexar por PERSONA en vez de por pasajero.
 * El motivo está en `src/lib/domain/storage-paths.ts`: una interesada no tiene
 * `Passenger` pero sí tiene `Person` desde el registro público, así que con la
 * carpeta indexada por persona el comprobante de la seña no cambia de lugar
 * cuando la convierten en pasajera.
 *
 * Este script existe para los objetos que YA estaban subidos con la forma
 * vieja. Se corre una sola vez.
 *
 * ── El orden de las operaciones: copiar, escribir, borrar ─────────────────
 *
 * NO se usa `move`. Se copia al destino, se actualiza la fila, y recién
 * entonces se borra el origen. Es más lento y hace tres llamadas donde una
 * alcanzaría, pero la propiedad que da es la que importa: **en ningún momento
 * intermedio hay una fila apuntando a un objeto que no existe**.
 *
 *   · si falla la copia          → nada se tocó, la fila sigue apuntando al viejo
 *   · si falla el UPDATE         → hay un objeto de más, la fila sigue sirviendo
 *   · si falla el borrado        → hay un objeto de más, la fila ya usa el nuevo
 *
 * El peor caso deja basura, nunca un 404. Un `move` fallado en el medio deja
 * exactamente lo contrario, y ESTADO.md ya advierte que ese 404 sin
 * explicación es el diagnóstico más caro que tiene el sistema.
 *
 * ── Idempotente ───────────────────────────────────────────────────────────
 *
 * Una path que ya está en la forma nueva se saltea. Correrlo dos veces no
 * hace nada la segunda vez.
 *
 * Uso:
 *   tsx scripts/migrate-storage-paths.ts            (simulacro, no escribe nada)
 *   tsx scripts/migrate-storage-paths.ts --apply    (ejecuta)
 *   tsx scripts/migrate-storage-paths.ts --verify   (solo verifica el estado)
 *
 * Variables necesarias: las mismas que el backup —NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET— más DATABASE_URL.
 */
import "dotenv/config";

import { createClient } from "@supabase/supabase-js";
import { prisma, disconnectDb } from "../src/lib/db/prisma";
import { isInsidePersonFolder } from "../src/lib/domain/storage-paths";

const APPLY = process.argv.includes("--apply");
const VERIFY_ONLY = process.argv.includes("--verify");

const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const bucket = process.env["SUPABASE_STORAGE_BUCKET"] ?? "documentos";

if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Un archivo a migrar, con de dónde sale y adónde va. */
interface Move {
  /** Qué fila lo referencia, para el mensaje de error. */
  origin: string;
  oldPath: string;
  newPath: string;
  tripId: string;
  personId: string;
  /** Cómo se escribe la path nueva en la base. */
  write: (path: string) => Promise<void>;
}

/**
 * Recorre el bucket en profundidad.
 *
 * Copiada de `backup-storage.ts` por la misma razón que allá: `list()` no es
 * recursivo y corta en 100 entradas por llamada. Sin paginar, la verificación
 * miraría los primeros 100 objetos y diría que está todo bien.
 */
async function listRecursive(prefix: string): Promise<string[]> {
  const found: string[] = [];
  const PAGE = 100;
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset });

    if (error) throw new Error(`list("${prefix}"): ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        found.push(...(await listRecursive(path)));
      } else {
        found.push(path);
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return found;
}

/**
 * Reescribe el segundo segmento de una path, dejando el resto intacto.
 *
 * El nombre del archivo NO se toca: lleva un uuid propio y renombrarlo sería
 * una segunda cosa que puede salir mal sin ninguna ganancia.
 */
function repoint(path: string, tripId: string, personId: string): string | null {
  const segments = path.split("/");
  if (segments.length !== 3) return null;
  if (segments[0] !== tripId) return null;
  return `${tripId}/${personId}/${segments[2]}`;
}

/** Todo lo que la base referencia hoy, con su forma vieja y su forma nueva. */
async function collectMoves(): Promise<{ moves: Move[]; skipped: number }> {
  const moves: Move[] = [];
  let skipped = 0;

  // ── Certificados de cobertura médica ────────────────────────────────────
  //
  // `medicalAssuranceFileId` vive en Person y la path lleva un tripId adentro,
  // así que hay que resolver contra QUÉ viaje se subió. Se busca el Passenger
  // cuyo tripId coincide con el primer segmento de la path guardada: es el
  // único que puede haberla producido.
  const people = await prisma.person.findMany({
    where: { medicalAssuranceFileId: { not: null } },
    select: {
      id: true,
      medicalAssuranceFileId: true,
      passengers: { select: { id: true, tripId: true } },
    },
  });

  for (const person of people) {
    const oldPath = person.medicalAssuranceFileId!;
    const tripId = oldPath.split("/")[0] ?? "";

    if (isInsidePersonFolder(oldPath, tripId, person.id)) {
      skipped += 1;
      continue;
    }

    const owner = person.passengers.find((p) =>
      isInsidePersonFolder(oldPath, p.tripId, p.id),
    );

    if (!owner) {
      throw new Error(
        `Person ${person.id}: la path "${oldPath}" no cae en la carpeta de ` +
          `ninguno de sus pasajeros ni en la suya. Es un dato roto anterior a ` +
          `esta migración: arreglalo a mano antes de seguir.`,
      );
    }

    const newPath = repoint(oldPath, owner.tripId, person.id);
    if (!newPath) throw new Error(`Path con forma inesperada: "${oldPath}"`);

    moves.push({
      origin: `Person ${person.id} · medicalAssuranceFileId`,
      oldPath,
      newPath,
      tripId: owner.tripId,
      personId: person.id,
      write: async (path) => {
        await prisma.person.update({
          where: { id: person.id },
          data: { medicalAssuranceFileId: path },
        });
      },
    });
  }

  // ── Comprobantes de pago ────────────────────────────────────────────────
  const payments = await prisma.payment.findMany({
    where: { proofFileId: { not: null } },
    select: {
      id: true,
      proofFileId: true,
      plan: {
        select: {
          passenger: { select: { id: true, tripId: true, personId: true } },
        },
      },
    },
  });

  for (const payment of payments) {
    const oldPath = payment.proofFileId!;
    const { id: passengerId, tripId, personId } = payment.plan.passenger;

    if (isInsidePersonFolder(oldPath, tripId, personId)) {
      skipped += 1;
      continue;
    }

    if (!isInsidePersonFolder(oldPath, tripId, passengerId)) {
      throw new Error(
        `Payment ${payment.id}: la path "${oldPath}" no cae ni en la carpeta ` +
          `vieja (${tripId}/${passengerId}/) ni en la nueva. Dato roto: ` +
          `arreglalo a mano antes de seguir.`,
      );
    }

    const newPath = repoint(oldPath, tripId, personId);
    if (!newPath) throw new Error(`Path con forma inesperada: "${oldPath}"`);

    moves.push({
      origin: `Payment ${payment.id} · proofFileId`,
      oldPath,
      newPath,
      tripId,
      personId,
      write: async (path) => {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { proofFileId: path },
        });
      },
    });
  }

  return { moves, skipped };
}

/**
 * La verificación, que es la mitad que de verdad importa.
 *
 * Contesta tres preguntas distintas, y las tres tienen que dar cero:
 *
 *   1. ¿queda alguna FILA con una path que no respeta la convención nueva?
 *   2. ¿queda algún OBJETO en el bucket bajo la convención vieja?
 *   3. ¿hay alguna fila apuntando a un objeto que no está en el bucket?
 *
 * La 1 y la 3 no son la misma pregunta: una path puede tener la forma correcta
 * y no existir. Y la 2 no se deduce de las otras dos: un objeto huérfano bajo
 * la carpeta vieja no lo referencia nadie, así que ninguna consulta a la base
 * lo encuentra — hay que mirar el bucket.
 */
async function verify(): Promise<boolean> {
  const objetos = new Set(await listRecursive(""));

  const carpetasDePersonas = new Set<string>();
  const carpetasDePasajeros = new Set<string>();

  const passengers = await prisma.passenger.findMany({
    select: { id: true, tripId: true, personId: true },
  });
  for (const p of passengers) {
    carpetasDePersonas.add(`${p.tripId}/${p.personId}`);
    carpetasDePasajeros.add(`${p.tripId}/${p.id}`);
  }

  // 1 · las filas
  const malFormadas: string[] = [];
  const colgadas: string[] = [];

  const people = await prisma.person.findMany({
    where: { medicalAssuranceFileId: { not: null } },
    select: {
      id: true,
      medicalAssuranceFileId: true,
      passengers: { select: { tripId: true } },
    },
  });

  for (const person of people) {
    const path = person.medicalAssuranceFileId!;
    const ok = person.passengers.some((p) =>
      isInsidePersonFolder(path, p.tripId, person.id),
    );
    if (!ok) malFormadas.push(`Person ${person.id}: ${path}`);
    else if (!objetos.has(path)) colgadas.push(`Person ${person.id}: ${path}`);
  }

  const payments = await prisma.payment.findMany({
    where: { proofFileId: { not: null } },
    select: {
      id: true,
      proofFileId: true,
      plan: { select: { passenger: { select: { tripId: true, personId: true } } } },
    },
  });

  for (const payment of payments) {
    const path = payment.proofFileId!;
    const { tripId, personId } = payment.plan.passenger;
    if (!isInsidePersonFolder(path, tripId, personId)) {
      malFormadas.push(`Payment ${payment.id}: ${path}`);
    } else if (!objetos.has(path)) {
      colgadas.push(`Payment ${payment.id}: ${path}`);
    }
  }

  // 2 · los objetos del bucket
  //
  // Un objeto cuyo segundo segmento es un passengerId conocido y NO es también
  // una carpeta de persona válida quedó atrás. Se compara contra los ids
  // reales y no contra un patrón: los dos son uuid y no se distinguen por su
  // forma.
  const rezagados = [...objetos].filter((path) => {
    const carpeta = path.split("/").slice(0, 2).join("/");
    return carpetasDePasajeros.has(carpeta) && !carpetasDePersonas.has(carpeta);
  });

  const problemas =
    malFormadas.length + rezagados.length + colgadas.length;

  console.log(`\nVerificación (bucket "${bucket}", ${objetos.size} objetos):`);
  console.log(
    `  ${malFormadas.length === 0 ? "✓" : "✗"} filas con la convención nueva ` +
      `(${malFormadas.length} fuera de convención)`,
  );
  console.log(
    `  ${rezagados.length === 0 ? "✓" : "✗"} objetos bajo la carpeta vieja: ` +
      `${rezagados.length}`,
  );
  console.log(
    `  ${colgadas.length === 0 ? "✓" : "✗"} paths colgadas (fila sin objeto): ` +
      `${colgadas.length}`,
  );

  for (const linea of [...malFormadas, ...rezagados, ...colgadas]) {
    console.log(`      · ${linea}`);
  }

  // Control positivo: si la verificación no miró NADA, no verificó nada. Un
  // "cero problemas" sobre cero archivos es exactamente el falso verde que
  // este proyecto no acepta.
  const revisadas = people.length + payments.length;
  console.log(`  · filas con archivo revisadas: ${revisadas}`);
  if (revisadas === 0) {
    console.log(
      "  ⚠ No hay ninguna fila con archivo. La verificación no probó nada:\n" +
        "    corré `npm run db:seed` y volvé a pasarla.",
    );
    return false;
  }

  return problemas === 0;
}

async function main(): Promise<void> {
  console.log(`Bucket: ${bucket}`);

  if (VERIFY_ONLY) {
    const ok = await verify();
    process.exitCode = ok ? 0 : 1;
    return;
  }

  const { moves, skipped } = await collectMoves();

  console.log(`Ya migradas (se saltean): ${skipped}`);
  console.log(`A migrar: ${moves.length}`);

  if (!APPLY) {
    for (const move of moves) {
      console.log(`  ${move.oldPath}\n    → ${move.newPath}   [${move.origin}]`);
    }
    console.log(
      "\nSimulacro: no se tocó nada. Volvé a correr con --apply para ejecutar.",
    );
    return;
  }

  let copiados = 0;
  let escritos = 0;
  let borrados = 0;

  for (const move of moves) {
    const { error: copyError } = await supabase.storage
      .from(bucket)
      .copy(move.oldPath, move.newPath);

    // "ya existe en el destino" no es un fallo: es una corrida anterior que
    // llegó hasta acá y se cortó. Se sigue, que es lo que la vuelve reanudable.
    const yaEstaba = copyError?.message?.toLowerCase().includes("exists");

    if (copyError && !yaEstaba) {
      throw new Error(`copy ${move.oldPath} → ${move.newPath}: ${copyError.message}`);
    }
    copiados += 1;

    await move.write(move.newPath);
    escritos += 1;

    const { error: removeError } = await supabase.storage
      .from(bucket)
      .remove([move.oldPath]);

    // El borrado es lo ÚNICO que puede fallar sin consecuencias: la fila ya
    // apunta al objeto nuevo. Se avisa y se sigue.
    if (removeError) {
      console.warn(`  ⚠ quedó el original: ${move.oldPath} (${removeError.message})`);
    } else {
      borrados += 1;
    }

    console.log(`  ✓ ${move.origin}`);
  }

  console.log(
    `\nCopiados ${copiados}, filas actualizadas ${escritos}, originales borrados ${borrados}.`,
  );

  const ok = await verify();
  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
