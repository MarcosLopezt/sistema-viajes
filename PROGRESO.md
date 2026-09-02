# Progreso

Le pertenece a este documento: la bitácora de lo construido, fase por fase,
en orden y append-only, con los commits reales y los hallazgos que importan.
Está en otro lado: el estado actual y la deuda pendiente en
[ESTADO.md](ESTADO.md), el detalle de arquitectura y de cada decisión en
[README.md](README.md), qué sigue en [TAREAS.md](TAREAS.md).

Los commits y las fechas de esta bitácora salen de `git log`, no de memoria.

---

## Fase 1 — Fundaciones (2026-08-25)

**Commit:** [`f9e17db`](https://github.com/MarcosLopezt/sistema-viajes/commit/f9e17db) — *Fase 1: fundaciones del sistema de viajes grupales*

Setup del proyecto (Next.js 16, TypeScript estricto, Tailwind v4, shadcn
re-themeado, Vitest), el modelo de datos completo (20 modelos, 15 enums,
con las seis decisiones de diseño que se documentan en README), la capa de
autorización (`policy.ts` puro + `guards.ts`), i18n con verificación de
paridad, la capa de mail con sus dos adaptadores, seeds con un viaje de
ejemplo y el workflow de backup semanal cifrado.

**Hallazgo:** el pooling de conexiones con Prisma 7. Los parámetros
`?pgbouncer=true&connection_limit=1` de la connection string eran
directivas del motor de consultas propio de Prisma; con Prisma 7 hablando a
Postgres a través del driver `pg`, esos parámetros quedan inertes y el
pool cae en el default de `pg`: 10 conexiones por instancia. La solución
fue poner el límite explícito en código (`max: 1`, pool cacheado en
`globalThis`), verificable con `npm run check:db`. Detalle en
[README §El límite de conexiones va en código, no en la URL](README.md#el-límite-de-conexiones-va-en-código-no-en-la-url-️).

**Métricas de cierre:** 73 tests, incluida la matriz de permisos completa
con el aislamiento entre pasajeros.

---

## Fase 2 — Motor de cálculo y wizard de presupuesto (2026-08-25)

**Commit:** [`4f71ba4`](https://github.com/MarcosLopezt/sistema-viajes/commit/4f71ba4) — *Fase 2: motor de calculo y wizard de presupuesto*

Motor puro (`pricing.ts`): costos directos por base, prorrateo de
indirectos con `ROUND_UP`, residuo de redondeo devuelto explícito, margen
por pasajero y margen total con `basis` obligatorio. Corre igual en
servidor y en el navegador —el panel de costo en vivo del wizard usa el
mismo código—, lo que forzó a `money.ts` a usar `decimal.js` directo en
vez de `Prisma.Decimal` (que arrastra `node:process` y rompería en un
Client Component). Servicio de cotizaciones con cache diario y
degradación a la última cotización guardada. Capa de servicios
(`trip.ts`, `passengers.ts`, `audit.ts`) con autorización por
`requireTripRole`. Wizard de 5 pasos con autoguardado.

**Hallazgo:** los montos se auditaban comparando texto, no valor —
`"4100.00"` y `"4100"` son el mismo número pero cadenas distintas, así que
cada guardado sin tocar nada registraba un cambio de precio falso en el
`AuditLog`. Lo encontró un test. Se corrigió con `auditMoney()`, que
compara en forma canónica.

**Métricas de cierre:** 127 tests unitarios y 44 de integración contra la
base real.

---

## Fase 3 — Pasajeros e invitaciones (2026-08-26)

**Commit:** [`f35e148`](https://github.com/MarcosLopezt/sistema-viajes/commit/f35e148) — *Fase 3: pasajeros e invitaciones*

Invitaciones con token de 256 bits hasheado con SHA-256, vencimiento de 14
días, un solo uso, revocación al reenviar. Registro del pasajero en 3
pasos con autoguardado, con **dos schemas Zod separados a propósito**:
`personDraftSchema` (nunca rechaza, solo recorta) para el autoguardado, y
`personStrictSchema` (exige todo lo obligatorio) para el paso final —
usar el estricto en el autoguardado habría hecho que un error de tipeo
tirara silenciosamente los datos de todo el paso. Subida de archivos
directa al bucket con compresión en cliente y validación del objeto real
en el servidor. Habitaciones con tope de dos por `Room`, validado en
transacción.

**Hallazgo:** `new Date("2032-02-31")` no falla — JavaScript la desborda
en silencio al 2 de marzo. Aplicado a un vencimiento de pasaporte, eso
significa guardar una fecha distinta a la que la persona tipeó, y esa
fecha decide si puede viajar. Lo encontró un test. Se agregó
`isRealIsoDate()` (hoy en `lib/domain/date.ts`) y se aplicó a los dos
schemas.

**Métricas de cierre:** 148 tests unitarios (21 nuevos) y 81 de
integración (37 nuevos).

---

## Fase 4 — Pagos (2026-08-27)

**Commits:** [`59e573b`](https://github.com/MarcosLopezt/sistema-viajes/commit/59e573b) — *Fase 4: pagos* ·
[`5ad48fa`](https://github.com/MarcosLopezt/sistema-viajes/commit/5ad48fa) — *Zona horaria de referencia,
procedencia del TC y esperado del viaje*

(Entre la fase 3 y esta, el commit [`b3b633d`](https://github.com/MarcosLopezt/sistema-viajes/commit/b3b633d)
agregó las instrucciones del proyecto en AGENTS.md.)

El cambio central de esta fase: `Installment` deja de tener columna de
estado. `PAGADA` / `VENCIDA` / `EN_REVISION` / `PENDIENTE` se derivan al
leer, en `derivePlan()`, a partir del vencimiento y de los pagos
confirmados — un campo persistido dependería de que el cron lo hubiera
actualizado, y la ventana de disparo de Vercel Cron es de ~1 hora.
Reparto en cuotas con la última absorbiendo el redondeo. Confirmación
idempotente en la base con un `UPDATE` condicionado al estado anterior.
Reversión de una confirmación con motivo obligatorio. Pagos parciales con
tolerancia configurable y excedente como crédito sin imputación
automática.

**Hallazgos:**

- **La limpieza del seed no era idempotente.** Borraba las filas de
  `Person`, pero `User.personId` tiene `onDelete: SetNull`, así que las
  filas de `User` sobrevivían — y la siembra siguiente moría por email
  duplicado.
- **Los vencimientos comparaban un día contra un instante.**
  `derivePlan()` comparaba `dueDate` contra `new Date()`; en Vercel el
  proceso corre en UTC, así que a las 22:00 del 26 de agosto en Buenos
  Aires, ya era el 27 en UTC — la cuota del 26 aparecía vencida tres
  horas antes de que terminara el día del pasajero. La solución no fue
  sumar horas: fue dejar de trabajar con instantes. Nuevo
  `Trip.timezone` y `lib/domain/calendar.ts` con el tipo `CalendarDate`
  (`"2026-08-26"`, un día sin hora); `derivePlan()` y
  `suggestDueDates()` dejaron de aceptar `Date`. Ver
  [ESTADO §4 `CalendarDate` es un tipo propio](ESTADO.md#4-calendardate-es-un-tipo-propio-y-deriveplan-no-acepta-date).

**Métricas de cierre:** 301 tests unitarios (23 nuevos, de calendario) y
123 de integración. (El commit central, antes del ajuste de zona horaria,
había cerrado en 278 unitarios y 116 de integración.)

---

## Fase 5 — Comunicaciones y automatización (2026-08-27)

**Commit:** [`dd26a5f`](https://github.com/MarcosLopezt/sistema-viajes/commit/dd26a5f) — *Fase 5: comunicaciones y automatización*

Endpoint `POST /api/cron/daily` protegido con `CRON_SECRET` comparado en
tiempo constante — sin el secreto configurado, el endpoint se **cierra**,
no se abre. Cinco tareas aisladas en su propio `try/catch`, cada una
devolviendo `remaining: true` si se quedó sin presupuesto de tiempo.
Idempotencia por índice único **y** por el orden de las operaciones:
se inserta la marca de envío, después se manda el mail, y si el envío
falla se borra la marca para reintentar. Seis plantillas en es/en con
HTML de tablas y estilos inline (los clientes de mail no son
navegadores). Envío masivo materializado en una fila de
`CommunicationRecipient` por destinatario, para no depender de que un
`for` dentro de un request de ~10s termine.

**Hallazgo:** `listPassengersForSystemJob()`, la única función de
`passengers.ts` sin `viewer` — el cron no tiene sesión. En vez de
inventar un actor "de sistema" en la matriz de permisos (que después
alguien reutilizaría desde una pantalla), se aisló en su propio nombre
explícito, con un único llamador legítimo: el endpoint de cron,
autenticado antes de tocar nada.

**Métricas de cierre:** 374 tests unitarios (73 nuevos: calendario y
plantillas) y 152 de integración (29 nuevos: cron y comunicaciones).

---

## Fase 6 — Cierre (2026-08-27)

**Commits:** [`6590c23`](https://github.com/MarcosLopezt/sistema-viajes/commit/6590c23) — *Fase 6: cierre* ·
[`b97a7fb`](https://github.com/MarcosLopezt/sistema-viajes/commit/b97a7fb) — *ESTADO.md y el vencimiento de cuota
en 16px* · [`03d6b66`](https://github.com/MarcosLopezt/sistema-viajes/commit/03d6b66) — *Restauración completa
probada: la última pieza sin verificar*

Exportaciones a Excel con un escritor de `.xlsx` propio y sin
dependencias (`lib/domain/xlsx.ts` — un `.xlsx` es un ZIP con unos pocos
XML, y comprimir habría exigido `node:zlib`, lo que lo hubiera vuelto
código de servidor). Backup completo: al `pg_dump` del schema `public` se
le suman las cuentas de Supabase Auth y los objetos del Storage, todo en
un artifact cifrado con AES-256. Panel de administración con `AuditLog`
filtrable. Límites entre capas verificados por `scripts/check-layers.ts`
dentro de `npm run verify`, en vez de por prosa en un README.

**Hallazgos:**

- **`getMedicalFilePath()` era código muerto.** No tenía un solo llamador
  desde que nació en la fase 3. Se encontró al reunir bajo
  `passengers.ts` los nueve accesos a `Passenger`/`Person` que habían
  quedado dispersos por fuera del invariante — seis se movieron, dos
  pasaron a ser la excepción de bootstrap, y este se borró en vez de
  mudarse: mover código muerto solo lo reubica.
- **`list()` del Storage no es recursivo y pagina de a 100.** Como el
  bucket está organizado en `tripId/passengerId/archivo`, el nivel raíz
  son carpetas: una implementación de backup ingenua se habría llevado
  los primeros 100 nombres de carpeta, cero archivos, y habría
  terminado en verde.
- **La restauración completa del backup, probada de punta a punta**
  contra un Postgres 17 en Docker (commit `03d6b66`, unos días después
  del cierre): 22 tablas, 0 errores, y los hashes de contraseña de
  `auth.users` idénticos entre origen y destino (mismo `md5()`
  concatenado). Dejó al descubierto que un Postgres pelado no tiene el
  schema `auth` — lo crea Supabase — así que el procedimiento documentado
  solo aplica contra un proyecto Supabase real.

**Métricas de cierre:** 372 tests unitarios (27 nuevos: xlsx y formato con
huso) y 165 de integración (12 nuevos, de exportaciones).

---

## Fase 7 — La interesada y la zona pública (2026-08-30)

**Commits:** [`33b8aa0`](https://github.com/MarcosLopezt/sistema-viajes/commit/33b8aa0) — *La convención de paths
del bucket, en una función pura* (preparación) ·
[`f01e542`](https://github.com/MarcosLopezt/sistema-viajes/commit/f01e542) — *Fase 7: la interesada y la zona
pública* · [`5bdf971`](https://github.com/MarcosLopezt/sistema-viajes/commit/5bdf971) — *Repaso a 375px de la zona
pública, y «qué sigue» en los dos lugares* ·
[`2ab3993`](https://github.com/MarcosLopezt/sistema-viajes/commit/2ab3993) — *pickLocalized cae en las dos
direcciones, y ahora el comentario lo dice*

La primera fase que cambia el **alcance** del sistema y no solo lo
completa: aparece un actor nuevo, la interesada, y una zona pública sin
sesión (`/interes`, destino del botón de Wix). El aislamiento se resuelve
con una **ausencia**, no con código nuevo: una interesada no tiene
`TripMember`, así que todos los guards que ya existían (`can()`,
`requireTripRole()`, `passengerVisibilityFilter()`) le dicen que no sin
una sola regla agregada. Los datos personales van a `Person` desde el
registro, así que convertir a alguien en pasajera es crear el `Passenger`
y nada más — no se copia ni un campo. Un solo viaje puede estar
`acceptingInterest` a la vez, garantizado por un índice único **parcial**
de Postgres que Prisma no sabe expresar (queda fuera de `schema.prisma`
a propósito). Los textos de marca pasan a ser dato editable en `Trip`.

**Hallazgos**, los cuatro encontrados y corregidos durante la
construcción:

- `/mi-viaje` sin sesión daba 500 en vez de redirigir.
- La `Person` del registro se creaba **fuera** de la transacción.
- La conversión de fechas del editor comparaba contra un solo nombre de
  campo.
- El registro reusaba un código de error que mandaba al login a alguien
  que no tenía cuenta.

Y dos correcciones post-cierre, ya con la fase cerrada: un link de
"iniciá sesión" que medía ~24px de alto en vez de los 44px mínimos
(commit `5bdf971`), y `pickLocalized()` cayendo también al inglés cuando
falta el español, documentado con un test propio en vez de solo cubierto
de refilón (commit `2ab3993`).

**Métricas de cierre:** 407 tests unitarios y 211 de integración (36
nuevos de integración, 18 nuevos unitarios), con la mutación verificada
en los dos hallazgos que más importaban: darle un `TripMember` a una
interesada hace fallar seis tests, y filtrar un dato de salud mental a
una planilla hace fallar dos. Tras los dos commits de repaso posteriores,
408 unitarios y 212 de integración.

---

## Fase 8 — La seña (en curso, sin commitear)

Todavía no tiene un commit de cierre — por eso esta entrada no tiene los
datos habituales de "métricas de cierre" y se va a completar cuando la
fase termine.

**Lo que ya avanzó, commiteado:**
[`8623152`](https://github.com/MarcosLopezt/sistema-viajes/commit/8623152) — *La carpeta del bucket es de la
Person, no del Passenger*. Cambia la convención de paths del bucket de
`{tripId}/{passengerId}/` a `{tripId}/{personId}/`, la pieza que le
faltaba a la fase 8 para que una interesada pueda subir el comprobante de
la seña antes de tener un `Passenger`. Migró 7 objetos reales del bucket
con un script reanudable e idempotente (copia → escribe la fila → borra
el original — nunca `move`, para que ningún estado intermedio deje una
fila apuntando a un objeto que no existe).

**Lo que está en el working tree sin commitear:** la migración
`20260831120000_fase8_sena` (modelo `DepositProof` — la seña *mientras es
una promesa*, antes de que exista el `Passenger`, el `PaymentPlan` o
siquiera la cuota a la que se va a imputar; un segundo índice único
parcial, "como máximo una seña vigente por interesada"), el servicio
`lib/services/deposits.ts`, la validación, la ruta
`/api/senas/[depositId]`, y —según lo que muestra el propio código, no
según lo que se venía asumiendo al empezar esta sesión— también las dos
pantallas: la cola de depósitos del coordinador y el formulario de seña
de la interesada, ambas ya conectadas a sus páginas.

**Hallazgo (documentado en ESTADO.md, ver el detalle ahí):**
`confirmDepositAndConvert` abre su transacción con `maxWait: 15_000`
—muy por encima del default de Prisma (2s)— porque el pool es de **una
sola conexión** por instancia: dos confirmaciones concurrentes de la
misma instancia no se solapan, se turnan, y con el `maxWait` default la
segunda agota su espera antes de que la primera suelte la conexión. Sin
esto, una coordinadora haciendo doble click recibiría un error de
infraestructura sin relación aparente con lo que hizo. Ver
[ESTADO §8 `maxWait: 15_000`](ESTADO.md#8-maxwait-15_000-al-confirmar-una-seña-no-es-un-número-al-azar).

Estado real y próximo paso: [SESION.md](SESION.md).
