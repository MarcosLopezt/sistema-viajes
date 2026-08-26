# Sistema de viajes grupales

Aplicación para organizar viajes grupales cerrados (14 pasajeros + 2 coordinadores): armado del presupuesto, alta y autogestión de pasajeros, cobro y seguimiento de pagos, y comunicaciones por mail.

**Estado: Fase 3 (pasajeros e invitaciones) terminada.** Ver [Qué hay hecho](#qué-hay-hecho-y-qué-no).

---

## Stack

| Pieza | Elección |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript estricto |
| Base de datos | PostgreSQL en Supabase · Prisma 7 con adapter `pg` |
| Auth | Supabase Auth (email + contraseña) · roles en tabla propia |
| Storage | Supabase Storage, bucket privado, solo signed URLs |
| Estilos | Tailwind v4 + shadcn/ui (re-themeado, ver [UX](#decisiones-de-ux-que-están-en-el-código)) |
| i18n | next-intl · `es` (default) y `en` |
| Mail | Interfaz `EmailProvider` · adaptadores `console` y `brevo` |
| Tests | Vitest |
| Deploy | Vercel · cron por Vercel Cron |

---

## Setup desde cero

### 1. Requisitos

- Node.js 22 o superior
- Una cuenta de [Supabase](https://supabase.com) (free tier alcanza)
- Opcional para mandar mails de verdad: una cuenta de [Brevo](https://www.brevo.com) (free tier: 300 mails/día)

### 2. Clonar e instalar

```bash
git clone <url-del-repo>
cd sistema-viajes
npm install
```

`npm install` dispara `prisma generate`, que crea el cliente en `src/generated/prisma`. Ese directorio **no se versiona**: se regenera siempre desde el schema.

### 3. Crear el proyecto en Supabase

1. Creá un proyecto nuevo. Guardá la contraseña de la base: se muestra una sola vez.
2. **Storage** → creá un bucket llamado `documentos` y dejalo **privado** (sin acceso público). Ahí van los comprobantes de pago y los certificados de cobertura médica.
3. **Project Settings → API** → copiá `Project URL`, la `anon key` y la `service_role key`.
4. **Project Settings → Database → Connection string** → copiá las dos variantes (ver abajo por qué hacen falta las dos).

### 4. Variables de entorno

```bash
cp .env.example .env
```

Completá `.env` con los valores del paso anterior. Cada variable está documentada en `.env.example`.

Para generar el `CRON_SECRET`:

```bash
openssl rand -base64 32
```

### 5. Crear las tablas y cargar datos de ejemplo

```bash
npm run db:migrate    # crea el schema en Supabase
npm run db:seed       # carga el viaje de ejemplo
```

### 6. Arrancar

```bash
npm run dev
```

Abrí <http://localhost:3000>. Redirige a `/es` y de ahí al login.

### 7. Verificar que está todo bien

```bash
npm run verify
```

Corre, en orden: paridad de traducciones, typecheck, lint y tests. Es lo mismo que conviene correr antes de cada commit.

---

## Usuarios de ejemplo

El seed crea estos usuarios. Si `SUPABASE_SERVICE_ROLE_KEY` está configurada, también los crea en Supabase Auth y se puede iniciar sesión con ellos.

| Email | Rol | Para qué sirve |
|---|---|---|
| `admin@ejemplo.test` | ADMIN | Ve todos los viajes y el panel de administración |
| `coordinador@ejemplo.test` | Coordinador | Panel del viaje de ejemplo |
| `ana@ejemplo.test` | Pasajera | Datos completos, pasaporte 🟢, plan de 3 cuotas (una pagada, una vencida, una pendiente) |
| `beto@ejemplo.test` | Pasajero | Pasaporte 🟡 (vence dentro de los 3 meses posteriores), pago en revisión, interfaz en inglés |
| `carla@ejemplo.test` | Pasajera | Pasaporte 🔴: el sistema **no** deja confirmarla |
| `diego@ejemplo.test` | Pasajero | Datos a medio cargar: sirve para ver el % de completitud |

Contraseña de todos: `viajes-demo-2026`. **Solo para desarrollo.**

---

## Base de datos

### Por qué hay dos connection strings

Supabase expone dos y las dos hacen falta:

| Variable | Puerto | Quién la usa |
|---|---|---|
| `DATABASE_URL` | 6543 · transaction pooler | La app en runtime |
| `DIRECT_URL` | 5432 · session pooler | `prisma migrate`, `prisma db seed`, `pg_dump` |

Las migraciones tienen que ir por `DIRECT_URL`: contra el transaction pooler fallan con errores crípticos sobre prepared statements, y `pg_dump` directamente no funciona.

`prisma7.config.ts` (que lee solo el CLI) usa `DIRECT_URL`. `src/lib/db/prisma.ts` (runtime) usa `DATABASE_URL`.

### El límite de conexiones va en código, no en la URL ⚠️

Esto cambió con Prisma 7 y **no es evidente**.

Los parámetros `?pgbouncer=true&connection_limit=1` eran directivas del motor de consultas propio de Prisma. Prisma 7 lo eliminó: ahora habla con Postgres a través del driver `pg`, y **`pg` no conoce esos parámetros**. `pg-connection-string` los parsea como propiedades sueltas sin significado y los ignora:

```
pg-connection-string ve: { pgbouncer: "true", connection_limit: "1", host: …, port: "6543" }
pg.Pool.options.max     → 10   ← el default de pg, NO el 1 de la URL
```

Diez conexiones **por instancia**. En Vercel, con varias lambdas concurrentes, eso agota el cupo del free tier de Supabase. El síntoma aparece solo bajo concurrencia y es intermitente, que es la peor forma de enterarse.

Por eso [`src/lib/db/prisma.ts`](src/lib/db/prisma.ts) construye un `pg.Pool` explícito:

- **`max: 1`**, en código. El pooler de Supabase ya multiplexa del otro lado: abrir más conexiones desde la app no da paralelismo, solo consume cupo.
- **El pool y el cliente se cachean en `globalThis`.** Nunca se crea un pool por request. Sirve para dos cosas a la vez: el hot reload de Next en desarrollo y el reuso entre invocaciones de una lambda tibia en producción.
- **Al adapter se le pasa el `Pool` ya construido**, no un `connectionString`. Si se le pasara la URL, `PrismaPg` armaría su propio pool con los defaults y perderíamos el `max: 1`.
- `idleTimeoutMillis: 10s` (el pooler corta las ociosas por su cuenta), `connectionTimeoutMillis: 10s` (para fallar con un error accionable en vez de colgarse) y `allowExitOnIdle` (para que el seed y el cron terminen).

Para comprobarlo en cualquier momento:

```bash
npm run check:db
```

Verifica los puertos, demuestra que `pg` ignora el `connection_limit` de la URL, y lanza 25 consultas en paralelo confirmando que se abre **una sola** conexión.

> **Contrapartida medida:** con `max: 1` las consultas concurrentes dentro de un mismo request se serializan. Cinco `count()` en `Promise.all` tardan ~2,4 s contra Supabase en lugar de ~500 ms. Es el precio de no agotar el cupo y, para este volumen (14 pasajeros), está bien pagado. Si alguna pantalla llegara a sentirse lenta, subir `max` a 3 es la primera perilla: el transaction pooler admite muchas más conexiones de cliente de las que multiplexa contra Postgres, así que es seguro. El panel de costo en vivo del wizard no toca la base (calcula con funciones puras en el cliente), así que no lo afecta.

### Comandos

```bash
npm run db:migrate     # crear y aplicar una migración en desarrollo
npm run db:deploy      # aplicar migraciones en producción
npm run db:seed        # cargar datos de ejemplo (borra y recrea el viaje demo)
npm run db:studio      # explorador visual de la base
npm run db:reset       # ⚠️ borra TODO y vuelve a migrar + seed
```

### Si Supabase pausa el proyecto por inactividad

El free tier **pausa los proyectos tras ~7 días sin actividad**. Cuando pasa, la app deja de conectar.

Para despausarlo:

1. Entrá a <https://supabase.com/dashboard>.
2. El proyecto aparece con el cartel *Paused*. Tocá **Restore project**.
3. Tarda unos minutos. Los datos **no se pierden** al pausarse.

Para que no vuelva a pasar, el cron diario (fase 5) hace una consulta trivial a la base que cuenta como actividad. Mientras el cron no exista, alcanza con abrir la app o el Studio una vez por semana.

---

## Backups

El free tier de Supabase **no hace backups automáticos**. El workflow [`.github/workflows/backup.yml`](.github/workflows/backup.yml) corre todos los domingos, hace un `pg_dump` del schema `public`, lo comprime y lo cifra con AES-256.

### Configuración

En **Settings → Secrets and variables → Actions** del repositorio, creá:

| Secreto | Valor |
|---|---|
| `BACKUP_DATABASE_URL` | La connection string **directa** (puerto 5432). `pg_dump` no funciona contra el pooler. |
| `BACKUP_PASSPHRASE` | Una frase larga para cifrar el dump. **Guardala también fuera de GitHub**: sin ella el backup es irrecuperable. |

> ⚠️ Los workflows programados de GitHub **se desactivan solos tras 60 días sin actividad en el repositorio**. GitHub avisa por mail antes; alcanza con volver a habilitarlo desde la pestaña Actions. Es exactamente por eso que el cron diario de la aplicación va por Vercel Cron y no por GitHub Actions.

### Cómo restaurar

Este procedimiento está **probado**, no supuesto: ver [Prueba de restauración](#prueba-de-restauración) abajo.

1. Descargá el artifact desde la pestaña **Actions** → la corrida que te interese → *Artifacts*.

2. Descifralo y descomprimilo:

   ```bash
   gpg --batch --decrypt --passphrase "<BACKUP_PASSPHRASE>" \
       --output backup.sql.gz backup-2026-08-23.sql.gz.gpg
   gunzip backup.sql.gz
   ```

3. **Sacá el schema `public` del destino antes de restaurar.**

   ```bash
   psql "<connection-string-directa-del-destino>" -c 'DROP SCHEMA IF EXISTS public CASCADE'
   ```

   > ⚠️ Este paso no es opcional y es fácil de pasar por alto. El dump incluye
   > su propio `CREATE SCHEMA public` (porque en Supabase ese schema pertenece a
   > un rol propio). Contra una base nueva —que ya trae un `public` vacío— la
   > restauración aborta con `ERROR: schema "public" already exists`. Corriendo
   > `psql` sin `ON_ERROR_STOP=1` el error pasa desapercibido y la restauración
   > queda a medias, que es peor.

4. Restaurá:

   ```bash
   psql "<connection-string-directa-del-destino>" -v ON_ERROR_STOP=1 -f backup.sql
   ```

   `ON_ERROR_STOP=1` es a propósito: preferís que falle ruidosamente a que te
   deje una base incompleta.

### ⚠️ Deuda conocida: el backup está incompleto

Anotado para la fase 6. Hoy el backup cubre **solo el schema `public`**, y eso deja dos huecos:

| Falta | Consecuencia al restaurar |
|---|---|
| Los usuarios de **Supabase Auth** (schema `auth`) | La base queda íntegra pero **nadie puede iniciar sesión**. |
| Los archivos del **Storage** | Los `medicalAssuranceFileId` y `proofFileId` apuntan a objetos que no existen. |

Es decir: restaurar hoy da una base correcta e inutilizable. Los datos de viajes, pasajeros y pagos sí están completos.

**Mitigación provisional**, si hubiera que reconstruir el proyecto desde cero antes de la fase 6:

1. Restaurar el dump (procedimiento de arriba).
2. Recrear los usuarios de Auth con la API de administración, tomando los `User.id` y `User.email` de la base restaurada — es lo mismo que hace `ensureAuthUser` en `prisma/seed.ts`. Los ids tienen que coincidir: son la clave que une `auth.users` con `public.User`.
3. Avisarle a cada persona que entre por «Olvidé mi contraseña».
4. Los archivos se pierden. Habría que volver a pedirlos.

Lo que falta construir en la fase 6: agregar al workflow un volcado de `auth.users` (los campos mínimos: id, email, confirmación) y una sincronización del bucket, ambos dentro del mismo artifact cifrado.

### Prueba de restauración

Se probó el ciclo completo contra un Postgres 17 local en Docker, con los mismos flags que usa el workflow:

```
pg_dump (Supabase, puerto 5432)  →  44.522 bytes
gzip -9 + gpg AES256             →   8.297 bytes  (sin texto plano legible)
gpg -d + gunzip                  →  44.522 bytes  (idéntico al original)
psql -v ON_ERROR_STOP=1          →  sin errores
```

Verificado en la base restaurada: 21 tablas, 15 enums, 25 foreign keys, 52 índices, y las filas coincidiendo una a una con el origen. Los `Decimal` conservan la escala (`3990.00`, `1330.00`), las fechas y los enums quedan intactos, y los acentos también (`Londres, París y Roma`).

Conviene repetirlo cada tanto: un backup que nunca se restauró es una hipótesis, no un backup.

---

## Decisiones de modelado

Las seis que definieron el schema, acordadas antes de escribir código.

### 1. `budgetedPassengers` cuenta solo pasajeros facturables

Los indirectos se dividen por ese número, que **excluye a los coordinadores**. Con 14 pasajeros + 2 coordinadores el divisor es 14, no 16: si fuera 16 y a los coordinadores no se les factura, no se recuperaría el costo.

Tampoco se divide por los confirmados: si el divisor cambiara con cada alta, el precio se movería cada vez que entra alguien.

### 2. El coordinador no computa costo directo ni recibe plan de pagos

Un `Passenger` con `isCoordinator = true` carga sus datos como cualquiera, pero no se le imputa costo directo ni se le genera `PaymentPlan`. Su alojamiento va como `IndirectCost` de tipo `HOSPEDAJE_COORDINADOR`. Si estuviera en los dos lados se contaría dos veces.

### 3. El precio final es por pasajero

`Trip.priceDouble` / `priceSingle` son el precio de lista. `Passenger.priceOverride` lo pisa caso por caso, con `priceOverrideReason` para dejar registro.

Sin esto no se puede implementar la regla del single sin compañero: si "la decisión es del coordinador", esa decisión es cobrarle distinto que al resto, y un precio único a nivel viaje no puede expresarlo.

### 4. `Room` en vez de `roommateId`

Un `roommateId` unidireccional se corrompe en silencio (A apunta a B, B apunta a C) y no sirve para armar el rooming list del hotel. Una entidad `Room` con 1 o 2 pasajeros es imposible de inconsistir y es lo que se exporta.

### 5. Autorización en dos niveles

- `User.role` global: `ADMIN` | `USER`
- `TripMember.role` por viaje: `COORDINADOR` | `PASAJERO`

COORDINADOR es naturalmente un rol *por viaje*: quien coordina el viaje A no debería ver los costos del viaje B, y alguien puede coordinar uno y viajar como pasajero en otro. Un rol global no expresa nada de eso.

`TripMember` es la fuente de verdad de la autorización; `Passenger` es el registro de dominio. Un coordinador de oficina que no viaja tiene `TripMember` y no tiene `Passenger`.

### 6. Los reembolsos no alteran cuotas

`Payment.kind` distingue `PAGO` de `REEMBOLSO`. Los reembolsos cuelgan del `PaymentPlan` con `installmentId` nulo.

Si colgaran de una cuota, un monto negativo bajaría la suma imputada y la cuota se "des-pagaría" sola. Además, si el pasajero canceló habiendo pagado tres cuotas, no hay una cuota a la que asociar el reembolso.

### Entidades agregadas al modelo original

| Entidad | Por qué |
|---|---|
| `TripMember` | Ver decisión 5. |
| `Room` | Ver decisión 4. |
| `SentReminder` | Sin un `@@unique([installmentId, offsetDays])` no se puede cumplir "nunca más de un recordatorio del mismo tipo por cuota". Es lo que hace idempotente al cron. |
| `CommunicationRecipient` | Reemplaza al `recipientIds[]` del diseño original. El envío masivo no puede ser un `for` dentro de un request (Vercel Hobby corta a los ~10 s, Brevo permite 300/día): se encola una fila por destinatario y el cron las procesa por lotes. De paso queda trazabilidad de quién recibió qué. |
| `RateLimitHit` | El rate limiting tiene que vivir en la base: en Vercel cada request puede caer en una instancia distinta, así que un contador en memoria no limita nada. Ver la nota sobre su purga abajo. |

#### `RateLimitHit`: la tabla que crece sola

Es la única tabla que escribe **tráfico no autenticado** (cada intento de login, de recuperación de contraseña y de canje de invitación inserta una fila). Sin purga crece indefinidamente.

Índices, ambos ya aplicados en la base:

| Índice | Para qué |
|---|---|
| `(keyHash, createdAt)` | La consulta de conteo dentro de la ventana. Es la que corre en cada intento. |
| `(createdAt)` | La purga por antigüedad. |

Se guarda el **SHA-256** de `acción + identificador`, no el identificador en claro: la clave incluye el email o la IP, y esos son datos personales. Con el hash alcanza para contar intentos.

**La purga va en el cron diario de la fase 5.** La función ya está escrita —`purgeExpiredRateLimitHits()` en [`src/lib/auth/rate-limit.ts`](src/lib/auth/rate-limit.ts)— y borra todo lo anterior a la ventana más larga configurada; solo falta el endpoint que la llame. Mientras el cron no exista, la tabla crece: con el volumen de este sistema no es un problema a corto plazo, pero no hay que olvidarlo.

### Otras decisiones que quedaron en el código

**Prorrateo de indirectos: `ROUND_UP` al centavo.** `Σ(indirectos) / budgetedPassengers` casi nunca da exacto. Redondear hacia arriba garantiza que lo prorrateado nunca sume menos que el costo real. El residuo (centavos) queda a favor del viaje y nunca llega al pasajero, porque el coordinador fija el precio final a mano. Ver `perPassengerShare()` en [`src/lib/domain/money.ts`](src/lib/domain/money.ts).

**Los campos de `Person` son nullable en la base aunque sean obligatorios de negocio.** El formulario del pasajero son 3 pasos con autoguardado: una fila a medio completar tiene que poder persistirse. La obligatoriedad se valida con `isPersonComplete()`, que es *la misma función* que alimenta el % de completitud y el gate de confirmación — si fueran dos definiciones distintas divergirían, y el pasajero vería 100% mientras el coordinador no puede confirmarlo.

**El certificado de cobertura médica (`medicalAssuranceFileId`) es obligatorio** y bloquea el pase a `CONFIRMADO`.

**Los tokens de invitación se guardan hasheados** (`Invitation.tokenHash`, SHA-256). Si se filtrara la base, los links seguirían sin poder canjearse.

**No se usa RLS de Postgres.** Prisma corre con la service role y la bypassearía. Tener las reglas duplicadas en policies SQL *y* en código es peor que tenerlas en un solo lugar bien testeado: cuando divergen, ninguna de las dos es la verdad. La única capa de autorización es [`src/lib/auth/policy.ts`](src/lib/auth/policy.ts), y tiene tests exhaustivos.

**`exactOptionalPropertyTypes` está desactivado.** Se probó, pero choca con los componentes que genera shadcn (`dropdown-menu`, entre otros) y habría que parchear cada componente nuevo que agreguemos. `noUncheckedIndexedAccess` y `noImplicitOverride` sí están activos.

---

## El motor de cálculo

Vive en [`src/lib/domain/pricing.ts`](src/lib/domain/pricing.ts). No importa Prisma, ni React, ni nada de Node: recibe estructuras planas y devuelve `Decimal`.

Que sea así no es purismo. Corre **en los dos lados**: el servidor lo usa para persistir y el navegador para el panel de costo en vivo del wizard. Al ser el mismo código, servidor y cliente no pueden dar números distintos. (Por eso `money.ts` usa `decimal.js` directamente y no `Prisma.Decimal`: el cliente generado de Prisma importa `node:process`, y con esa dependencia no se podría importar desde un Client Component.)

```
directDouble  = Σ(noches × precioNocheDoble)  + Σ(costoDirectoPorPasajero)
directSingle  = Σ(noches × precioNocheSingle) + Σ(costoDirectoPorPasajero)
indirectPerPassenger = ROUND_UP( Σ(indirectos) / budgetedPassengers )
totalDouble   = directDouble + indirectPerPassenger
totalSingle   = directSingle + indirectPerPassenger
roundingResidue = indirectPerPassenger × budgetedPassengers − Σ(indirectos)
```

`roundingResidue` se devuelve explícito y se muestra en el panel. Es plata que el presupuesto recauda de más por el redondeo hacia arriba, y quien fija el precio tiene derecho a verla.

### El margen total nunca es un número suelto

El margen **por pasajero** es directo: precio − costo, para doble y para single.

El margen **total** depende del mix single/doble, y hasta que no haya confirmados ese mix no se conoce. Entonces:

- **Con pasajeros CONFIRMADOS** → un solo total, calculado con la distribución real, y `basis` dice cuántos van en cada base.
- **Sin confirmados** → dos escenarios, «todos en compartida» y «todos en individual», cada uno declarando sobre qué está calculado.

Todo `TotalMargin` lleva su `basis` obligatoriamente. No existe forma de obtener un total sin saber de qué mix salió: «£6.800 de margen» no significa nada si no se dice con cuántos singles.

El porcentaje es **sobre el precio de venta** (`(precio − costo) / precio`), que es la convención del rubro. La otra lectura posible —sobre el costo, o markup— da un número más grande para la misma operación, y mezclarlas es una fuente clásica de confusión.

## Monedas

[`src/lib/domain/fx.ts`](src/lib/domain/fx.ts) es la parte pura; [`src/lib/services/fx.ts`](src/lib/services/fx.ts) la que trae y cachea.

- La API de frankfurter se consulta **una vez por día**, nunca por request. El cache es la tabla `FxRate`.
- Si la API falla se usa la última cotización guardada, marcada como vieja. Una API de terceros caída no rompe una pantalla.
- **Los cruces GBP↔EUR se derivan** de las dos tasas contra el dólar en el momento de usarlas. No se guardan precalculados: duplicar la fuente de verdad abre la puerta a que ida y vuelta queden inconsistentes.
- El redondeo se aplica **una sola vez, al importe final**. Redondear el tipo de cambio antes de multiplicar introduce un error que crece con el importe.
- La leyenda «cotización del DD/MM/AAAA» usa `date` —el día hábil que reporta el BCE— y no `fetchedAt`. Un sábado la API devuelve el viernes, y eso es lo que hay que mostrar.

## Invitaciones y registro

### El link importa tanto como el mail

El coordinador invita por email, pero el botón de **copiar el link** tiene el mismo peso visual que el envío, no menos: en la práctica la mayoría se van a mandar por WhatsApp. Tratar esa vía como secundaria sería diseñar para el flujo que no ocurre.

Por eso el link se muestra completo apenas se crea la invitación —no escondido detrás del botón de copiar, para que se pueda seleccionar a mano si el portapapeles falla— y el envío del mail nunca hace fallar la operación: si el proveedor está caído, el coordinador todavía tiene el link.

- Token de 256 bits, **hasheado con SHA-256 en la base**. El token en claro existe una sola vez, en el momento de crearlo. Si la base se filtrara, los links seguirían sin poder canjearse.
- Vence a los 14 días, de un solo uso.
- **Reenviar revoca el anterior** (`Invitation.revokedAt`). Si se reenvía es porque el anterior se perdió o se filtró: dejarlo vivo sería dejar dos llaves dando vueltas.
- Rate limiting en el canje, por IP.
- Si el email ya tiene una `Person` de otro viaje, **se reutiliza**: llega al formulario con sus datos cargados para confirmar o actualizar. Y si ya tiene cuenta, tiene que iniciar sesión antes de canjear — sin eso, cualquiera con el link podría sumar la cuenta de otro a un viaje.

### Los dos schemas de validación ⚠️

Este es el punto donde un formulario de tres pasos se arruina, así que está separado a propósito:

| Schema | Cuándo | Qué hace |
|---|---|---|
| `personDraftSchema` | En cada autoguardado | **Nunca rechaza.** Solo recorta espacios, convierte `""` en `null` y acota longitudes. |
| `personStrictSchema` | Al tocar "Terminar" | Exige todo lo obligatorio y valida formato. |

Si el autoguardado usara el estricto, el pasajero escribe `ana@` en el campo de mail, el guardado del paso entero falla **en silencio**, y cuando cierra la pestaña pierde los ocho campos que sí había completado.

Un test recorre campo por campo verificando que `personStrictSchema` y `isPersonComplete()` coinciden en qué es obligatorio. Si alguien agrega un campo en un lado y se olvida del otro, el pasajero vería 100% mientras el botón sigue sin dejarlo terminar — y el test rompe antes de que eso llegue a producción.

### Archivos

El navegador sube **directo al bucket** con una signed upload URL; el archivo no pasa por el servidor, que en Vercel chocaría con el límite de body y el timeout. Pero la validación sí es del servidor, en dos momentos:

1. Al pedir la URL firmada se valida lo **declarado** y se decide la path. El cliente no elige dónde escribe.
2. Después de subir, `confirmUpload` consulta el objeto **real** en el bucket y verifica su tipo y tamaño. Recién ahí la path se guarda.

El paso 2 no es redundante: lo del paso 1 es lo que dice el cliente.

Las imágenes se comprimen en el navegador con canvas (1600px de lado mayor, JPEG 0.82) antes de salir — una foto de certificado sacada con un celular pesa entre 4 y 12 MB y para leer un papel eso es un desperdicio. Los PDF no se tocan. Las descargas van por signed URL de 60 segundos.

### Habitaciones

Máximo dos personas por `Room`, con el tope validado dentro de una transacción: dos asignaciones simultáneas no pueden dejar tres.

Quien queda solo en habitación compartida aparece marcado en el listado, **pero el precio no cambia solo**. Ahí es donde el coordinador aplica `priceOverride` con un motivo, y queda en el `AuditLog`.

**El pasajero ve el nombre de su compañera de habitación y nada más** — ni mail, ni teléfono, ni nada de salud. Es información que va a saber igual al llegar al hotel y le ahorra una consulta al coordinador. Un test verifica que ningún otro dato del compañero viaja en la respuesta.

### Edición por el coordinador

Cada campo que el coordinador modifica genera una entrada de `AuditLog`, y el pasajero ve después un aviso de qué se tocó y cuándo. Que alguien más te cambie el número de pasaporte sin que te enteres no es aceptable.

El aviso no dice *quién* lo hizo: en un viaje con dos coordinadores ese dato no le aporta nada al pasajero y expone actividad interna. En el `AuditLog` queda completo, con el actor.

## La regla del pasaporte

| Situación | Nivel | ¿Bloquea confirmar? |
|---|---|---|
| Vencimiento **≤** fin del viaje | 🔴 Bloqueante | Sí |
| Vencimiento ≤ fin del viaje + `passportValidityMonths` | 🟡 Advertencia | No |
| Cualquier otro caso | 🟢 OK | No |
| Sin fecha cargada | ⬜ Sin dato | Sí |

`Trip.requireFullPassportValidity` **promueve la advertencia a bloqueante**. Se activa para destinos donde esos meses de validez posterior son requisito real de entrada y no una recomendación: Schengen exige 3 meses. Lo decide el coordinador según el destino.

`Trip.passportValidityMonths` define la ventana (default: 3).

La implementación está en [`src/lib/domain/passport.ts`](src/lib/domain/passport.ts) y es una función pura. La aritmética de fechas es toda en UTC y con clamp al último día del mes: `addMonths` de date-fns opera en hora local, y con fechas guardadas a medianoche UTC eso corre un día para atrás en UTC-3.

---

## Autorización

```
src/lib/auth/policy.ts    decisiones puras, sin base ni HTTP  → testeado
src/lib/auth/guards.ts    resuelven la sesión y llaman a policy
```

Los guards son cáscaras finas. Las reglas viven en un solo lugar, así que no hay una segunda copia que pueda divergir.

**La regla que no se negocia:** ninguna función acepta un identificador de *identidad* que venga del cliente. El `viewer` se deriva siempre de la sesión; los ids que llegan del cliente son los del *recurso*, y se validan contra el viewer. Eso elimina de raíz la clase entera de bugs de acceso por id ajeno.

`passengerVisibilityFilter()` devuelve el fragmento de `where` de Prisma que acota cada consulta. Para quien no tiene acceso devuelve una condición imposible en lugar de `{}`: si por error se omitiera el guard, la consulta trae cero filas en vez de traerlas todas. Fallar cerrado, no abierto.

`ForbiddenError` se traduce a 404 y no a 403 en todo lo que cuelga de una URL: un 403 le confirma a quien prueba ids a mano que ese pasajero existe.

### Un solo módulo toca Passenger y Person

[`src/lib/services/passengers.ts`](src/lib/services/passengers.ts) es el **único** lugar del sistema que consulta esas dos tablas. Ninguna página, Server Action ni servicio las toca por fuera.

El motivo es que el aislamiento depende de que `passengerVisibilityFilter()` se aplique siempre, y una regla que hay que acordarse de repetir en cada consulta es una regla que tarde o temprano se olvida en alguna. Si aparece un `prisma.passenger` o `prisma.person` en otro archivo, es un bug de seguridad, no un atajo.

### Verificado, no supuesto

Los 44 tests de `tests/integration/` corren contra la base **real**. Lo único mockeado es la resolución de la sesión de Supabase; los guards, los servicios y las consultas se ejecutan de verdad. Un test de aislamiento con Prisma mockeado no prueba aislamiento: prueba que el mock hace lo que le dijimos.

Escenario: dos viajes independientes con sus coordinadores y pasajeros. Se verifica que una pasajera no llega a los datos de otro pasajero del mismo viaje, a nada del otro viaje, ni a los costos de ninguno —tampoco pasando ids a mano.

Además, comprobado por HTTP contra el servidor corriendo:

| Ruta | Pasajera | Coordinador |
|---|---|---|
| `/viajes` | 307 → `/inicio` | listado |
| `/viajes/[id]` | 307 → `/inicio` | detalle |
| `/viajes/[id]/presupuesto` | 307 → `/inicio` | wizard |

Cero cifras de costo (`3.499,43`, `1.721,43`, `4.344,43`) aparecen en el HTML que recibe la pasajera en cualquiera de las tres. El coordinador las ve las tres.

---

## Decisiones de UX que están en el código

Los criterios de aceptación de UX no son sugerencias, así que quedaron en los primitivos y no en cada pantalla:

- **Botones e inputs a 44 px** (`h-11`). El preset de shadcn viene a 32 px, densidad de escritorio. Se cambió la escala completa en [`button.tsx`](src/components/ui/button.tsx) e [`input.tsx`](src/components/ui/input.tsx).
- **16 px de tipografía en todos los breakpoints.** El input de shadcn traía `md:text-sm`, que baja a 14 px en escritorio: se sacó. Además, cualquier input de menos de 16 px hace que iOS Safari haga zoom automático al enfocarlo y descoloque el formulario.
- `html { font-size: 100% }` respeta el tamaño de letra que el usuario configuró en el sistema. El público es adulto: hay gente que la agrandó a propósito.
- **Colores de semáforo** como tokens (`--color-status-ok`, `-warning`, `-danger`) en [`src/styles/app-theme.css`](src/styles/app-theme.css). En la interfaz nunca van solos: siempre con ícono de forma distinta y texto, para quien no distingue rojo de verde.
- `prefers-reduced-motion`, foco siempre visible y skip link, en la misma hoja.
- **Fechas en dd/mm/aaaa en los dos idiomas** y **montos siempre con símbolo de moneda explícito**. No existe una variante de `formatMoney` sin moneda: con tres monedas en juego, un número pelado es un error esperando a pasar. Ver [`src/lib/format.ts`](src/lib/format.ts).

---

## i18n

Todos los textos viven en `src/messages/{es,en}.json`. No hay strings hardcodeados en componentes.

```bash
npm run check:i18n
```

Falla si las dos traducciones no tienen exactamente las mismas claves, si alguna está vacía, o si a un idioma le falta un placeholder que el otro sí usa (un `{count}` faltante rompe el mensaje en tiempo de ejecución, no de compilación). Corre dentro de `npm run verify`.

**El idioma de navegación y el idioma del pasajero son cosas distintas, a propósito.** La URL (`/es`, `/en`) define en qué idioma se está navegando. `Person.preferredLanguage` define en qué idioma le llegan los mails a esa persona. El coordinador puede estar navegando en español y mandarle un mail en inglés a quien lo prefiere.

---

## Mail

```
src/lib/email/types.ts             interfaz EmailProvider
src/lib/email/console-provider.ts  default en desarrollo: loguea, no envía
src/lib/email/brevo-provider.ts    API REST de Brevo
```

Se elige con `EMAIL_PROVIDER` (`console` | `brevo`). Ningún llamador conoce a Brevo: cuando haya que migrar se agrega un adaptador y no se toca nada más.

El `ConsoleEmailProvider` imprime el mail completo **solo en desarrollo**. En cualquier otro entorno enmascara el destinatario y omite el cuerpo, para que si queda activo por un error de configuración no filtre datos personales a los logs de la plataforma.

---

## Cron (fase 5)

El endpoint `POST /api/cron/daily` todavía no existe. Cuando se construya:

- **Disparador primario: Vercel Cron.** El plan Hobby permite **2 cron jobs, con frecuencia diaria y una ventana de disparo de ~1 hora** (no garantiza la hora exacta). Se declara en `vercel.json` y se protege con `CRON_SECRET`.
- **GitHub Actions queda como respaldo opcional**, apuntando al mismo endpoint.
- El endpoint tiene que ser **idempotente**: dos invocaciones el mismo día no pueden mandar dos recordatorios. Eso ya está resuelto en el modelo por el `@@unique([installmentId, offsetDays])` de `SentReminder`.
- Responsabilidades: recordatorios de pago, marcado de cuotas vencidas, alertas de pasaporte, refresco del `FxRate` del día, procesamiento por lotes de `CommunicationRecipient`, purga de `RateLimitHit` y keep-alive de Supabase.

---

## Estructura

```
prisma/
  schema.prisma          modelo completo, con las decisiones documentadas
  seed.ts                viaje de ejemplo + 4 pasajeros + planes de pago
src/
  app/[locale]/          todas las páginas (el root layout vive acá)
    (auth)/              login, recuperar, reset
    (coordinador)/
      viajes/            listado · nuevo · [tripId] · [tripId]/presupuesto
      viajes/actions.ts  Server Actions del módulo de presupuesto
      admin/
    (pasajero)/          inicio
  app/api/auth/callback/ canje del código de los links de Supabase
  components/
    budget/              wizard, panel de costo en vivo y sus 5 pasos
    layout/              nav, menú de usuario, selector de idioma
    ui/                  primitivos de shadcn (re-themeados)
  i18n/                  routing, request, navigation
  lib/
    auth/                policy (puro) · guards · rate-limit · sync
    db/                  cliente Prisma + pool de pg
    domain/              money · pricing · fx · passport · person (puros)
    email/               interfaz + adaptadores
    services/            trip · passengers · fx · audit  (autorización + base)
    supabase/            clientes server / browser / proxy
    validation/          schemas Zod compartidos cliente/servidor
    format.ts            formateo de montos y fechas
  messages/              es.json · en.json
  proxy.ts               i18n + refresco de sesión (era "middleware")
  styles/app-theme.css   tokens y ajustes de accesibilidad
scripts/
  check-i18n.ts          paridad de traducciones
  check-db.ts            diagnóstico de conexión y pooling
tests/
  auth/policy.test.ts    matriz de permisos
  domain/                passport · person · money · pricing · fx
  integration/           contra la base real: aislamiento y flujo de presupuesto
```

## El wizard de presupuesto

La pantalla más difícil del sistema. Cinco pasos: datos generales → itinerario y hoteles → comidas y eventos → costos del grupo → revisión y precios.

- **El viaje se crea en BORRADOR desde el paso 1.** A partir de ahí cada fila autoguarda apenas se confirma, así que se puede abandonar y retomar sin perder nada.
- **El paso vive en la URL** (`?paso=3`): recargar no devuelve al principio.
- **El panel de costo** es fijo a la derecha en escritorio y una barra inferior colapsable en pantallas chicas. Recalcula en el navegador con el mismo motor que usa el servidor.
- **Antes de guardar un precio** se muestra el impacto: «el costo en compartida pasa de £3.499,43 a £3.599,43».
- Si `budgetedPassengers < minPassengers` aparece una alerta que **no bloquea**: casi siempre es un descuido, pero puede ser deliberado.

### Estados del viaje

| Estado | Qué permite |
|---|---|
| `BORRADOR` | Editable. No visible para los pasajeros. Es donde se arma. |
| `ABIERTO` | Se invita y se cobra. **El presupuesto sigue editable**: en la práctica los precios del mayorista cambian con el viaje ya abierto, y cada cambio queda auditado. |
| `CERRADO` | No se invita más, se sigue cobrando. |
| `FINALIZADO` | Solo lectura. |

Las transiciones son explícitas (`BORRADOR → ABIERTO → CERRADO → FINALIZADO`, con vuelta atrás salvo desde `FINALIZADO`); cualquier salto fuera de esa tabla se rechaza.

---

## Qué hay hecho y qué no

### Fase 3 — terminada

- Invitaciones con token hasheado, vencimiento de 14 días, un solo uso, revocación al reenviar y rate limiting en el canje. Botón de copiar link como acción de primer nivel.
- Registro del pasajero en 3 pasos con autoguardado, barra de progreso y elección de idioma. Dos schemas Zod separados.
- Subida directa al bucket con compresión en cliente y validación del objeto real en el servidor.
- Alerta de pasaporte visible para las dos partes, con `requireFullPassportValidity`.
- Transiciones de estado validadas en el servicio.
- Habitaciones con tope de dos y alerta de "sin compañero"; `priceOverride` con motivo y auditoría.
- Listado del coordinador con semáforo y filtros; ficha editable con `AuditLog` y aviso al pasajero.
- Plantilla de mail de invitación en es/en.
- 81 tests de integración (37 nuevos) y 148 unitarios (21 nuevos).

### Fase 2 — terminada

- Motor de cálculo puro (`pricing.ts`): costos, prorrateo, residuo de redondeo, margen por pasajero y margen total con base declarada. 36 tests.
- Servicio de cotizaciones con cache diario, degradación al último valor guardado y cruces derivados. 18 tests.
- Capa de servicios (`trip.ts`, `passengers.ts`, `audit.ts`) con autorización por `requireTripRole` y auditoría de todo cambio de precio.
- Validación Zod compartida cliente/servidor.
- Wizard de 5 pasos con autoguardado y panel de costo en vivo (fijo en escritorio, barra colapsable en mobile).
- Listado y detalle de viaje con pestañas; estados del viaje con transiciones controladas.
- 44 tests de integración contra la base real, incluidos los de aislamiento.

### Fase 1 — terminada

- Proyecto Next.js 16 con TypeScript estricto, Tailwind v4, shadcn re-themeado, ESLint, Prettier y Vitest.
- Schema Prisma completo: 20 modelos, con las seis decisiones y las cinco entidades agregadas.
- Auth con los tres roles: login, logout, recuperación de contraseña, rate limiting, sincronización con Supabase Auth. Sin registro abierto.
- Capa de autorización con 73 tests, incluidos los de aislamiento entre pasajeros.
- i18n completo con verificación de paridad de claves.
- Shells de coordinador y de pasajero, con la home del pasajero de 3 tarjetas.
- Capa de mail con los dos adaptadores.
- Seeds con viaje completo, 4 pasajeros en distintos estados y 2 planes de pago.
- Workflow de backup semanal cifrado.

### Todavía no

| Fase | Qué falta |
|---|---|
| 4 | Planes de 1 a 6 cuotas, congelamiento de TC, revisión de comprobantes, dashboard con semáforo. |
| 5 | Editor bilingüe, envío masivo, endpoint de cron, plantillas de mail. |
| 6 | Exportación a Excel (**con fecha y hora de generación en la primera fila**), panel de admin con escritura, revisión de accesibilidad. **Completar el backup**: usuarios de Auth y archivos del Storage (ver [deuda conocida](#️-deuda-conocida-el-backup-está-incompleto)). |

### Fuera de alcance

Pasarela de pago online (el modelo ya tiene `provider` y `externalId` preparados), módulo de costos reales imputados, app móvil nativa.

---

## Comandos

```bash
npm run dev            # servidor de desarrollo
npm run build          # build de producción
npm run verify         # i18n + typecheck + lint + tests unitarios + integración
npm run test           # tests unitarios (rápidos, sin base)
npm run test:db        # tests de integración (necesitan DATABASE_URL)
npm run test:watch     # unitarios en modo watch
npm run check:i18n     # paridad de traducciones
npm run check:db       # diagnóstico de conexión y pooling
npm run typecheck      # solo tsc
npm run lint           # solo eslint
```
