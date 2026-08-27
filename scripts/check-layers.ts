/**
 * Verifica los límites entre capas. Corre en `npm run verify`.
 *
 * ── Por qué un script y no solo una regla de ESLint ───────────────────────
 *
 * Dos de las cuatro reglas no se pueden expresar con `no-restricted-imports`,
 * que razona archivo por archivo:
 *
 *   · La frontera del cliente es por `"use client"`, no por carpeta. Un
 *     Client Component que importa un módulo aparentemente inocente que a su
 *     vez importa Prisma rompe el build, y el archivo culpable no tiene
 *     ninguna marca. Hay que seguir el GRAFO de importaciones.
 *
 *   · "domain/ es puro" es una propiedad, no una lista. Enumerar los módulos
 *     que un Client Component puede importar se desactualiza sola: alguien
 *     agrega domain/rooms.ts, es perfectamente puro, y la lista lo prohíbe
 *     igual. Acá se verifica la propiedad y la lista sobra.
 *
 * Las reglas que SÍ se expresan bien en ESLint están además en
 * eslint.config.mjs, para que salten en el editor mientras se escribe.
 *
 * ── Importaciones de tipo ─────────────────────────────────────────────────
 *
 * `import type` está permitido en todas las reglas. Se borra en compilación:
 * no llega un byte al bundle ni se ejecuta nada. Prohibirlo sería castigar el
 * uso de tipos, que es exactamente lo que uno quiere fomentar.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

// ---------------------------------------------------------------------------
// Lectura del árbol y de las importaciones
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // El cliente de Prisma es código generado: no se lintea ni se corrige.
      if (entry === "generated") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

interface ImportRef {
  /** Especificador tal cual está escrito: "@/lib/db/prisma", "./date", "pg". */
  specifier: string;
  /** `import type ...` o `export type ... from`: se borra en compilación. */
  typeOnly: boolean;
  line: number;
}

/**
 * Extrae las importaciones de un archivo.
 *
 * Con expresiones regulares y no con el parser de TypeScript a propósito: lo
 * que se necesita es el especificador y si la importación es de tipo, y eso se
 * lee sin montar un AST. Cubre `import`, `export ... from` y `import()`.
 */
function readImports(file: string): ImportRef[] {
  const source = readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  const refs: ImportRef[] = [];

  lines.forEach((text, index) => {
    const patterns: { re: RegExp; typeOnly: boolean }[] = [
      { re: /^\s*import\s+type\s+.*?from\s*["']([^"']+)["']/, typeOnly: true },
      { re: /^\s*export\s+type\s+.*?from\s*["']([^"']+)["']/, typeOnly: true },
      { re: /^\s*import\s+.*?from\s*["']([^"']+)["']/, typeOnly: false },
      { re: /^\s*import\s*["']([^"']+)["']/, typeOnly: false },
      { re: /^\s*export\s+.*?from\s*["']([^"']+)["']/, typeOnly: false },
    ];

    for (const { re, typeOnly } of patterns) {
      const match = re.exec(text);
      if (match?.[1]) {
        refs.push({ specifier: match[1], typeOnly, line: index + 1 });
        return;
      }
    }

    // `import("...")` dinámico y multilínea queda fuera de los patrones de
    // arriba; se busca aparte porque puede estar en cualquier posición.
    for (const match of text.matchAll(/\bimport\(\s*["']([^"']+)["']/g)) {
      if (match[1]) {
        refs.push({ specifier: match[1], typeOnly: false, line: index + 1 });
      }
    }
  });

  // `import { type Foo }` inline: el import es de valor para el resto de los
  // nombres, así que solo cuenta como typeOnly si TODOS lo son. El caso mixto
  // se trata como import de valor, que es lo conservador.
  return refs;
}

/** Resuelve un especificador a una ruta de archivo del proyecto, o null. */
function resolveLocal(specifier: string, from: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null; // paquete de node_modules

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // no existe: probamos el siguiente
    }
  }
  return null;
}

const rel = (file: string) => relative(ROOT, file).replace(/\\/g, "/");

// ---------------------------------------------------------------------------
// Vocabulario de lo prohibido
// ---------------------------------------------------------------------------

/** ¿Este especificador trae algo que solo existe en el servidor? */
function isServerOnly(specifier: string): string | null {
  if (specifier === "server-only") return "server-only";
  if (specifier.startsWith("node:")) return specifier;
  if (specifier === "@/lib/db/prisma" || specifier.startsWith("@/lib/db/"))
    return "Prisma";
  if (specifier.startsWith("@prisma/")) return "Prisma";
  if (specifier === "pg" || specifier.startsWith("pg/")) return "pg";
  if (specifier.startsWith("@/lib/services/")) return "un servicio";
  if (specifier === "@/lib/supabase/admin") return "la service role de Supabase";
  return null;
}

/** ¿Trae algo del framework o del entorno, que domain/ no debe conocer? */
function isImpureForDomain(specifier: string): string | null {
  const server = isServerOnly(specifier);
  if (server) return server;
  if (specifier === "next" || specifier.startsWith("next/")) return "Next";
  if (specifier === "react" || specifier.startsWith("react")) return "React";
  if (specifier.startsWith("@supabase/") || specifier.startsWith("@/lib/supabase/"))
    return "Supabase";
  if (specifier.startsWith("@/generated/prisma")) return "el cliente de Prisma";
  if (specifier.startsWith("@/lib/validation/")) return "la capa de validación";
  return null;
}

// ---------------------------------------------------------------------------
// Las reglas
// ---------------------------------------------------------------------------

const problems: string[] = [];
const files = walk(SRC);

function fail(file: string, line: number, message: string): void {
  problems.push(`  ${rel(file)}:${line}\n      ${message}`);
}

