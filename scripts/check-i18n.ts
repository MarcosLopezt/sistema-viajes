/**
 * Verifica que todos los archivos de traducción tengan exactamente las mismas
 * claves, y que ninguna traducción esté vacía.
 *
 * Corre en `npm run check:i18n` y dentro de `npm run verify`. Sin esto el
 * inglés se desincroniza en tres semanas y nadie se entera hasta que un
 * pasajero ve una clave cruda en pantalla.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MESSAGES_DIR = join(process.cwd(), "src", "messages");
const REFERENCE_LOCALE = "es";
const LOCALES = ["es", "en"] as const;

type Messages = { [key: string]: string | Messages };

function load(locale: string): Messages {
  const path = join(MESSAGES_DIR, `${locale}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Messages;
}

/** Aplana `{ a: { b: "x" } }` a `["a.b"]`. */
function flatten(messages: Messages, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out.set(path, value);
    } else {
      for (const [k, v] of flatten(value, path)) out.set(k, v);
    }
  }
  return out;
}

/**
 * Extrae los nombres de argumento de un mensaje ICU.
 *
 * Solo cuenta como argumento un identificador que cierra la llave enseguida
 * (`{name}`) o que va seguido de coma (`{count, plural, ...}`). Sin esa
 * restricción, el texto de una rama de plural —`=0 {Sin usuarios}`— se leería
 * como un argumento llamado "Sin".
 */
function placeholders(message: string): Set<string> {
  const found = new Set<string>();
  for (const match of message.matchAll(/\{\s*(\w+)\s*[,}]/g)) {
    if (match[1]) found.add(match[1]);
  }
  return found;
}

const reference = flatten(load(REFERENCE_LOCALE));
const problems: string[] = [];

for (const locale of LOCALES) {
  if (locale === REFERENCE_LOCALE) continue;
  const current = flatten(load(locale));

  for (const key of reference.keys()) {
    if (!current.has(key)) {
      problems.push(`[${locale}] falta la clave: ${key}`);
    }
  }

  for (const key of current.keys()) {
    if (!reference.has(key)) {
      problems.push(`[${locale}] clave de más (no existe en ${REFERENCE_LOCALE}): ${key}`);
    }
  }

  for (const [key, value] of current) {
    if (value.trim().length === 0) {
      problems.push(`[${locale}] traducción vacía: ${key}`);
    }
    // Un placeholder que existe en un idioma y no en el otro rompe el mensaje
    // en tiempo de ejecución, no de compilación. Mejor atajarlo acá.
    const expected = reference.get(key);
    if (expected) {
      const missing = [...placeholders(expected)].filter(
        (p) => !placeholders(value).has(p),
      );
      if (missing.length > 0) {
        problems.push(
          `[${locale}] ${key}: faltan los placeholders {${missing.join("}, {")}}`,
        );
      }
    }
  }
}

// También chequeamos vacíos en el idioma de referencia.
for (const [key, value] of reference) {
  if (value.trim().length === 0) {
    problems.push(`[${REFERENCE_LOCALE}] traducción vacía: ${key}`);
  }
}

if (problems.length > 0) {
  console.error(`\n✗ i18n: ${problems.length} problema(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("");
  process.exit(1);
}

console.info(
  `✓ i18n: ${reference.size} claves, ${LOCALES.length} idiomas, todo en orden.`,
);
