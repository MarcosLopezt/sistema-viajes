# Sesión

Se sobrescribe al empezar cada sesión — no es histórico. Ruteo completo en
AGENTS.md.

Última actualización: 2026-09-02.

## En qué se está trabajando

Fase 8 — la seña (`DepositProof`): pago antes de que exista `Passenger` o
`PaymentPlan`, revisión por la coordinadora, conversión atómica a pasajera.

## Sin commitear

Motor, servicio, migración, ruta API y **las dos pantallas** de la fase 8,
ya escritas y conectadas — contradice lo que se asumía pendiente al
empezar esta sesión (ver TAREAS.md). Detalle: `git status --porcelain`.
2 commits locales sin pushear a `origin/main`.

## Esperando al usuario

Nada de producto. Falta correr `npm run verify` para confirmar que la
fase 8 cierra de verdad, en vez de confiar en el resumen previo.

## Próximo paso

1. `npm run verify`
2. Probar las 2 pantallas nuevas a mano
3. Commitear fase 8 → cerrar su entrada en PROGRESO.md
4. Seguir por TAREAS.md

## Verificar

`npm run verify` (~20-25 min — ver ESTADO.md)
