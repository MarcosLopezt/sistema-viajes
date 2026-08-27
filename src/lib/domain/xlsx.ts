/**
 * Escritor de archivos .xlsx, sin dependencias.
 *
 * ── Por qué escribimos esto en vez de instalar una librería ───────────────
 *
 * Un .xlsx es un ZIP con unos pocos XML adentro. Para lo que hace falta acá
 * —una hoja por exportación, encabezados en negrita, anchos de columna y una
 * fila con la fecha de generación— eso son doscientas líneas, y a cambio no
 * entra un megabyte de dependencia con sus transitivas para tres pantallas.
 *
 * ── Por qué el ZIP no comprime ────────────────────────────────────────────
 *
 * El método STORE (sin compresión) es parte del formato ZIP y Excel lo abre
 * igual. La alternativa era `node:zlib`, y eso convertiría a este módulo en
 * código de servidor: dejaría de ser una función pura, no podría vivir en
 * domain/ y `check:layers` lo rechazaría con razón.
 *
 * El costo real es tamaño: un listado de cincuenta pasajeros pesa unos 60 KB
 * en vez de 8 KB. Para un adjunto de mail eso no es nada, y a cambio el
 * módulo se testea llamándolo, sin montar nada.
 *
 * Si algún día hubiera que exportar decenas de miles de filas, este es el
 * lugar donde agregar deflate — y ahí sí el módulo se muda a services/.
 */

export type XlsxValue = string | number | null;

export interface XlsxRow {
  cells: XlsxValue[];
  /** Fila en negrita. Se usa para encabezados y para la fila de generación. */
  bold?: boolean;
}

export interface XlsxSheet {
  /** Nombre de la pestaña. Excel no admite más de 31 caracteres ni []:*?/\ */
  name: string;
  /** Ancho de cada columna, en caracteres. */
  columnWidths?: number[];
  rows: XlsxRow[];
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Los caracteres de control rompen el XML y Excel se niega a abrir el
    // archivo entero por uno solo. Vienen de datos cargados a mano.
    .replace(/[^]/gu, (char) => (isXmlSafe(char) ? char : ""));
}

/**
 * ¿Este carácter es válido dentro de un XML 1.0?
 *
 * Tab, salto de línea y retorno de carro sí; el resto del rango de control
 * no, y uno solo hace que Excel se niegue a abrir el archivo entero. Llegan
 * de datos cargados a mano, típicamente pegados desde otra planilla.
 */
function isXmlSafe(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x20) return true;
  return code === 0x09 || code === 0x0a || code === 0x0d;
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnLetter(index: number): string {
  let letters = "";
  let n = index;
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/**
 * Excel rechaza el archivo si el nombre de una hoja tiene caracteres
 * prohibidos o pasa de 31 caracteres, y el mensaje que da no dice cuál era el
 * problema. Se saneia acá en vez de confiar en quien llama.
 */
export function sanitizeSheetName(name: string): string {
  const clean = name.replace(/[[\]:*?/\\]/g, " ").trim();
  return (clean === "" ? "Hoja" : clean).slice(0, 31);
}

function cellXml(value: XlsxValue, ref: string, style: number): string {
  const s = style > 0 ? ` s="${style}"` : "";

  if (value === null || value === "") return `<c r="${ref}"${s}/>`;

  if (typeof value === "number") {
    // NaN e Infinity no tienen representación en el formato: se escriben como
    // texto para que el archivo abra y el problema se vea en la celda.
    if (!Number.isFinite(value)) {
      return `<c r="${ref}"${s} t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
    }
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }

  // Todo el texto va como inlineStr: sin tabla de strings compartidos el
  // archivo es más grande y muchísimo más simple de generar y de leer.
  // `xml:space="preserve"` evita que Excel coma los espacios de los bordes.
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const cols =
    sheet.columnWidths && sheet.columnWidths.length > 0
      ? `<cols>${sheet.columnWidths
          .map(
            (width, index) =>
              `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
          )
          .join("")}</cols>`
      : "";

  const rows = sheet.rows
    .map((row, rowIndex) => {
      const style = row.bold ? 1 : 0;
      const cells = row.cells
        .map((value, colIndex) =>
          cellXml(value, `${columnLetter(colIndex)}${rowIndex + 1}`, style),
        )
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `${cols}<sheetData>${rows}</sheetData></worksheet>`
  );
}

/** Dos estilos y nada más: normal y negrita. */
const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs></styleSheet>`;

// ---------------------------------------------------------------------------
// ZIP (método STORE)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

const u16 = (n: number) => bytes(n & 0xff, (n >>> 8) & 0xff);
const u32 = (n: number) =>
  bytes(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);

/**
 * Arma el ZIP.
 *
 * Fecha y hora fijas en 1980-01-01 a propósito: el mismo contenido produce el
 * mismo archivo byte a byte, lo que hace que los tests puedan comparar
 * resultados. La fecha que le importa a quien recibe el archivo está en la
 * primera fila de la planilla, no en los metadatos del ZIP.
 */
function buildZip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const DOS_TIME = 0;
  const DOS_DATE = 33; // 1980-01-01

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = concat([
      u32(0x04034b50),
      u16(20), // versión mínima
      u16(0), // flags
      u16(0), // STORE
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(size), // comprimido
      u32(size), // sin comprimir
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);

    local.push(localHeader, entry.data);

    central.push(
      concat([
        u32(0x02014b50),
        u16(20), // versión con la que se creó
        u16(20), // versión mínima
        u16(0),
        u16(0),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(crc),
        u32(size),
        u32(size),
        u16(nameBytes.length),
        u16(0), // extra
        u16(0), // comentario
        u16(0), // disco
        u16(0), // atributos internos
        u32(0), // atributos externos
        u32(offset),
        nameBytes,
      ]),
    );

    offset += localHeader.length + size;
  }

  const centralBytes = concat(central);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);

  return concat([...local, centralBytes, end]);
}

// ---------------------------------------------------------------------------

/**
 * Arma un .xlsx con una hoja por elemento de `sheets`.
 *
 * Devuelve los bytes del archivo. Es una función pura: mismas hojas, mismos
 * bytes, siempre.
 */
/**
 * El tipo dice `Uint8Array<ArrayBuffer>` y no `Uint8Array` a secas porque el
 * genérico por defecto es `ArrayBufferLike`, que incluye `SharedArrayBuffer` y
 * por eso no sirve como cuerpo de una respuesta HTTP. Acá siempre se construye
 * con `new Uint8Array(n)`, que está respaldado por un ArrayBuffer real:
 * declararlo evita que cada consumidor tenga que forzar el tipo.
 */
export function buildXlsx(sheets: XlsxSheet[]): Uint8Array<ArrayBuffer> {
  if (sheets.length === 0) {
    throw new Error("Un .xlsx necesita al menos una hoja.");
  }

  const encoder = new TextEncoder();
  const named = sheets.map((sheet) => ({
    ...sheet,
    name: sanitizeSheetName(sheet.name),
  }));

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    named
      .map(
        (_, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    named
      .map(
        (sheet, index) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join("") +
    `</sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    named
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    { name: "xl/styles.xml", data: encoder.encode(STYLES_XML) },
    ...named.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: encoder.encode(sheetXml(sheet)),
    })),
  ];

  return buildZip(entries);
}
