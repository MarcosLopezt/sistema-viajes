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
  nationalityCountry?: string | null;
  residenceCountry?: string | null;
  residenceAddress?: string | null;
  residenceCity?: string | null;
  mobilePhone?: string | null;
  documentNumber?: string | null;
  passportNumber?: string | null;
  passportExpiryDate?: Date | null;

  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  medicalAssuranceCompany?: string | null;
  medicalAssuranceId?: string | null;
  medicalAssurancePhone?: string | null;
  medicalAssuranceEmail?: string | null;

  hasDietaryRestrictions?: boolean | null;
  dietaryRestrictionsDetail?: string | null;
  hasMobilityRestrictions?: boolean | null;
  mobilityRestrictionsDetail?: string | null;
  /**
   * Único campo verdaderamente opcional del formulario. Se declara acá para
   * poder pasar una Person entera sin castear, pero NUNCA entra en el cálculo
   * de completitud: dejarlo vacío no baja el porcentaje ni bloquea nada.
   */
  otherHealthNotes?: string | null;

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
  "nationalityCountry",
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
  "emergencyContactPhone",
  "medicalAssuranceCompany",
  "medicalAssuranceId",
  "medicalAssurancePhone",
  "medicalAssuranceEmail",
];

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
