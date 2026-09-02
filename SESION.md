# Sesión

Le pertenece a este documento: el estado justo antes de la última pausa,
para retomar sin releer todo. Se **sobrescribe** al empezar cada sesión —
no es histórico. Está en otro lado: el porqué de las decisiones en
[README.md](README.md), la deuda técnica en [ESTADO.md](ESTADO.md), lo que
sigue en [TAREAS.md](TAREAS.md), el histórico de fases en
[PROGRESO.md](PROGRESO.md).

Última actualización: 2026-09-02.

---

## En qué se está trabajando

**Fase 8 — la seña.** Llena el hueco que dejó la fase 7 entre "interesada"
y "pasajera": un `DepositProof` que representa la seña *mientras es una
promesa* —antes de que exista `Passenger`, `PaymentPlan` o cuota alguna—
con revisión por la coordinadora y conversión atómica a pasajera + plan de
cuotas al confirmarla.

## Qué quedó sin commitear

```
M ESTADO.md
M prisma/schema.prisma
M src/app/[locale]/(coordinador)/viajes/[tripId]/interesadas/actions.ts
M src/app/[locale]/(coordinador)/viajes/[tripId]/interesadas/page.tsx
M src/app/[locale]/(coordinador)/viajes/[tripId]/presupuesto/page.tsx
M src/app/[locale]/(interesada)/mi-viaje/page.tsx
M src/app/[locale]/(pasajero)/mis-pagos/page.tsx
M src/components/budget/budget-wizard.tsx
M src/components/budget/step-prices.tsx
M src/components/budget/step-public.tsx
M src/components/budget/types.ts
M src/lib/auth/guards.ts
M src/lib/domain/calendar.ts
M src/lib/domain/payments.ts
M src/lib/services/interest.ts
M src/lib/services/passengers.ts
M src/lib/services/payments.ts
M src/lib/services/storage.ts
M src/lib/services/trip.ts
M src/lib/validation/interest.ts
M src/lib/validation/trip.ts
M src/messages/en.json
M src/messages/es.json
M tests/domain/calendar.test.ts
M tests/domain/payments.test.ts
?? prisma/migrations/20260831120000_fase8_sena/
?? src/app/[locale]/(coordinador)/viajes/[tripId]/interesadas/deposit-queue.tsx
?? src/app/[locale]/(interesada)/mi-viaje/actions.ts
?? src/app/api/senas/
?? src/components/interest/
?? src/lib/services/deposits.ts
?? src/lib/validation/deposit.ts
?? tests/integration/deposit-isolation.test.ts
?? tests/integration/deposits.test.ts
```

Además, el branch local tiene 2 commits que `origin/main` todavía no tiene
(`8623152` y `2ab3993`) — falta `git push`.

## Qué decisión está esperando respuesta del usuario

Ninguna decisión de producto. Sí hay algo para saldar con hechos antes de
seguir: el brief con el que arrancó esta sesión daba la fase 8 como "motor
y servicio terminados, pantallas sin empezar, con un cambio pendiente en
la regla de `acceptingInterest` para la subida de la seña". Lo que el
working tree tiene escrito contradice esa descripción: las dos pantallas
(`deposit-queue.tsx`, `deposit-form.tsx`) existen, están conectadas a sus
páginas, y la regla de `acceptingInterest` para la seña ya está
implementada y tiene tests dedicados
(`tests/integration/deposit-isolation.test.ts`, documentada como decisión
9 en [ESTADO.md](ESTADO.md)). No se tocó nada de esto para "resolver" la
contradicción — se deja anotada para que la próxima sesión la confirme
corriendo la suite, no leyendo un resumen.

## Próximo paso concreto

1. `npm run verify` sobre el working tree tal como está.
2. Si pasa: abrir las dos pantallas nuevas en el navegador (cola de
   depósitos del coordinador, formulario de seña de la interesada) y
   confirmar a mano que el flujo completo —subir comprobante, revisar,
   confirmar, conversión a pasajera— funciona de punta a punta.
3. Si todo eso cierra, commitear la fase 8 y recién ahí actualizar
   [PROGRESO.md](PROGRESO.md) con el commit real y las métricas de
   cierre (hoy esa sección dice explícitamente "en curso, sin
   commitear").
4. Seguir con lo que ya está anotado en [TAREAS.md](TAREAS.md).

## Cómo verificar que todo sigue verde

```bash
npm run verify
```

Corre i18n + capas + typecheck + lint + unitarios + integración. Tarda
~20-25 minutos, sobre todo por la suite de integración contra Supabase
real (ver [ESTADO §La suite de integración tarda 17 minutos](ESTADO.md#la-suite-de-integración-tarda-17-minutos)
— con los tests nuevos de esta fase, probablemente ahora tarde un poco
más que eso).
