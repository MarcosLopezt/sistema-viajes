/**
 * Baja TODOS los objetos del bucket privado a una carpeta local.
 *
 * Es la mitad que le faltaba al backup. El `pg_dump` guarda los `path` de los
 * archivos (`Person.medicalAssuranceFileId`, `Payment.proofFileId`), pero los
 * archivos en sí viven en el Storage de Supabase, que es otro sistema. Sin
 * esto, restaurar deja una base íntegra con punteros a objetos que no existen.
 *
 * Uso:
 *   tsx scripts/backup-storage.ts <carpeta-destino>
 *
 * Variables necesarias:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (el bucket es privado: la anon key no alcanza)
 *   SUPABASE_STORAGE_BUCKET     (por defecto "documentos")
 *
 * Escribe un `manifest.json` junto a los archivos con la lista de paths y
 * tamaños. Sirve para dos cosas: verificar que la restauración subió todo, y
 * saber qué se perdió si un objeto no se pudo bajar.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface ManifestEntry {
  path: string;
  size: number;
}

/** Argumento obligatorio de la línea de comandos. */
function requiredArg(index: number, usage: string): string {
  const value = process.argv[index];
  if (!value) {
    console.error(usage);
    process.exit(1);
  }
  return value;
}

const target = requiredArg(2, "Uso: tsx scripts/backup-storage.ts <carpeta-destino>");
const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const bucket = process.env["SUPABASE_STORAGE_BUCKET"] ?? "documentos";

if (!url || !key) {
  console.error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Recorre el bucket en profundidad.
 *
 * `list()` no es recursivo y devuelve como máximo 100 entradas por llamada, así
 * que hay que paginar Y bajar por cada carpeta. Sin la paginación el backup
 * silenciosamente se lleva los primeros 100 archivos y nada más — y eso no se
 * descubre hasta el día de la restauración.
 */
async function listRecursive(prefix: string): Promise<ManifestEntry[]> {
  const found: ManifestEntry[] = [];
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
      // Supabase marca las carpetas devolviendo `id: null`.
      if (entry.id === null) {
        found.push(...(await listRecursive(path)));
      } else {
        found.push({
          path,
          size: (entry.metadata?.["size"] as number | undefined) ?? 0,
        });
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return found;
}

async function main(): Promise<void> {
  console.log(`Bucket: ${bucket}`);
  const objects = await listRecursive("");
  console.log(`Objetos encontrados: ${objects.length}`);

  if (objects.length === 0) {
    console.log("El bucket está vacío. Se escribe un manifest vacío igual.");
  }

  mkdirSync(target, { recursive: true });
  const failures: string[] = [];
  let bytes = 0;

  for (const object of objects) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(object.path);

    if (error || !data) {
      // Un objeto que falla NO tumba el backup entero: se anota y se sigue.
      // Es preferible un backup con 99 de 100 archivos y la lista de lo que
      // falta, a ningún backup.
      failures.push(`${object.path}: ${error?.message ?? "sin datos"}`);
      continue;
    }

    const destination = join(target, object.path);
    mkdirSync(dirname(destination), { recursive: true });
    const buffer = Buffer.from(await data.arrayBuffer());
    writeFileSync(destination, buffer);
    bytes += buffer.length;
  }

  writeFileSync(
    join(target, "manifest.json"),
    JSON.stringify(
      { bucket, generatedAt: new Date().toISOString(), objects, failures },
      null,
      2,
    ),
  );

  console.log(
    `Bajados: ${objects.length - failures.length}/${objects.length} · ${(bytes / 1024).toFixed(1)} KB`,
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} objeto(s) no se pudieron bajar:`);
    for (const failure of failures) console.error(`  ${failure}`);
    // Sale con error para que el job de GitHub quede en rojo: un backup
    // incompleto tiene que avisar HOY, no el día que haya que restaurar.
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("Falló el backup del Storage:", (error as Error).message);
  process.exit(1);
});
