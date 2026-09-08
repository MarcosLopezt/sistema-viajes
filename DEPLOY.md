# Checklist de deploy

Para poner el sistema en producción por primera vez. Seguí los pasos **en orden** y marcá cada casilla; varios dependen del anterior.

Necesitás cuenta en: **Supabase**, **Vercel**, **Brevo** y **GitHub**. Las cuatro alcanzan con el plan gratuito.

Al final hay un [checklist de verificación](#7--verificación-final) para comprobar que quedó todo bien.

---

## 1 · Supabase

- [ ] **Crear el proyecto.** Elegí la región más cercana a tus usuarios (para Argentina, `South America (São Paulo)`).
- [ ] **Guardar la contraseña de la base** que te pide al crear el proyecto. No se puede volver a ver: si la perdés hay que resetearla.
- [ ] **Anotar las dos connection strings.** En *Project Settings → Database → Connection string*:

  | Cuál | Puerto | Para qué |
  |---|---|---|
  | **Transaction pooler** | `6543` | `DATABASE_URL` — la aplicación |
  | **Session pooler / Direct** | `5432` | `DIRECT_URL` — migraciones, seed y backups |

  > Las dos son necesarias y **no** son intercambiables. El porqué está en [README §Base de datos](README.md#base-de-datos).

- [ ] **Anotar las claves de API.** En *Project Settings → API*:
  - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
  - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `service_role` → `SUPABASE_SERVICE_ROLE_KEY`

  > 🔴 La `service_role` **bypassea toda restricción**. No lleva prefijo `NEXT_PUBLIC_` y nunca debe llegar al navegador. Si alguna vez la pegás en un archivo con ese prefijo, rotála desde el panel de Supabase.

- [ ] **Crear el bucket de Storage.** *Storage → New bucket*:
  - Nombre: `documentos`
  - **Public bucket: NO.** Tiene que quedar privado. Ahí viven certificados médicos y comprobantes de pago; un bucket público los deja accesibles a cualquiera con la URL.

- [ ] **Activar la confirmación de email.** *Authentication → Providers → Email*:
  - **Confirm email: ON.**

  > En desarrollo suele estar apagada para no tener que confirmar cada usuario de prueba. En producción tiene que estar prendida.

- [ ] **Configurar las URLs de redirección.** *Authentication → URL Configuration*:
  - `Site URL`: `https://<tu-dominio>`
  - `Redirect URLs`: agregá `https://<tu-dominio>/api/auth/callback`

  > Sin esto, los links de «olvidé mi contraseña» redirigen a `localhost` y no funcionan. Es el error más común de este paso.

- [ ] **Correr las migraciones.** Se corren **a mano, desde tu máquina, antes del deploy**. El build de Vercel **no** las aplica: `npm run build` es `next build`, y lo único que agrega el `postinstall` es `prisma generate`, que no toca la base. Es deliberado — ver [§6](#6--cosas-que-no-hay-que-hacer).

  El CLI toma la base de `prisma7.config.ts`, que lee `DIRECT_URL` (y si no está, `DATABASE_URL`) del `.env` **local**. Así que «apuntar a producción» es elegir de qué archivo salen esas dos variables. Lo más seguro es un archivo aparte, para no pisar tu `.env` de desarrollo:

  ```bash
  # .env.production.local  (agregalo al .gitignore, igual que .env)
  #   DATABASE_URL="...:6543/postgres"
  #   DIRECT_URL="...:5432/postgres"

  npx dotenv -e .env.production.local -- npx prisma migrate status   # qué falta
  npx dotenv -e .env.production.local -- npx prisma migrate deploy   # aplicarlas
  npx dotenv -e .env.production.local -- npm run check:db            # verificar
  ```

  `dotenv-cli` ya está en las devDependencies. Terminá con `migrate status` otra vez: tiene que decir que no queda ninguna migración pendiente.

  > `migrate deploy`, **no** `migrate dev`. `dev` compara el schema contra la base, genera SQL nuevo y puede resetearla.

  **Los dos índices únicos parciales llegan bien a producción.** `migrate deploy` aplica los `.sql` versionados tal como están, sin comparar nada contra el schema, así que `Trip_una_sola_captacion_abierta` (fase 7) y `DepositProof_una_vigente_por_interesada` (fase 8) se crean y nadie los toca. Acá no hay ningún paso extra que hacer.

  🔴 El riesgo está **en tu máquina, después**. Prisma no sabe expresar índices parciales y no los conoce: la próxima vez que corras `migrate dev` los va a ver como *drift* y va a proponer un `DROP INDEX` de los dos. **Borrá esas líneas del SQL generado antes de aceptar la migración.** Si se cuelan, la siguiente migración que apliques a producción se los lleva puestos, y con ellos la única garantía real contra dos viajes captando a la vez y contra dos comprobantes de seña vigentes por interesada.

- [ ] **Crear el primer administrador.** No hay pantalla de registro: se entra por invitación, y para invitar tiene que existir alguien. Son dos pasos, y los ids **tienen que coincidir**: son lo único que une Supabase Auth con la tabla `User`.

  1. *Authentication → Users → Add user*, con **Auto Confirm User** tildado (si no, no vas a poder entrar hasta confirmar el mail). Copiá el **UUID** que queda en la lista.

  2. *SQL Editor* → corré esto, con ese UUID y ese mismo email:

     ```sql
     insert into public."User" (id, email, role, "updatedAt")
     values ('<uuid-de-supabase-auth>', '<tu-email>', 'ADMIN', now());
     ```

     `"User"` va entre comillas dobles: la tabla tiene mayúscula y Postgres, sin comillas, la busca en minúsculas y contesta que no existe. `"updatedAt"` tampoco es optativa: la columna es `NOT NULL` y **no tiene default** — Prisma la completa desde el cliente, y acá no hay cliente. `personId` queda en `null`: la ficha personal es de las pasajeras, no de la administradora.

  3. Verificá que quedó bien **antes** de seguir:

     ```sql
     select u.id, u.email, u.role
     from public."User" u
     join auth.users a on a.id = u.id;
     ```

     Tiene que devolver **una fila**, con `role = 'ADMIN'`. Cero filas significa que los ids no coinciden: vas a poder iniciar sesión y el sistema te va a tratar como una desconocida.

---

## 2 · Brevo (envío de mails)

- [ ] **Crear la cuenta** y verificar tu dirección de remitente. El plan gratuito permite 300 mails por día, de sobra para un viaje.
- [ ] **Autenticar el dominio** (*Senders, Domains & Dedicated IPs → Domains*). Agregá los registros DKIM y SPF que te indique en tu proveedor de DNS.

  > Sin esto los mails salen, pero Gmail y Outlook los mandan a spam con mucha más facilidad. Es el paso que más se saltea y el que más problemas causa después.

- [ ] **Generar una API key** (*SMTP & API → API Keys*) → `BREVO_API_KEY`.
- [ ] **Anotar el remitente**: `EMAIL_FROM_NAME` y `EMAIL_FROM_ADDRESS`. La dirección tiene que ser una del dominio que autenticaste.

---

## 3 · Vercel

- [ ] **Importar el repositorio** desde GitHub. El framework se detecta solo.
- [ ] **Cargar las variables de entorno** (*Settings → Environment Variables*), todas en **Production**:

  La columna «vs. tu `.env`» dice si el valor de producción es el mismo que tenés local o si **cambia**. Las que cambian son las que se olvidan.

  | Variable | Valor en producción | vs. tu `.env` | Ojo con |
  |---|---|---|---|
  | `DATABASE_URL` | pooler del proyecto de **producción**, puerto **6543** | 🔴 cambia | otro proyecto de Supabase, otra password |
  | `DIRECT_URL` | directa del proyecto de **producción**, puerto **5432** | 🔴 cambia | la app **no la usa en runtime**: solo la leen `prisma migrate`, `db:seed` y `check:db`. Cargála igual, para poder correr esos comandos contra prod |
  | `NEXT_PUBLIC_SUPABASE_URL` | `https://<proyecto-prod>.supabase.co` | 🔴 cambia | |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la `anon public` de **prod** | 🔴 cambia | |
  | `SUPABASE_SERVICE_ROLE_KEY` | la `service_role` de **prod** | 🔴 cambia | 🔴 sin prefijo `NEXT_PUBLIC_` |
  | `SUPABASE_STORAGE_BUCKET` | `documentos` | ✓ igual | el bucket tiene que existir **y estar privado** en el proyecto de prod |
  | `EMAIL_PROVIDER` | `brevo` | 🔴 cambia | local está en `console`: si queda así **no se manda ningún mail** y nada falla |
  | `BREVO_API_KEY` | la del paso 2 | 🔴 cambia | local es un placeholder |
  | `EMAIL_FROM_NAME` | ej. `Viajes` | ✓ igual | |
  | `EMAIL_FROM_ADDRESS` | una del dominio autenticado en Brevo | 🔴 cambia | local es `no-reply@example.com`, que Brevo rechaza |
  | `CRON_SECRET` | uno nuevo, largo y al azar | 🔴 cambia | no reutilices el local. Vercel manda la cabecera **solo si la variable existe en el proyecto**: sin ella el endpoint queda cerrado y el cron devuelve 401 |
  | `NEXT_PUBLIC_APP_URL` | `https://<tu-dominio>` | 🔴 cambia | local es `http://localhost:3000`; si queda así, **todos** los links de los mails apuntan a tu máquina |
  | `EMAIL_REPLY_TO` | vacía, o una casilla que alguien lea | ➕ no está en tu `.env` | **opcional**. Vacía, el «responder» va al primer coordinador del viaje, que suele ser lo correcto |
  | `INTEREST_NOTIFICATION_EMAIL` | vacía, o a dónde avisar cuando alguien se anota en `/interes` | ➕ no está en tu `.env` | **opcional**. Vacía, el aviso va a las coordinadoras del viaje |

  Las dos últimas son opcionales de verdad: tienen fallback en código y el sistema arranca sin ellas. Las doce anteriores **no**.

  🔴 **Las `NEXT_PUBLIC_*` se hornean en el bundle durante el build.** Cambiar una en el panel no cambia nada hasta que redespliegues. Cargálas **antes** del primer deploy, y después de tocar cualquiera de ellas hacé *Redeploy*.

  > `?pgbouncer=true&connection_limit=1` en la `DATABASE_URL` no hace daño, pero tampoco limita nada: son directivas del viejo engine de Prisma y el driver `pg` las ignora en silencio. El límite real es el `max: 1` del pool, en código. Lo comprueba `npm run check:db`.

  Para el `CRON_SECRET`:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- [ ] **Verificar el cron.** `vercel.json` declara la corrida diaria en `/api/cron/daily`. En *Settings → Cron Jobs* tiene que aparecer después del primer deploy.

  Límites del plan Hobby (verificado en la documentación de Vercel, agosto 2026): **100 cron jobs por proyecto** en todos los planes, pero en Hobby cada uno corre **una vez por día** como máximo —una expresión más frecuente hace **fallar el deploy**— y se dispara **en cualquier momento de la hora indicada** (±59 min).

  > Esa ventana de una hora es la razón por la que el estado «vencida» de una cuota se **calcula al leer** y no lo escribe el cron: si dependiera del cron, el semáforo mentiría justo el día del vencimiento.

  🔴 **El horario del cron es siempre UTC.** `0 9 * * *` no son las 9 de la mañana en Argentina: son las **06:00–06:59 hora de Buenos Aires**. Si querés que los recordatorios salgan cerca de las 9 locales, la expresión es `0 12 * * *`.

- [ ] **Probar el cron a mano**, sin esperar al día siguiente. Desde *Cron Jobs → Run* en el panel, o con `curl` contra la URL de producción:

  ```bash
  curl -i "https://<tu-dominio>/api/cron/daily" -H "Authorization: Bearer $CRON_SECRET"
  ```

  🔴 **Vercel invoca los crons con GET, no con POST**, y **no sigue redirecciones**: si la respuesta es un 3xx o un 405, la corrida se da por terminada sin haber hecho nada, y sin ruido. Un **200 con el resumen de las cinco tareas** es lo único que cuenta como «anduvo» — y revisá el JSON tarea por tarea, porque el endpoint devuelve 200 aunque alguna haya fallado (un 500 haría que se reintente la corrida entera).

  > Vercel **no reintenta** una corrida fallida, y una que nunca llegó a ejecutarse no deja log. Por eso los recordatorios disparan con `hoy >= vencimiento + offset` y no con `==`: un día perdido se recupera al siguiente.

- [ ] **Hacer el deploy** y esperar a que termine en verde.
- [ ] **Configurar el dominio** (*Settings → Domains*) si vas a usar uno propio.

  > Si cambiás el dominio después, **volvé al paso 1** y actualizá las URLs de redirección de Supabase, y al paso 3 para `NEXT_PUBLIC_APP_URL`. Son las dos cosas que se olvidan.

---

## 4 · GitHub (backups)

- [ ] **Cargar los secretos** en *Settings → Secrets and variables → Actions*:

  | Secreto | Valor |
  |---|---|
  | `BACKUP_DATABASE_URL` | la connection string **directa** (5432) |
  | `BACKUP_PASSPHRASE` | una frase larga, generada al azar |
  | `BACKUP_SUPABASE_URL` | `https://<proyecto>.supabase.co` |
  | `BACKUP_SERVICE_ROLE_KEY` | la `service_role` |
  | `BACKUP_STORAGE_BUCKET` | `documentos` |

- [ ] **Guardar la `BACKUP_PASSPHRASE` fuera de GitHub.** En un gestor de contraseñas. Sin ella los backups son irrecuperables, y si perdés el acceso a la cuenta de GitHub perdés las dos cosas a la vez.

- [ ] **Correr el workflow a mano una vez** (*Actions → Backup semanal → Run workflow*) y confirmar que termina en verde. El propio job verifica que el backup se pueda volver a descifrar.

- [ ] **Anotar en el calendario revisar la pestaña Actions cada dos meses.** GitHub desactiva los workflows programados tras 60 días sin actividad en el repositorio.

---

## 5 · Primer uso

- [ ] Entrar a `https://<tu-dominio>` e iniciar sesión con el administrador del paso 1.
- [ ] Crear un viaje de prueba y publicarlo.
- [ ] Invitarte a vos mismo con otra dirección de email.
- [ ] **Confirmar que el mail llega** y que el link abre la pantalla correcta.

---

## 6 · Cosas que NO hay que hacer

- ❌ Poner la `service_role` en una variable con prefijo `NEXT_PUBLIC_`.
- ❌ Dejar el bucket `documentos` como público.
- ❌ Usar la connection string del pooler (6543) para `DIRECT_URL` o para los backups: `pg_dump` no funciona contra pgbouncer.
- ❌ Dejar `NEXT_PUBLIC_APP_URL` apuntando a `localhost`.
- ❌ Dejar `EMAIL_PROVIDER=console` en producción.
- ❌ Correr `prisma migrate dev` o `prisma migrate reset` contra producción.
- ❌ Poner `prisma migrate deploy` en el *Build Command* de Vercel. Cada preview y cada rollback migraría la base de producción, y un build que falla a la mitad la deja a medio migrar. Las migraciones se corren a mano, desde tu máquina, antes del deploy.
- ❌ Aceptar un `DROP INDEX "Trip_una_sola_captacion_abierta"` o `DROP INDEX "DepositProof_una_vigente_por_interesada"` que proponga `migrate dev`. Ver el paso de migraciones.

---

## 7 · Verificación final

Marcá cada una **después** de haberla comprobado de verdad, no de suponerla:

- [ ] Puedo iniciar sesión.
- [ ] El mail de invitación **llega** y su link abre el sistema (no `localhost`).
- [ ] «Olvidé mi contraseña» manda un mail y el link funciona.
- [ ] Puedo subir un certificado médico y **volver a abrirlo**.
- [ ] Al pegar la URL del archivo en una ventana anónima **no** se abre. Si se abre, el bucket quedó público.
- [ ] Un usuario pasajero **no** puede entrar a `/viajes` ni a `/admin` escribiendo la URL a mano.
- [ ] Las planillas de Excel se descargan y abren en Excel.
- [ ] En *Vercel → Cron Jobs* aparece la corrida diaria.
- [ ] El cron, **disparado a mano y con un GET**, devuelve **200** con las cinco tareas en `ok: true`. Que aparezca en el panel no prueba que ejecute.
- [ ] `prisma migrate status` contra producción dice que no hay migraciones pendientes, y los dos índices parciales existen:
      `select indexname from pg_indexes where indexname like '%una_sola_captacion%' or indexname like '%una_vigente%';` → **dos filas**.
- [ ] El workflow de backup terminó en verde al menos una vez.
- [ ] La `BACKUP_PASSPHRASE` está guardada en un lugar que **no** es GitHub.
