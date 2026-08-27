<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Proyecto
Sistema de viajes grupales. Next.js 16 + Prisma 7 (@prisma/adapter-pg) +
Supabase + next-intl. Se trabaja POR FASES: parar al terminar cada una,
mostrar el resultado, no avanzar sin confirmación. No commitear sin pedido.

## Comandos
dev · build · test · check:db · check:i18n · db:migrate · db:seed

## Invariantes — no los violes ni los "mejores" sin avisar
- Autorización: ningún guard ni servicio acepta un identificador de
  identidad del cliente. Se deriva SIEMPRE de la sesión.
- Passenger y Person se tocan ÚNICAMENTE desde lib/services/passengers.ts,
  que aplica passengerVisibilityFilter(). Ninguna query por fuera.
- Dinero: decimal.js, nunca float. NO uses Prisma.Decimal en código que
  comparten cliente y servidor (arrastra node:process).
- El pg.Pool se construye en código con max: 1 y se cachea en globalThis.
  Los parámetros de la URL NO limitan nada con driver adapters.
- Cuota VENCIDA se DERIVA al leer (dueDate + pagos confirmados). No es
  un campo de estado que actualiza el cron.
- isPersonComplete() es el predicado único: alimenta el % de completitud
  y el gate a CONFIRMADO. Nunca dos implementaciones.
- Fechas: validar con isRealIsoDate(). new Date() desborda en silencio.
- i18n: cero strings hardcodeados. check:i18n tiene que pasar.

## Estructura
lib/domain/*   → funciones puras, sin Prisma, sin React. Testeadas.
lib/services/* → lógica + autorización. Acá viven los tests de permisos.
Server Actions y Route Handlers → cáscaras finas, sin lógica.