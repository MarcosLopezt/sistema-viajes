import { describe, expect, it } from "vitest";
import {
  buildXlsx,
  columnLetter,
  sanitizeSheetName,
  type XlsxSheet,
} from "@/lib/domain/xlsx";

/**
 * Tests del escritor de .xlsx.
 *
 * Lo que se verifica acá es la ESTRUCTURA del archivo: que el ZIP esté bien
 * armado, que los XML tengan las partes que Excel exige, y que el contenido
 * escapado sea el que se pasó. No se verifica "que Excel lo abra" porque eso
 * no se puede afirmar desde un test — eso se probó abriendo el archivo, y
 * está anotado en el README.
 *
 * El caso que más importa es el escapeo: un apellido con `&` o una nota con
 * comillas rompen el XML, y el síntoma es que Excel se niega a abrir el
 * archivo entero sin decir por qué.
 */

/** Lector de ZIP mínimo, solo para los tests: nombre → contenido en texto. */
function readZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();

  // Se recorren los encabezados locales, que es lo que escribe buildXlsx.
  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;

    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    entries.set(name, decoder.decode(bytes.subarray(dataStart, dataStart + size)));

    offset = dataStart + size;
  }

  return entries;
}

const sheet = (rows: XlsxSheet["rows"]): XlsxSheet => ({
  name: "Hoja",
  rows,
});

describe("columnLetter", () => {
  it("numera las columnas como Excel", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
    expect(columnLetter(51)).toBe("AZ");
    expect(columnLetter(52)).toBe("BA");
    expect(columnLetter(701)).toBe("ZZ");
    expect(columnLetter(702)).toBe("AAA");
  });
});

describe("sanitizeSheetName", () => {
  it("saca los caracteres que Excel rechaza", () => {
    expect(sanitizeSheetName("Pagos/2026")).toBe("Pagos 2026");
    expect(sanitizeSheetName("A[B]C:D*E?F")).toBe("A B C D E F");
  });

  it("recorta a 31 caracteres", () => {
    expect(sanitizeSheetName("x".repeat(40))).toHaveLength(31);
  });

  it("nunca devuelve vacío", () => {
    expect(sanitizeSheetName("   ")).toBe("Hoja");
    expect(sanitizeSheetName("///")).toBe("Hoja");
  });
});

describe("buildXlsx · estructura del paquete", () => {
  const bytes = buildXlsx([
    { name: "Uno", rows: [{ cells: ["a"] }] },
    { name: "Dos", rows: [{ cells: ["b"] }] },
  ]);
  const files = readZip(bytes);

  it("empieza con la firma de un ZIP", () => {
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("trae todas las partes que exige el formato", () => {
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
  });

  it("declara cada hoja en el workbook y en los content types", () => {
    expect(files.get("xl/workbook.xml")).toContain('name="Uno"');
    expect(files.get("xl/workbook.xml")).toContain('name="Dos"');
    expect(files.get("[Content_Types].xml")).toContain("sheet2.xml");
  });

  it("relaciona cada hoja y también los estilos", () => {
    const rels = files.get("xl/_rels/workbook.xml.rels") ?? "";
    expect(rels).toContain("worksheets/sheet1.xml");
    expect(rels).toContain("worksheets/sheet2.xml");
    expect(rels).toContain("styles.xml");
  });

  it("rechaza un libro sin hojas", () => {
    expect(() => buildXlsx([])).toThrow(/al menos una hoja/);
  });
});

describe("buildXlsx · celdas", () => {
  function firstSheet(rows: XlsxSheet["rows"]): string {
    return readZip(buildXlsx([sheet(rows)])).get("xl/worksheets/sheet1.xml") ?? "";
  }

  it("escribe el texto como inlineStr y los números como número", () => {
    const xml = firstSheet([{ cells: ["Ana", 42] }]);
    expect(xml).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Ana</t></is></c>');
    expect(xml).toContain('<c r="B1"><v>42</v></c>');
  });

  it("marca en negrita la fila que lo pide", () => {
    const xml = firstSheet([{ cells: ["Nombre"], bold: true }, { cells: ["Ana"] }]);
    expect(xml).toContain('<c r="A1" s="1"');
    expect(xml).toContain('<c r="A2" t="inlineStr"');
    expect(xml).not.toContain('<c r="A2" s="1"');
  });

  it("deja la celda vacía para null y para el string vacío", () => {
    const xml = firstSheet([{ cells: [null, ""] }]);
    expect(xml).toContain('<c r="A1"/>');
    expect(xml).toContain('<c r="B1"/>');
  });

  it("numera filas y columnas correlativamente", () => {
    const xml = firstSheet([{ cells: ["a", "b"] }, { cells: ["c", "d"] }]);
    expect(xml).toContain('r="A1"');
    expect(xml).toContain('r="B1"');
    expect(xml).toContain('r="A2"');
    expect(xml).toContain('r="B2"');
  });

  it("escribe los anchos de columna", () => {
    const bytes = buildXlsx([
      { name: "H", columnWidths: [30, 12], rows: [{ cells: ["a", "b"] }] },
    ]);
    const xml = readZip(bytes).get("xl/worksheets/sheet1.xml") ?? "";
    expect(xml).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
    expect(xml).toContain('<col min="2" max="2" width="12" customWidth="1"/>');
  });
});

describe("buildXlsx · escapeo", () => {
  function textOf(value: string): string {
    return readZip(buildXlsx([sheet([{ cells: [value] }])])).get(
      "xl/worksheets/sheet1.xml",
    ) ?? "";
  }

  it("escapa los caracteres que romperían el XML", () => {
    // Sin esto, un apellido con `&` hace que Excel se niegue a abrir el
    // archivo entero, y el mensaje no dice cuál fue la celda.
    expect(textOf("Pérez & Cía.")).toContain("Pérez &amp; Cía.");
    expect(textOf("a < b > c")).toContain("a &lt; b &gt; c");
    expect(textOf('dijo "hola"')).toContain("dijo &quot;hola&quot;");
    expect(textOf("O'Brien")).toContain("O&apos;Brien");
  });

  it("no deja pasar un `<` sin escapar", () => {
    const xml = textOf("<script>");
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("&lt;script&gt;");
  });

  it("saca los caracteres de control pero conserva tabs y saltos de línea", () => {
    const xml = textOf("a\u0000b\u0007c\td\ne");
    expect(xml).toContain("abc\td\ne");
  });

  it("conserva los acentos y la eñe", () => {
    expect(textOf("Año: cañón, París")).toContain("Año: cañón, París");
  });

  it("sobrevive a un emoji (par sustituto)", () => {
    expect(textOf("vuelo ✈️ ok")).toContain("vuelo ✈️ ok");
  });
});

describe("buildXlsx · determinismo", () => {
  it("el mismo contenido produce los mismos bytes", () => {
    const make = () =>
      buildXlsx([sheet([{ cells: ["Ana", 1] }, { cells: ["Beto", 2] }])]);
    expect(Array.from(make())).toEqual(Array.from(make()));
  });
});
