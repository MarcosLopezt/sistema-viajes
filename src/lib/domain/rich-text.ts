/**
 * Los textos que escriben las coordinadoras, partidos en trozos renderizables.
 *
 * ── Por qué esto y no un editor de texto enriquecido ──────────────────────
 *
 * La fase 7 pedía "texto enriquecido" para `infoForInterested`. No se hizo, y
 * la razón es que el sistema ya tomó esta decisión una vez: el cuerpo de una
 * comunicación se muestra como TEXTO respetando los saltos de línea, nunca
 * como marcado, porque lo escribió una persona en un textarea y renderizarlo
 * como HTML es confiar en que nadie va a pegar nada raro ahí. Ver el
 * comentario en (pasajero)/novedades/page.tsx.
 *
 * Un campo de marca editable por las coordinadoras y mostrado en una pantalla
 * PÚBLICA sin sesión sería el peor lugar del sistema para estrenar un
 * sumidero de HTML.
 *
 * Lo único que 7.4c necesitaba de verdad del "texto enriquecido" era que el
 * link al itinerario de Canva fuera clickeable. Eso es esto: saltos de línea
 * más autolink, y nada más. Si algún día quieren negritas y listas, eso es un
 * subconjunto de markdown y es una decisión aparte, no un `dangerouslySetInnerHTML`.
 *
 * Función pura, testeada en tests/domain/rich-text.test.ts.
 */

export type TextToken =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string };

/**
 * Solo http y https.
 *
 * `javascript:` y `data:` en un href son ejecución de código, y este texto
 * llega desde un campo editable a una pantalla sin sesión. Que el patrón exija
 * el esquema desde el principio —en vez de detectar algo parecido a una URL y
 * después filtrarlo— es lo que hace que no haya un caso raro que se escape:
 * lo que no empieza con http:// o https:// simplemente no es un link.
 *
 * El cierre excluye la puntuación final para que "mirá https://x.com/a." no se
 * lleve el punto adentro del link, y descarta paréntesis y comillas de cierre
 * por lo mismo.
 */
const URL_PATTERN = /https?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;

/**
 * Parte un texto plano en trozos de texto y links.
 *
 * NO escapa nada: el escapado es responsabilidad de quien renderiza. React lo
 * hace solo, y por eso los tokens salen como valores y no como HTML — así este
 * módulo no puede producir marcado ni por accidente.
 */
export function tokenizePlainText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let last = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    const url = match[0];

    if (start > last) {
      tokens.push({ kind: "text", value: text.slice(last, start) });
    }
    tokens.push({ kind: "link", value: url, href: url });
    last = start + url.length;
  }

  if (last < text.length) {
    tokens.push({ kind: "text", value: text.slice(last) });
  }

  return tokens;
}

/**
 * Elige el texto en el idioma del lector, cayendo a español.
 *
 * El inglés es opcional a propósito, igual que en Communication: una escuela
 * que todavía no tradujo su propuesta tiene que poder abrir la inscripción.
 * Mostrar el español es infinitamente mejor que mostrar un hueco.
 *
 * Un string en blanco cuenta como ausente: un textarea vaciado deja "" y no
 * null, y "" no es una traducción.
 */
export function pickLocalized(
  es: string | null | undefined,
  en: string | null | undefined,
  locale: string,
): string | null {
  const trimmedEn = en?.trim();
  const trimmedEs = es?.trim();

  if (locale.toLowerCase().startsWith("en") && trimmedEn) return trimmedEn;
  return trimmedEs || trimmedEn || null;
}
