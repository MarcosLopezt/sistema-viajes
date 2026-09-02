import { z } from "zod";

/**
 * Validación del registro público y de los textos de marca.
 *
 * ── Por qué acá NO hay un schema "draft" ──────────────────────────────────
 *
 * El formulario de datos personales tiene dos schemas porque son 3 pasos con
 * autoguardado, y ahí un schema estricto haría perder lo ya escrito. El
 * registro de /interes es lo contrario: cinco campos, una sola pantalla, un
 * solo envío. No hay nada que autoguardar y por lo tanto nada que perder.
 *
 * Los mensajes de error son literales y no llevan la voz de marca. Es
 * deliberado y está en el pedido de la fase: el tono va en lo que las
 * coordinadoras escriben, no en un error de validación. Alguien que se
 * equivocó tipeando su mail necesita saber qué arreglar, no que le hablen
 * lindo.
 */

/**
 * El nombre, tal como lo escriba. No se pide "como en el pasaporte" acá.
 *
 * En este momento del embudo todavía no hay pasaje que emitir y pedirlo sería
 * una fricción sin sentido en la primera pantalla que ve alguien que llegó de
 * Instagram. La exigencia del pasaporte aparece en el formulario de 3 pasos,
 * después de convertirse, que es donde importa.
 */
const fullName = z
  .string()
  .trim()
  .min(2, "Poné tu nombre.")
  .max(200, "Ese nombre es demasiado largo.");

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .pipe(z.email("Escribí un email válido, con arroba."));

/**
 * Ocho caracteres, igual que el canje de invitación.
 *
 * Se mantiene el mismo mínimo que ya usa el sistema a propósito: dos reglas de
 * contraseña distintas en la misma aplicación es la clase de inconsistencia
 * que después nadie sabe explicar.
 */
const password = z
  .string()
  .min(8, "Elegí una contraseña de al menos 8 caracteres.")
  .max(200, "Esa contraseña es demasiado larga.");

const residenceCountry = z
  .string()
  .trim()
  .min(2, "Poné el país donde vivís.")
  .max(100, "Ese país es demasiado largo.");

/**
 * Teléfono OPCIONAL, y por eso el vacío tiene que pasar.
 *
 * Un `.regex()` sobre un campo opcional rechaza el string vacío, que es
 * exactamente lo que manda un input que la persona no tocó. Por eso el vacío
 * se convierte en null ANTES de validar el formato, y no después.
 */
const phone = z
  .string()
  .trim()
  .max(40)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .refine(
    (value) => value === null || /^\+?[\d\s()-]{7,}$/.test(value),
    "Escribí el teléfono con código de país, o dejalo vacío.",
  );

export const registerInterestSchema = z.object({
  fullName,
  email,
  password,
  residenceCountry,
  phone,
});

export type RegisterInterestFormInput = z.infer<typeof registerInterestSchema>;

// ---------------------------------------------------------------------------

/**
 * Los textos de marca que editan las coordinadoras.
 *
 * Todos opcionales: un viaje sin la propuesta cargada todavía no puede abrir
 * la inscripción, pero eso lo decide el switch de `acceptingInterest`, no
 * este schema. Bloquear el guardado de un borrador a medias sería impedirles
 * escribir en dos sentadas.
 *
 * El inglés es opcional aparte: cae al español al mostrarse. Mismo criterio
 * que Communication.
 *
 * Son textos largos —una propuesta de viaje entera— así que el tope es
 * generoso. Existe igual, para que nadie pegue un libro en un textarea.
 */
const brandText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => {
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    })
    .nullable()
    .optional();

export const tripPublicTextsSchema = z.object({
  infoForInterestedEs: brandText(8000),
  infoForInterestedEn: brandText(8000),
  welcomeMessageEs: brandText(2000),
  welcomeMessageEn: brandText(2000),
  nextStepMessageEs: brandText(2000),
  nextStepMessageEn: brandText(2000),
  emailSignatureEs: brandText(300),
  emailSignatureEn: brandText(300),
  closedMessageEs: brandText(2000),
  closedMessageEn: brandText(2000),
  /**
   * La condición de no reembolsable. Más larga que los demás textos porque es
   * el único que además de comunicar tiene que decir exactamente qué pasa si
   * el viaje se cancela, y ese párrafo no se puede escribir en dos líneas.
   */
  depositTermsEs: brandText(5000),
  depositTermsEn: brandText(5000),
  paymentInstructionsEs: brandText(3000),
  paymentInstructionsEn: brandText(3000),
});

export type TripPublicTextsInput = z.infer<typeof tripPublicTextsSchema>;
