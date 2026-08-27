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
dev · build · test · check:db · check:i18n · check:layers · db:migrate ·
db:seed · verify (corre todo, incluida la suite de integración)

## Invariantes — no los violes ni los "mejores" sin avisar
- Autorización: ningún guard ni servicio acepta un identificador de
  identidad del cliente. Se deriva SIEMPRE de la sesión.
- Passenger y Person se tocan ÚNICAMENTE desde lib/services/passengers.ts,
  que aplica passengerVisibilityFilter(). Ninguna query por fuera.
  ÚNICA EXCEPCIÓN: lib/auth/passenger-bootstrap.ts, una sola función que
  resuelve el viewer y devuelve solo ids. Existe porque passengers.ts
  necesita un ViewerContext y armar el ViewerContext exige leer la tabla:
  es el corte de esa circularidad. Vive en su propio archivo para que la
  excepción sea verificable por archivo — el resto de guards.ts no puede
  tocar la tabla. Si algún día necesita devolver algo que no sea un id,
  dejó de ser bootstrap: rediscutila, no la amplíes.
- Dinero: decimal.js, nunca float. NO uses Prisma.Decimal en código que
  comparten cliente y servidor (arrastra node:process).
- El pg.Pool se construye en código con max: 1 y se cachea en globalThis.
  Los parámetros de la URL NO limitan nada con driver adapters.
- Cuota VENCIDA se DERIVA al leer (dueDate + pagos confirmados). No es
  un campo de estado que actualiza el cron.
- isPersonComplete() es el predicado único: alimenta el % de completitud
  y el gate a CONFIRMADO. Nunca dos implementaciones.
- Fechas: validar con isRealIsoDate() (lib/domain/date.ts). new Date()
  desborda en silencio: 31/02 se guarda como 02/03 sin avisar.
- i18n: cero strings hardcodeados. check:i18n tiene que pasar.
- Límites entre capas: los impone check:layers, no la prosa. Si tu cambio
  lo hace fallar, el problema es el cambio.

## Estructura
lib/domain/*     → funciones puras, sin Prisma, sin React. Testeadas.
lib/validation/* → schemas de zod. Importa domain; nunca al revés.
lib/services/*   → lógica + autorización. Acá viven los tests de permisos.
Server Actions, Route Handlers y páginas → cáscaras finas, sin lógica y
sin consultar la base. Importar funciones puras de domain SÍ se puede.
components/*     → ni Prisma ni servicios. Los datos bajan por props.

La frontera del cliente es por "use client", no por carpeta, y se verifica
siguiendo el grafo de importaciones: nada de lo que termina en el bundle
del navegador puede llegar a Prisma. `import type` está permitido en
todas las reglas — se borra en compilación. Detalle en README §Arquitectura.