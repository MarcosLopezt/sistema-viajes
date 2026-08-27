/**
 * Sube al bucket los archivos que bajó `backup-storage.ts`.
 *
 * La otra mitad del procedimiento de restauración. Va DESPUÉS de restaurar la
 * base: los paths que quedan en `Person.medicalAssuranceFileId` y
 * `Payment.proofFileId` tienen que coincidir con lo que se sube acá, y este
 * script preserva la estructura de carpetas exactamente.
 *
 * Uso:
 *   tsx scripts/restore-storage.ts <carpeta-con-el-backup>
 *
 * Variables: las mismas que backup-storage.ts, apuntando al proyecto DESTINO.
 *
 * ⚠️ Verificá dos veces a qué proyecto apunta NEXT_PUBLIC_SUPABASE_URL antes
 * de correr esto. Sube con `upsert: true`, así que contra el proyecto
 * equivocado pisa archivos buenos.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface Manifest {
  bucket: string;
  generatedAt: string;
  objects: { path: string; size: number }[];
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

const source = requiredArg(
  2,
  "Uso: tsx scripts/restore-storage.ts <carpeta-con-el-backup>",
);
const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const bucket = process.env["SUPABASE_STORAGE_BUCKET"] ?? "documentos";

if (!url || !key) {
  console.error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const manifestPath = join(source, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`No encuentro ${manifestPath}. ¿Descomprimiste el backup?`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * El tipo de contenido no está en el manifest, así que se deduce de la
 * extensión. Importa: si todo se subiera como `application/octet-stream`, el
 * navegador ofrecería descargar los PDF en vez de mostrarlos.
 */
function contentTypeOf(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const types: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  return types[extension] ?? "application/octet-stream";
}

async function main(): Promise<void> {
  console.log(`Destino: ${url}`);
  console.log(`Bucket:  ${bucket}`);
  console.log(`Backup del ${manifest.generatedAt}, ${manifest.objects.length} objeto(s)\n`);

  const failures: string[] = [];
  let uploaded = 0;

  for (const object of manifest.objects) {
    const local = join(source, object.path);
    if (!existsSync(local)) {
      failures.push(`${object.path}: no está en el backup`);
      continue;
    }

    const { error } = await supabase.storage
      .from(bucket)
      .upload(object.path, readFileSync(local), {
        contentType: contentTypeOf(object.path),
        upsert: true,
      });

    if (error) {
      failures.push(`${object.path}: ${error.message}`);
      continue;
    }
    uploaded++;
  }

  console.log(`Subidos: ${uploaded}/${manifest.objects.length}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} objeto(s) fallaron:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }

  console.log("\nListo. Verificá abriendo un comprobante desde la aplicación.");
}

main().catch((error: unknown) => {
  console.error("Falló la restauración del Storage:", (error as Error).message);
  process.exit(1);
});
