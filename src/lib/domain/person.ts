/**
 * Completitud de los datos de una persona.
 *
 * Es la única definición de "datos completos" del sistema, y se usa para dos
 * cosas a la vez, a propósito:
 *   - el "% de completitud" que ve el pasajero en su home;
 *   - el gate que habilita al coordinador a pasarlo a CONFIRMADO.
 * Si fueran dos definiciones distintas divergirían, y el pasajero vería 100%
 * mientras el coordinador no puede confirmarlo.
 *
 * Las columnas son nullable en la base porque el formulario son 3 pasos con
 * autoguardado (una fila a medio completar tiene que poder persistirse). La
 * obligatoriedad de negocio vive acá, no en el schema.
 *
 * Función pura, testeada en tests/domain/person.test.ts.
 */

export type PersonStep = 1 | 2 | 3;

/** Subconjunto estructural de Person: sirve con el modelo y con parciales. */
export interface PersonCompletenessInput {
  fullName?: string | null;
  birthDate?: Date | null;
  nationalityCountry?: string | null;
  passportIssuingCountry?: string | null;
  residenceCountry?: string | null;
  residenceAddress?: string | null;
  residenceCity?: string | null;
  mobilePhone?: string | null;
  documentNumber?: string | null;
  passportNumber?: string | null;
  passportExpiryDate?: Date | null;

  emergencyContactName?: string | null;
  emergencyContactRelationship?: string | null;
  emergencyContactPhone?: string | null;
  medicalAssuranceCompany?: string | null;
  medicalAssuranceId?: string | null;
  medicalAssurancePhone?: string | null;
  medicalAssuranceEmail?: string | null;

  hasDietaryRestrictions?: boolean | null;
  dietaryRestrictionsDetail?: string | null;
  hasMobilityRestrictions?: boolean | null;
  mobilityRestrictionsDetail?: string | null;
  takesMedication?: boolean | null;
  takesMedicationDetail?: string | null;
  psychTreatment?: boolean | null;
  psychTreatmentDetail?: string | null;
  anxietyOrPanic?: boolean | null;
  anxietyOrPanicDetail?: string | null;

  /**
   * Campos verdaderamente opcionales. Se declaran acá para poder pasar una
   * Person entera sin castear, pero NUNCA entran en el cálculo de
   * completitud: dejarlos vacíos no baja el porcentaje ni bloquea nada.
   */
  otherHealthNotes?: string | null;
  profession?: string | null;
  additionalInfo?: string | null;

  medicalAssuranceFileId?: string | null;
}

export type PersonField = keyof PersonCompletenessInput;

export interface PersonCompleteness {
  complete: boolean;
  /** Campos requeridos que faltan, en orden de formulario. */
  missing: PersonField[];
  /** Entero 0..100. */
  completionPercentage: number;
  /** Primer paso con algo pendiente. `null` si está todo completo. */
  firstIncompleteStep: PersonStep | null;
  requiredCount: number;
  completedCount: number;
}

/** Paso 1 — quién sos. */
const STEP_1: readonly PersonField[] = [
  "fullName",
  "birthDate",
  "nationalityCountry",
  // El país EMISOR del pasaporte, que no es la nacionalidad: con doble
  // ciudadanía son distintos, y el visado lo pide el pasaporte con el que se
  // viaja.
  "passportIssuingCountry",
  "residenceCountry",
  "residenceAddress",
  "residenceCity",
  "mobilePhone",
  "documentNumber",
  "passportNumber",
  "passportExpiryDate",
];

/** Paso 2 — contacto de emergencia y salud (parte incondicional). */
const STEP_2: readonly PersonField[] = [
  "emergencyContactName",
  "emergencyContactRelationship",
  "emergencyContactPhone",
  "medicalAssuranceCompany",
  "medicalAssuranceId",
  "medicalAssurancePhone",
  "medicalAssuranceEmail",
];

/**
 * Los campos de salud mental, en un solo lugar.
 *
 * De acá sale el test que recorre las tres exportaciones y falla si alguno
 * aparece (tests/integration/exports.test.ts). Que la lista viva en domain/ y
 * no adentro del test es lo que hace que agregar un campo sensible al modelo
 * lo cubra automáticamente: el test no enumera, itera.
 *
 * Son la categoría de dato más sensible del sistema. Ver el docblock de Person
 * en prisma/schema.prisma para las cuatro reglas y dónde las hace cumplir el
 * código.
 */
export const SENSITIVE_PERSON_FIELDS = [
  "psychTreatment",
  "psychTreatmentDetail",
  "anxietyOrPanic",
  "anxietyOrPanicDetail",
] as const satisfies readonly PersonField[];

export type SensitivePersonField = (typeof SENSITIVE_PERSON_FIELDS)[number];

/**
 * Paso 3 — documentos.
 * El certificado de la cobertura médica es OBLIGATORIO: sin él no se puede
 * confirmar al pasajero.
 */
const STEP_3: readonly PersonField[] = ["medicalAssuranceFileId"];

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return true;
}

/**
 * Campos requeridos para esta persona en particular.
 *
 * Los detalles de restricciones son condicionales: solo se exigen si la
 * persona declaró tener la restricción. Si no, pedirlos sería exigir que
 * escriba "ninguna" para llegar al 100%.
 */
export function requiredFieldsFor(
  person: PersonCompletenessInput,
): readonly PersonField[] {
  const step2: PersonField[] = [...STEP_2];
  if (person.hasDietaryRestrictions === true) {
    step2.push("dietaryRestrictionsDetail");
  }
  if (person.hasMobilityRestrictions === true) {
    step2.push("mobilityRestrictionsDetail");
  }
  if (person.takesMedication === true) {
    step2.push("takesMedicationDetail");
  }
  // Los dos sensibles siguen exactamente la misma regla condicional que el
  // resto: el detalle se exige solo si declaró que sí. No hay un trato
  // especial acá — el trato especial está en quién los ve y por dónde NO
  // salen, no en si son obligatorios.
  if (person.psychTreatment === true) {
    step2.push("psychTreatmentDetail");
  }
  if (person.anxietyOrPanic === true) {
    step2.push("anxietyOrPanicDetail");
  }
  return [...STEP_1, ...step2, ...STEP_3];
}

function stepOf(field: PersonField): PersonStep {
  if (STEP_1.includes(field)) return 1;
  if (STEP_3.includes(field)) return 3;
  return 2;
}

export function evaluatePersonCompleteness(
  person: PersonCompletenessInput,
): PersonCompleteness {
  const required = requiredFieldsFor(person);
  const missing = required.filter((field) => !isFilled(person[field]));
  const completedCount = required.length - missing.length;

  const firstIncompleteStep =
    missing.length === 0
      ? null
      : (Math.min(...missing.map(stepOf)) as PersonStep);

  return {
    complete: missing.length === 0,
    missing,
    completionPercentage: Math.round((completedCount / required.length) * 100),
    firstIncompleteStep,
    requiredCount: required.length,
    completedCount,
  };
}

/** Atajo para el gate de confirmación. */
export function isPersonComplete(person: PersonCompletenessInput): boolean {
  return evaluatePersonCompleteness(person).complete;
}
