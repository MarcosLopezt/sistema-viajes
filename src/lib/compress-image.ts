/**
 * Compresión de imágenes en el navegador, antes de subir.
 *
 * Una foto de un certificado sacada con un celular moderno pesa entre 4 y
 * 12 MB. Para leer un papel eso es un desperdicio: sobra con 1600px de lado
 * mayor. Comprimir acá evita subidas de minutos con datos móviles y que el
 * archivo rebote contra el límite de 8 MB.
 *
 * Los PDF NO se tocan: no son imágenes, y recomprimirlos rompería el texto.
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

export const COMPRESSIBLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function isCompressible(file: File): boolean {
  return COMPRESSIBLE_TYPES.includes(file.type);
}

/**
 * Devuelve una versión comprimida, o el archivo original si comprimir no
 * ayuda.
 *
 * Ese último caso importa: una imagen ya chica puede salir MÁS pesada al
 * reencodearla, y devolver la original es siempre correcto.
 */
export async function compressImage(file: File): Promise<File> {
  if (!isCompressible(file)) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Un archivo que el navegador no puede decodificar se manda tal cual: el
    // servidor lo va a rechazar con un mensaje claro.
    return file;
  }

  const scale = Math.min(
    1,
    MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }

  // Fondo blanco: un PNG con transparencia pasado a JPEG dejaría el fondo
  // negro y un certificado escaneado quedaría ilegible.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });

  if (!blob || blob.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}
