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

- [ ] **Correr las migraciones.** Desde tu máquina, con `DIRECT_URL` apuntando al proyecto de producción:

  ```bash
  npx prisma migrate deploy
  ```

  > `migrate deploy`, **no** `migrate dev`. `dev` puede resetear la base.

- [ ] **Crear el primer administrador.** No hay pantalla de registro: se entra por invitación, y para invitar hace falta que exista alguien. Creá el usuario desde *Authentication → Users → Add user* (con email confirmado) y después insertá la fila correspondiente en `public."User"` con `role = 'ADMIN'` y el **mismo `id`** que te dio Supabase Auth. Los ids tienen que coincidir: son lo que une las dos tablas.

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

  | Variable | Valor | Ojo con |
  |---|---|---|
  | `DATABASE_URL` | pooler, puerto **6543** | |
  | `DIRECT_URL` | directa, puerto **5432** | |
  | `NEXT_PUBLIC_SUPABASE_URL` | `https://<proyecto>.supabase.co` | |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la `anon public` | |
  | `SUPABASE_SERVICE_ROLE_KEY` | la `service_role` | 🔴 sin prefijo `NEXT_PUBLIC_` |
  | `SUPABASE_STORAGE_BUCKET` | `documentos` | |
  | `EMAIL_PROVIDER` | `brevo` | si queda en `console` **no se manda ningún mail** |
  | `BREVO_API_KEY` | la del paso 2 | |
  | `EMAIL_FROM_NAME` | ej. `Viajes` | |
  | `EMAIL_FROM_ADDRESS` | del dominio autenticado | |
  | `CRON_SECRET` | generá uno largo y al azar | 🔴 ver abajo |
  | `NEXT_PUBLIC_APP_URL` | `https://<tu-dominio>` | 🔴 **cambiar**: si queda en `localhost`, todos los links de los mails apuntan a tu máquina |

  Para el `CRON_SECRET`:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- [ ] **Verificar el cron.** `vercel.json` ya define la corrida diaria. En *Settings → Cron Jobs* tiene que aparecer después del primer deploy.

  > El plan gratuito de Vercel permite **una corrida diaria** y la dispara con hasta una hora de diferencia. Es la razón por la que el estado «vencida» de una cuota se **calcula al leer** y no lo escribe el cron: si dependiera del cron, el semáforo mentiría justo el día del vencimiento.

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
- [ ] El workflow de backup terminó en verde al menos una vez.
- [ ] La `BACKUP_PASSPHRASE` está guardada en un lugar que **no** es GitHub.