// ── 1 · domain/ es puro ────────────────────────────────────────────────────
//
// Esta es la regla que hace innecesaria la lista de excepciones: cualquier
// módulo de domain/ que pase este chequeo se puede importar desde un Client
// Component sin pensarlo.
for (const file of files) {
  if (!rel(file).startsWith("src/lib/domain/")) continue;

  for (const ref of readImports(file)) {
    if (ref.typeOnly) continue;
    const what = isImpureForDomain(ref.specifier);
    if (what) {
      fail(
        file,
        ref.line,
        `domain/ tiene que ser puro y esto importa ${what} ("${ref.specifier}").\n` +
          `      Si el cálculo necesita eso, no es de dominio: va en services/.`,
      );
    }
  }
}

// ── 2 · Passenger y Person, un solo módulo ─────────────────────────────────
const PASSENGER_TABLE_ALLOWED = new Set([
  "src/lib/services/passengers.ts",
  // La excepción de bootstrap, documentada en el propio archivo y en AGENTS.md.
  "src/lib/auth/passenger-bootstrap.ts",
]);

for (const file of files) {
  const path = rel(file);
  if (PASSENGER_TABLE_ALLOWED.has(path)) continue;

  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((text, index) => {
    // Se ignoran comentarios: los docblocks nombran las tablas a propósito.
    const code = text.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    const match = /\b(?:prisma|tx)\.(passenger|person)\b\s*\./.exec(code);
    if (match) {
      fail(
        file,
        index + 1,
        `consulta \`${match[1]}\` fuera de services/passengers.ts.\n` +
          `      Esa tabla se toca desde un solo módulo, que aplica passengerVisibilityFilter().`,
      );
    }
  });
}

// ── 3 · services/ no importa React ─────────────────────────────────────────
for (const file of files) {
  if (!rel(file).startsWith("src/lib/services/")) continue;

  for (const ref of readImports(file)) {
    if (ref.typeOnly) continue;
    if (ref.specifier === "react" || ref.specifier.startsWith("react/")) {
      fail(file, ref.line, `services/ no importa React ("${ref.specifier}").`);
    }
  }
}

// ── 4 · La frontera del cliente, por "use client" y siguiendo el grafo ─────
//
// Se parte de cada archivo marcado con "use client" y se recorren TODAS sus
// importaciones locales, en profundidad. La regla no es "esta carpeta no
// importa servicios": es "nada de lo que termina en el bundle del navegador
// puede llegar a Prisma", que es la propiedad que de verdad importa.
const clientEntries = files.filter((file) => {
  const head = readFileSync(file, "utf8").slice(0, 200);
  return /^\s*["']use client["']/m.test(head);
});

/**
 * Un archivo `"use server"` es una FRONTERA, no una dependencia.
 *
 * Next no empaqueta el módulo de una Server Action: lo reemplaza por una
 * referencia que hace una llamada de red. Que un formulario del navegador
 * importe `actions.ts`, y que ese archivo importe Prisma, es el diseño
 * correcto y no una fuga.
 *
 * Sin esta parada el recorrido acusaría a casi todos los formularios del
 * sistema, y una regla que grita donde no hay problema se termina apagando.
 */
function isServerBoundary(file: string): boolean {
  const head = readFileSync(file, "utf8").slice(0, 200);
  return /^\s*["']use server["']/m.test(head);
}

for (const entry of clientEntries) {
  const seen = new Set<string>();
  const stack: { file: string; chain: string[] }[] = [
    { file: entry, chain: [rel(entry)] },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (seen.has(current.file)) continue;
    seen.add(current.file);

    for (const ref of readImports(current.file)) {
      if (ref.typeOnly) continue;

      const forbidden = isServerOnly(ref.specifier);
      if (forbidden) {
        const chain =
          current.chain.length > 1
            ? `\n      Cadena: ${current.chain.join(" → ")}`
            : "";
        fail(
          current.file,
          ref.line,
          `esto termina en el bundle del navegador y trae ${forbidden} ("${ref.specifier}").\n` +
            `      Entrada del cliente: ${rel(entry)}${chain}`,
        );
        continue;
      }

      const next = resolveLocal(ref.specifier, current.file);
      if (next && !seen.has(next) && !isServerBoundary(next)) {
        stack.push({ file: next, chain: [...current.chain, rel(next)] });
      }
    }
  }
}

// ── 5 · Las cáscaras no consultan la base ──────────────────────────────────
//
// Server Actions, Route Handlers y páginas entran por servicios. Importar
// funciones PURAS de domain/ está permitido: no es lógica de acceso a datos y
// la regla 1 ya garantiza que no arrastran nada.
for (const file of files) {
  const path = rel(file);
  if (!path.startsWith("src/app/")) continue;

  for (const ref of readImports(file)) {
    if (ref.typeOnly) continue;
    if (
      ref.specifier === "@/lib/db/prisma" ||
      ref.specifier.startsWith("@/lib/db/")
    ) {
      fail(
        file,
        ref.line,
        `la capa de app no consulta la base directo.\n` +
          `      Movelo a un servicio: ahí vive la autorización, y en un solo lugar.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------

if (problems.length > 0) {
  console.error(
    `\n✗ Límites entre capas: ${problems.length} ${
      problems.length === 1 ? "violación" : "violaciones"
    }.\n`,
  );
  console.error(problems.join("\n\n"));
  console.error(
    "\n  Las reglas y sus porqués están en README §Arquitectura.\n",
  );
  process.exit(1);
}

console.log(
  `✓ capas: ${files.length} archivos, ${clientEntries.length} entradas de cliente, todo en orden.`,
);
