import { describe, expect, it } from "vitest";
import {
  can,
  canEditPassenger,
  canViewPassenger,
  editRequiresAudit,
  passengerVisibilityFilter,
  type Capability,
  type ViewerContext,
} from "@/lib/auth/policy";

/**
 * Tests de aislamiento. Codifican la matriz de permisos del documento de
 * requisitos: cada fila de esa tabla tiene su assertion acá.
 *
 * Lo que se prueba es la capa donde efectivamente se decide. Los guards del
 * servidor no repiten estas reglas: resuelven la sesión y llaman a estas
 * funciones, así que si esta matriz está bien, no hay una segunda copia que
 * pueda divergir.
 */

const ALL_CAPABILITIES: readonly Capability[] = [
  "trip:edit",
  "trip:viewFinancials",
  "passenger:invite",
  "interest:manage",
  "passenger:viewAll",
  "passenger:editAny",
  "payment:definePlan",
  "payment:review",
  "communication:send",
  "user:manage",
];

const admin: ViewerContext = {
  userId: "user-admin",
  globalRole: "ADMIN",
  tripRole: null,
  ownPassengerId: null,
};

const coordinator: ViewerContext = {
  userId: "user-coord",
  globalRole: "USER",
  tripRole: "COORDINADOR",
  ownPassengerId: "pax-coord",
};

const passenger: ViewerContext = {
  userId: "user-ana",
  globalRole: "USER",
  tripRole: "PASAJERO",
  ownPassengerId: "pax-ana",
};

/** Usuario logueado que no es miembro de este viaje. */
const outsider: ViewerContext = {
  userId: "user-otro",
  globalRole: "USER",
  tripRole: null,
  ownPassengerId: null,
};

describe("matriz de permisos — ADMIN", () => {
  it("puede todo, incluida la gestión de usuarios", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can(admin, capability), capability).toBe(true);
    }
  });

  it("accede al viaje aunque no sea miembro", () => {
    expect(admin.tripRole).toBeNull();
    expect(can(admin, "trip:viewFinancials")).toBe(true);
  });
});

describe("matriz de permisos — COORDINADOR", () => {
  it("puede operar el viaje", () => {
    const allowed: Capability[] = [
      "trip:edit",
      "trip:viewFinancials",
      "passenger:invite",
      "interest:manage",
      "passenger:viewAll",
      "passenger:editAny",
      "payment:definePlan",
      "payment:review",
      "communication:send",
    ];
    for (const capability of allowed) {
      expect(can(coordinator, capability), capability).toBe(true);
    }
  });

  it("NO puede gestionar usuarios y roles", () => {
    // Única fila de la matriz reservada a ADMIN.
    expect(can(coordinator, "user:manage")).toBe(false);
  });
});

describe("matriz de permisos — PASAJERO", () => {
  it("no tiene NINGUNA capability sobre el viaje", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can(passenger, capability), capability).toBe(false);
    }
  });

  it("nunca ve costos, presupuesto ni margen", () => {
    // Requisito de aislamiento explícito: el pasajero solo ve su precio.
    expect(can(passenger, "trip:viewFinancials")).toBe(false);
  });

  it("no puede invitar, cobrar ni comunicar", () => {
    expect(can(passenger, "passenger:invite")).toBe(false);
    expect(can(passenger, "payment:definePlan")).toBe(false);
    expect(can(passenger, "payment:review")).toBe(false);
    expect(can(passenger, "communication:send")).toBe(false);
  });
});

describe("matriz de permisos — usuario ajeno al viaje", () => {
  it("no puede nada, aunque tenga sesión válida", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can(outsider, capability), capability).toBe(false);
    }
  });
});

describe("aislamiento entre pasajeros", () => {
  it("un pasajero ve sus propios datos", () => {
    expect(canViewPassenger(passenger, "pax-ana")).toBe(true);
    expect(canEditPassenger(passenger, "pax-ana")).toBe(true);
  });

  it("un pasajero NO ve los datos de otro pasajero", () => {
    expect(canViewPassenger(passenger, "pax-beto")).toBe(false);
    expect(canEditPassenger(passenger, "pax-beto")).toBe(false);
  });

  it("un pasajero sin Passenger propio no ve a nadie", () => {
    const sinPassenger: ViewerContext = {
      ...passenger,
      ownPassengerId: null,
    };
    expect(canViewPassenger(sinPassenger, "pax-ana")).toBe(false);
    expect(canViewPassenger(sinPassenger, "pax-beto")).toBe(false);
  });

  it("un ownPassengerId nulo no matchea contra un id nulo colado", () => {
    // Regresión: si la comparación fuera `viewer.ownPassengerId === id` sin
    // el chequeo de nulo, un id vacío coincidiría con un viewer sin pasajero.
    const sinPassenger: ViewerContext = { ...passenger, ownPassengerId: null };
    expect(canViewPassenger(sinPassenger, null as unknown as string)).toBe(
      false,
    );
  });

  it("el coordinador ve y edita a cualquier pasajero del viaje", () => {
    expect(canViewPassenger(coordinator, "pax-ana")).toBe(true);
    expect(canEditPassenger(coordinator, "pax-ana")).toBe(true);
  });

  it("un usuario ajeno no ve a ningún pasajero", () => {
    expect(canViewPassenger(outsider, "pax-ana")).toBe(false);
    expect(canEditPassenger(outsider, "pax-ana")).toBe(false);
  });
});

describe("passengerVisibilityFilter", () => {
  it("no acota la consulta para quien puede ver a todos", () => {
    expect(passengerVisibilityFilter(coordinator)).toEqual({});
    expect(passengerVisibilityFilter(admin)).toEqual({});
  });

  it("acota la consulta del pasajero a su propia fila", () => {
    expect(passengerVisibilityFilter(passenger)).toEqual({ id: "pax-ana" });
  });

  it("falla cerrado para quien no tiene acceso", () => {
    // Devuelve una condición imposible, no `{}`. Si por error se omitiera el
    // guard, la consulta trae cero filas en vez de traerlas todas.
    const filter = passengerVisibilityFilter(outsider);
    expect(filter).not.toEqual({});
    expect(filter.id).toBe("__sin-acceso__");
  });
});

describe("auditoría de ediciones", () => {
  it("audita cuando el coordinador edita a un pasajero", () => {
    expect(editRequiresAudit(coordinator, "pax-ana")).toBe(true);
  });

  it("audita cuando el admin edita a un pasajero", () => {
    expect(editRequiresAudit(admin, "pax-ana")).toBe(true);
  });

  it("no audita cuando el pasajero edita lo suyo", () => {
    expect(editRequiresAudit(passenger, "pax-ana")).toBe(false);
  });

  it("audita si el coordinador edita a otro, aunque él también viaje", () => {
    expect(editRequiresAudit(coordinator, "pax-coord")).toBe(false);
    expect(editRequiresAudit(coordinator, "pax-beto")).toBe(true);
  });
});
