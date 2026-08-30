import { describe, expect, it } from "vitest";
import { pickLocalized, tokenizePlainText } from "@/lib/domain/rich-text";

/**
 * El sustituto del "texto enriquecido".
 *
 * Lo que se verifica no es que quede lindo, sino la propiedad que hace que sea
 * seguro mostrarlo en una pantalla pública: de acá NUNCA sale marcado, solo
 * valores. Si alguna vez alguien lo cambia para devolver HTML, estos tests se
 * caen.
 */

describe("tokenizePlainText", () => {
  it("un texto sin links es un solo trozo de texto", () => {
    const tokens = tokenizePlainText("Un viaje de catorce días.");
    expect(tokens).toEqual([
      { kind: "text", value: "Un viaje de catorce días." },
    ]);
  });

  it("reconoce el link de Canva, que es el caso que motivó todo esto", () => {
    const tokens = tokenizePlainText(
      "El itinerario está acá: https://www.canva.com/design/abc123",
    );
    expect(tokens).toEqual([
      { kind: "text", value: "El itinerario está acá: " },
      {
        kind: "link",
        value: "https://www.canva.com/design/abc123",
        href: "https://www.canva.com/design/abc123",
      },
    ]);
  });

  it("deja el punto final AFUERA del link", () => {
    // Sin esto, "mirá https://x.com/a." genera un link a ".../a." que rompe.
    const tokens = tokenizePlainText("Mirá https://x.com/a.");
    expect(tokens[1]).toEqual({
      kind: "link",
      value: "https://x.com/a",
      href: "https://x.com/a",
    });
    expect(tokens[2]).toEqual({ kind: "text", value: "." });
  });

  it("NO convierte en link nada que no sea http o https", () => {
    // El caso que importa: este texto lo escribe una persona y se muestra en
    // una pantalla sin sesión. Un href con javascript: sería ejecución de
    // código.
    for (const hostile of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
    ]) {
      const tokens = tokenizePlainText(`Mirá ${hostile} acá`);
      expect(
        tokens.every((token) => token.kind === "text"),
        `${hostile} no debería producir un link`,
      ).toBe(true);
    }
  });

  it("nunca devuelve marcado, ni cuando el texto trae HTML", () => {
    // Control positivo: el HTML ESTÁ en la entrada y sale como texto plano,
    // no como un token distinto ni escapado a medias. Quien renderiza lo
    // escapa; acá lo que importa es que no se lo trate como estructura.
    const tokens = tokenizePlainText('<script>alert("x")</script> y más');
    expect(tokens).toEqual([
      { kind: "text", value: '<script>alert("x")</script> y más' },
    ]);
  });

  it("maneja varios links en el mismo párrafo", () => {
    const tokens = tokenizePlainText(
      "Uno https://a.test/x, otro https://b.test/y.",
    );
    const links = tokens.filter((token) => token.kind === "link");
    expect(links).toHaveLength(2);
    expect(links[0]?.value).toBe("https://a.test/x");
    expect(links[1]?.value).toBe("https://b.test/y");
  });

  it("un texto vacío no explota", () => {
    expect(tokenizePlainText("")).toEqual([]);
  });
});

describe("pickLocalized", () => {
  it("en español devuelve el español", () => {
    expect(pickLocalized("Hola", "Hello", "es")).toBe("Hola");
  });

  it("en inglés devuelve el inglés", () => {
    expect(pickLocalized("Hola", "Hello", "en")).toBe("Hello");
  });

  it("sin inglés cargado, un lector en inglés ve el español", () => {
    // Una escuela que todavía no tradujo su propuesta tiene que poder abrir la
    // inscripción igual. Mostrar el español es mejor que mostrar un hueco.
    expect(pickLocalized("Hola", null, "en")).toBe("Hola");
  });

  it("un string en blanco cuenta como ausente", () => {
    // Un textarea vaciado deja "" y no null, y "" no es una traducción.
    expect(pickLocalized("Hola", "   ", "en")).toBe("Hola");
    expect(pickLocalized("   ", "Hello", "es")).toBe("Hello");
  });

  it("sin nada cargado devuelve null, no un string vacío", () => {
    // Quien llama decide qué mostrar en su lugar; "" se renderizaría como un
    // párrafo vacío que nadie entiende.
    expect(pickLocalized(null, null, "es")).toBeNull();
    expect(pickLocalized("", "", "en")).toBeNull();
  });

  it("acepta locales con región, como es-AR o en-GB", () => {
    expect(pickLocalized("Hola", "Hello", "en-GB")).toBe("Hello");
    expect(pickLocalized("Hola", "Hello", "es-AR")).toBe("Hola");
  });
});
