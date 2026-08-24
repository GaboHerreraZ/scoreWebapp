# Desplegar la API en AWS — guía paso a paso desde la consola

Guía real del despliegue de `webAppApi` (NestJS + Prisma + Puppeteer) en AWS,
hecha **íntegramente desde la consola web**. No requiere AWS CLI ni Docker en tu
máquina. Lo único que sigue corriendo en local son las migraciones de Prisma
(`npm run prisma:migrate:deploy` / `:pro`), como siempre.

**Datos de esta cuenta** (reemplázalos si montas otra):

| Dato | Valor |
|---|---|
| Account ID | `854847082271` |
| Región | `us-east-1` (N. Virginia) |
| Repositorio ECR | `creditia-api` |
| Proyecto CodeBuild | `creditia-api-build` |
| Servicio ECS | `creditia-api-staging` |
| Repo GitHub | `GaboHerreraZ/scoreWebapp` |

---

## Panorama

```
GitHub (rama staging)
      │
      ▼
AWS CodeBuild ──── construye el Dockerfile ────► Amazon ECR
                                                     │  imagen :latest
                                                     ▼
                                        Amazon ECS Express Mode (Fargate + ALB)
                                                     │  HTTPS
                                                     ▼
                                              Application URL
                                                     │
                                                     ▼
                                       Supabase PostgreSQL (fuera de AWS)
```

**Servicios usados:**

| Servicio | Para qué | Costo aprox. |
|---|---|---|
| **ECR** | Guarda las imágenes Docker | ~$0.10/GB-mes |
| **CodeBuild** | Construye la imagen dentro de AWS | ~$0.01/minuto |
| **Parameter Store** | Guarda los secretos cifrados | Gratis (tier estándar) |
| **ECS Express Mode** | Ejecuta el contenedor, ALB y TLS | ~$35–55/mes |

**Lo que NO hace falta:** VPC propia, NAT Gateway, RDS ni certificados manuales.
La base de datos es Supabase (internet público) y Express Mode monta el
balanceador y el certificado por su cuenta.

> **Nota histórica:** el plan original usaba **AWS App Runner**, más simple y más
> barato (~$15–25/mes). AWS dejó de aceptar clientes nuevos en App Runner el
> **30 de abril de 2026** y recomienda ECS Express Mode como reemplazo. Por eso
> esta guía usa ECS.

### Lo que el repositorio ya trae listo

No hubo que cambiar código para desplegar:

- `Dockerfile` multi-stage con `chrome-headless-shell`, `tini` y usuario no-root.
- La app escucha en `0.0.0.0` con el puerto de `PORT` (`src/main.ts`).
- Health check público en `GET /api/health`.
- Cierre limpio ante `SIGTERM` (`app.enableShutdownHooks()`).
- Puppeteer con `--no-sandbox` y `--disable-dev-shm-usage`, obligatorio en
  Fargate porque no se puede agrandar `/dev/shm`.

---

## Paso 1 — Cuenta, usuario y región

> **Por qué este paso.** En AWS, *quién eres* y *qué puedes hacer* son cosas
> separadas del servicio que uses: todo pasa por IAM. La cuenta raíz es la llave
> maestra —puede borrar la cuenta entera— y por eso se blinda y se guarda. La
> región no es un detalle cosmético: define dónde viven físicamente los recursos,
> cuánta latencia hay contra Supabase, y recursos de regiones distintas
> sencillamente no se ven entre sí. Y el plan de la cuenta importa porque el
> Free Plan trae servicios bloqueados: si no lo cambias, el Paso 6 no se puede
> hacer.

### 1.1 Proteger la cuenta raíz

El correo del registro es la **cuenta raíz**: puede hacer todo, incluso cerrar la
cuenta. No se usa para el día a día.

1. Inicia sesión como root → menú de tu nombre → **Security credentials**.
2. **Multi-factor authentication (MFA)** → **Assign MFA device** → *Authenticator app*.

### 1.2 Usuario de trabajo

1. **IAM** → **Users** → **Create user** → nombre `gabo-admin`.
2. Marca **Provide user access to the AWS Management Console** → *I want to create an IAM user*.
3. **Attach policies directly** → **AdministratorAccess**.
4. Guarda la **URL de acceso** (`https://854847082271.signin.aws.amazon.com/console`).
5. Asígnale MFA también.

Desde aquí, todo con `gabo-admin`.

### 1.3 Plan de pago

Las cuentas nuevas arrancan en el **Free Plan**, que tiene servicios bloqueados.
Hay que pasar a pago por uso (no es una cuota fija: pagas solo lo que consumes).

- **Billing** → **Upgrade plan**.
- ⚠️ **Solo el usuario root puede hacerlo.** Con `AdministratorAccess` no alcanza.
- Aprovecha, como root: **Account** → *IAM user and role access to Billing information* → **Activate IAM Access**.

### 1.4 Región y presupuesto

- Selector arriba a la derecha → **N. Virginia (us-east-1)**. Todo se crea ahí;
  recursos en regiones distintas no se ven entre sí.
- **Billing** → **Budgets** → **Create budget** → *Monthly cost budget* → `30` USD → tu correo.

---

## Paso 2 — Repositorio de imágenes (ECR)

> **Por qué este paso.** ECS no despliega código fuente: despliega una **imagen
> ya construida**. Necesita un lugar de dónde descargarla, y ese lugar es un
> registro de contenedores. ECR es el registro privado de AWS —el equivalente a
> un Docker Hub tuyo— y tiene la ventaja de que ECS se autentica contra él sin
> credenciales adicionales, solo con permisos de IAM. Sin este paso, el Paso 6 no
> tendría nada que ejecutar.

1. **ECR** → **Repositories** (registro privado) → **Create repository**.

| Campo | Valor |
|---|---|
| Visibility | `Private` |
| Repository name | `creditia-api` |
| Tag immutability | **Mutable** |
| Scan on push | Opcional (gratis) |

⚠️ **Mutable es obligatorio**: cada build reescribe el tag `latest`. Con
*Immutable* el segundo build falla con `ImageTagAlreadyExistsException`.

**URI resultante:**
`854847082271.dkr.ecr.us-east-1.amazonaws.com/creditia-api`

### Limpieza automática (opcional)

Repositorio → **Lifecycle Policy** → **Create rule**:
priority `1`, image status `Any`, match criteria **Image count more than** = `10`,
action `Expire`.

> Usa *image count*, no *días*. Las políticas de ECR no saben qué imagen está en
> uso: una regla por días borraría la imagen en producción si pasas un mes sin
> desplegar.

---

## Paso 3 — Construir la imagen (CodeBuild)

> **Por qué este paso.** Alguien tiene que ejecutar `docker build`, y la consola
> web no puede hacerlo: es una interfaz, no una máquina. Las opciones son tu PC
> (que exigiría Docker instalado y subir 1.5 GB por tu conexión en cada
> despliegue) o una máquina dentro de AWS. CodeBuild es esa máquina: clona el
> repo, construye con el mismo `Dockerfile` y empuja a ECR, siempre en el mismo
> entorno. Eso también elimina el clásico "en mi máquina funciona": la imagen que
> se despliega no depende de cómo esté configurado tu equipo.

La consola no puede ejecutar `docker build`. CodeBuild lo hace dentro de AWS.

### 3.1 Conectar GitHub (hazlo primero, aparte)

Si se hace desde el modal de CodeBuild es fácil que el flujo quede a medias y el
desplegable de repositorios salga vacío.

1. **Developer Tools → Settings → Connections** (verifica región us-east-1) → **Create connection**.
2. Provider `GitHub`, nombre `github-gabo` → **Connect to GitHub** → autoriza.
3. ⚠️ **De vuelta en AWS, haz clic en `Install a new app`.** Este es el paso que
   la gente omite: sin él la conexión queda en `Pending` y no lee nada.
4. En GitHub: cuenta `GaboHerreraZ` → **Repository access** → incluye `scoreWebapp` → **Install**.
5. De vuelta en AWS → **Connect**. El estado debe quedar en **`Available`**.

Verificación: GitHub → Settings → Applications → **Installed GitHub Apps** debe
listar *AWS Connector for GitHub*.

### 3.2 Crear el proyecto

**CodeBuild** → **Create project** → nombre `creditia-api-build`.

| Sección | Campo | Valor |
|---|---|---|
| Source | Source provider | `GitHub` |
| | Repository | `GaboHerreraZ/scoreWebapp` |
| | Branch | `staging` (o `main` para producción) |
| | Build type | `Single build` |
| Environment | Provisioning / Compute | `On-demand` / `EC2` |
| | OS / Runtime | `Amazon Linux` / `Standard` |
| | Image | `aws/codebuild/amazonlinux-x86_64-standard:5.0` |
| | Image version | *Always use the latest image for this runtime version* |
| | **Privileged** | ✅ **marcado** |
| | Service role | `New service role` |
| | Timeout | `30 minutes` |
| Artifacts | Type | `No artifacts` |
| Logs | CloudWatch logs | activado, campos vacíos |

⚠️ Dos cosas que rompen el build:
- **Sin la casilla `Privileged`** → `Cannot connect to the Docker daemon`.
- **Imagen ARM (`aarch64`)** → la imagen no arranca en Fargate, que corre `linux/amd64`.

### 3.3 Buildspec

En *Buildspec* elige **Insert build commands** → **Switch to editor** → pega:

```yaml
version: 0.2

env:
  variables:
    AWS_REGION: us-east-1
    ECR_REPO: creditia-api
    ACCOUNT_ID: "854847082271"

phases:
  pre_build:
    commands:
      - REGISTRY=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
      - echo "Login en ECR..."
      - aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REGISTRY
      - TAG=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c1-7)
  build:
    commands:
      - echo "Construyendo $REGISTRY/$ECR_REPO:$TAG"
      - docker build -t $REGISTRY/$ECR_REPO:$TAG -t $REGISTRY/$ECR_REPO:latest .
  post_build:
    commands:
      - docker push $REGISTRY/$ECR_REPO:$TAG
      - docker push $REGISTRY/$ECR_REPO:latest
      - echo "Imagen publicada con los tags $TAG y latest"
```

Cada imagen queda con **dos tags**: el hash corto del commit (para rollback) y
`latest` (el que despliega ECS).

### 3.4 Permiso de ECR para el rol de CodeBuild

El rol nace sin permiso de subir imágenes; el build correría 15 minutos y moriría
al final con `denied: ... not authorized to perform: ecr:PutImage`.

1. **IAM** → **Roles** → busca `codebuild-creditia`.
2. **Add permissions** → **Attach policies** → **`AmazonEC2ContainerRegistryPowerUser`**.

### 3.5 Primer build

**Start build** → pestaña **Build logs**. Tarda 8–20 minutos (instala
dependencias, `prisma generate`, compila NestJS y descarga Chrome). Al terminar,
verifica en ECR que existan los dos tags.

---

## Paso 4 — Secretos en Parameter Store

> **Por qué este paso.** Una imagen Docker es un archivo que cualquiera con
> acceso a ECR puede descargar y abrir. Si las claves estuvieran adentro,
> quedarían expuestas y además tendrías que **reconstruir la imagen cada vez que
> rote una credencial**. Separar configuración de código es lo que permite que la
> *misma* imagen sirva para staging y para producción: solo cambia lo que se le
> inyecta al arrancar. Parameter Store guarda esos valores cifrados con KMS y con
> permisos de IAM controlando quién los lee — muy distinto de una variable en
> texto plano, que ve cualquiera con acceso a la consola.

Las claves no van dentro de la imagen ni en texto plano. Van cifradas en
**Systems Manager → Parameter Store** (tier estándar: gratis).

### Cómo se crea cada uno

**Systems Manager** → **Parameter Store** → **Create parameter**:

| Campo | Valor |
|---|---|
| Name | `/creditia/staging/DATABASE_URL` |
| Tier | `Standard` |
| Type | **SecureString** |
| KMS key source | `My current account` → `alias/aws/ssm` |
| Value | el valor pelado, **sin comillas ni espacios finales** |

El prefijo `/creditia/staging/` importa: la política de permisos se apoya en él.

### Los 16 de staging

```
DATABASE_URL                 SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY            GEMINI_API_KEY
RESEND_API_KEY               ZAPSIGN_API_TOKEN
EPAYCO_PUBLIC_KEY            EPAYCO_PRIVATE_KEY
EPAYCO_P_CUST_ID             EPAYCO_P_KEY
EXPERIAN_CLIENT_ID           EXPERIAN_CLIENT_SECRET
EXPERIAN_USERNAME_PN         EXPERIAN_USERNAME_PJ
EXPERIAN_PASSWORD            SENTRY_DSN
```

Los valores salen de `.env.staging`. Notas:

- `DATABASE_URL` debe ser la conexión **pooled** de Supabase (puerto **6543**).
- `DIRECT_URL` **no se carga**: solo la usa Prisma para migraciones, que corren en local.
- `SUPABASE_JWT_SECRET` no existe en este proyecto (usa JWKS), ni
  `EXPERIAN_PASSWORD_PN` / `_PJ`.
- Al pegar `SUPABASE_SERVICE_ROLE_KEY` (JWT de ~219 caracteres) verifica que no
  se cuele un salto de línea.

Para producción, se repite con prefijo `/creditia/prod/` y los valores de `.env`.

---

## Paso 5 — Roles de IAM

> **Por qué este paso.** En AWS nada tiene permisos por defecto: un servicio no
> puede tocar a otro salvo que se lo autorices explícitamente. Un **rol** es una
> identidad prestada —sin contraseña ni llaves fijas— que un servicio *asume* por
> unos minutos para hacer su trabajo. Aquí hacen falta dos autorizaciones que no
> son obvias: ECS necesita permiso para **descargar tu imagen de ECR** y para
> **descifrar los secretos** del paso anterior. Sin este rol, todo lo construido
> hasta ahora existe pero no se puede juntar: la tarea ni siquiera llega a
> arrancar. Es también el paso que más se equivoca, porque hay dos roles
> parecidos y solo uno sirve para leer secretos.

### 5.1 Política de lectura de secretos

**IAM** → **Policies** → **Create policy** → pestaña **JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LeerParametrosStaging",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters"],
      "Resource": "arn:aws:ssm:us-east-1:854847082271:parameter/creditia/staging/*"
    },
    {
      "Sid": "DescifrarSecureString",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "*",
      "Condition": {
        "StringEquals": { "kms:ViaService": "ssm.us-east-1.amazonaws.com" }
      }
    }
  ]
}
```

Nombre: `CreditiaStagingSecretsRead`.

> Si IAM responde *"Invalid characters"* con un nombre que se ve válido, es un
> espacio invisible al final del campo. Escríbelo a mano.

### 5.2 Task execution role

**IAM** → **Roles** → **Create role** → **Custom trust policy**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Adjunta **dos** políticas:
- `AmazonECSTaskExecutionRolePolicy` (descargar imagen de ECR, escribir logs)
- `CreditiaStagingSecretsRead` (leer los parámetros)

Nombre: **`CreditiaEcsExecutionRole`**.

Créalo **antes** del servicio: si el rol no tiene el permiso, la tarea ni
siquiera arranca (`ResourceInitializationError: unable to pull secrets`).

### Por qué este rol y no el "task role"

| Rol | Quién lo usa | Para qué |
|---|---|---|
| **Task execution role** | El agente de ECS, *antes* de arrancar el contenedor | Descargar la imagen, escribir logs y **leer los secretos** |
| **Task role** | Tu código, mientras corre | Llamar a servicios de AWS desde la app (S3, SQS…) |

Los secretos se resuelven antes de que exista tu proceso Node, así que los lee el
execution role. El **task role se deja vacío**: la aplicación no llama a ningún
servicio de AWS.

**Cómo lo ve la app:** ECS descifra los parámetros y los inyecta como variables
de entorno normales. `process.env.DATABASE_URL` funciona igual que en local con
`.env.staging`. No hay que tocar código ni instalar el SDK de AWS.

---

## Paso 6 — Crear el servicio (ECS Express Mode)

> **Por qué este paso.** Es el único paso que realmente *ejecuta* algo: los
> anteriores solo preparaban las piezas. Un contenedor corriendo no basta para
> tener una API pública — hacen falta red, un balanceador que reciba el tráfico,
> un certificado TLS, un mecanismo que detecte tareas caídas y las reemplace, y
> reglas de autoescalado. Montar todo eso a mano en ECS son ~15 recursos
> distintos. **Express Mode** es un atajo oficial: le das imagen, puerto y rol, y
> arma el resto con valores por defecto sensatos, dejándote cambiar solo lo que
> importa. Ese es el papel que cumplía App Runner antes de cerrarse a clientes
> nuevos.

1. **ECS** (`console.aws.amazon.com/ecs/v2`) → menú izquierdo → **Express mode**.

### Let's set up your app

| Campo | Valor |
|---|---|
| Image URI | **Browse ECR images** → `creditia-api` → **Select image by: Image tag** → `latest` |
| Task execution role | `CreditiaEcsExecutionRole` |
| Infrastructure role | **Create new role** |

⚠️ **El campo viene en *Image digest* por defecto y hay que cambiarlo.** AWS lo
recomienda porque un digest (`@sha256:...`) apunta a unos bytes exactos y es
100% reproducible. Pero con digest el servicio corre esa imagen **para siempre**:
el redespliegue automático del Paso 8.2 sería inútil, porque volvería a descargar
lo mismo. Con **tag `latest`**, CodeBuild reapunta la etiqueta en cada build y el
redespliegue toma la versión nueva sin tocar la configuración.

No se pierde trazabilidad: el buildspec también etiqueta cada imagen con el hash
del commit, que es lo que se usa para el rollback (8.4).

Si el servicio ya quedó con digest, se corrige en **Update service** → **Image
URI**, escribiendo la URI a mano:

```
854847082271.dkr.ecr.us-east-1.amazonaws.com/creditia-api:latest
```

### Additional configurations

**Name**: `creditia-api-staging`

**Container:**

| Campo | Valor |
|---|---|
| Container port | `3000` |
| Health check path | `/api/health` |
| Command | vacío |
| Task role | vacío |

- El puerto `3000` es el del `Dockerfile` (`ENV PORT=3000`). Los valores por
  defecto son `80` y `/`: con esos, el balanceador nunca recibe respuesta y mata
  la tarea aunque la app esté sana.
- La ruta lleva `/api` porque `src/main.ts` hace `app.setGlobalPrefix('api')`.
- **Command** muestra `echo,hello world` como texto de ejemplo — es un
  *placeholder*, no un valor. Déjalo vacío para que se use el `CMD` del
  Dockerfile; si escribes algo, lo reemplazas y la app no arranca.
- **Task role** vacío: la app no llama a servicios de AWS. Sus dependencias
  (Supabase, Anthropic, Gemini, Experian, Zapsign, ePayco) son HTTPS con sus
  propias credenciales. No confundirlo con el *execution role*, que sí es
  obligatorio.
- Si dejas **Name** vacío, ECS genera uno como `creditia-api-5a0c`. Funciona
  igual, pero es el nombre que va en el comando de redespliegue del Paso 8.2.

**Compute y Auto scaling:**

| Campo | Valor |
|---|---|
| CPU | `0.5 vCPU` (staging) / `1 vCPU` (producción) |
| Memory | `2 GB` |
| ECS service metric | `Average CPU Utilization` |
| Target value | `60` |
| Minimum number of tasks | `1` |
| **Maximum number of tasks** | **`3`** |

⚠️ El máximo viene en **20** por defecto. Bájalo: un pico de tráfico con 20
tareas es una factura desagradable. Los 2 GB son por Chromium; la CPU baja solo
hace los PDFs más lentos.

**Networking**: sin personalizar (usa la VPC por defecto).
**Logs**: por defecto.

2. **Create**.

AWS crea el clúster `default`, el balanceador, un certificado TLS y devuelve una
**Application URL** con HTTPS.

> Si sale `Invalid Parameter Exception: Unable to assume the service linked role`,
> espera unos segundos y reintenta. Es normal la primera vez.

---

## Paso 7 — Cargar las variables de entorno

> **Por qué este paso.** La imagen no sabe nada del entorno donde corre: ignora a
> qué base de datos conectarse, qué dominio permitir en CORS o si Zapsign está en
> sandbox. Todo eso llega como variables de entorno al arrancar, que es lo que
> hace que **una sola imagen sirva para staging y producción** sin recompilar
> nada. Aquí conviven los dos grupos del Paso 4 —las públicas en texto plano y
> las secretas como referencia a Parameter Store— y es la razón por la que
> tampoco viajan en el `Dockerfile`: si estuvieran ahí, cambiar un dominio
> obligaría a un build completo.

Se pueden agregar al crear el servicio o después con **Update service**:

**ECS** → **Clusters** → `default` → pestaña **Services** → filtro
*Resource management type* = `ECS` → tu servicio (insignia **Express**) →
**Update service**.

Cada fila tiene **Key**, **Value type** y **Value**.

### Value type = `Environment variable` (no son secretos)

```
AI_PROVIDER                               gemini
AI_MAX_TOKENS                             16000
AI_MAX_TOKENS_EXTRACTION                  16000
AI_EXTRACTION_MODEL                       gemini-2.5-pro
GEMINI_MODEL                              gemini-2.5-pro
ANTHROPIC_MODEL                           claude-haiku-4-5-20251001
SUPABASE_URL                              https://bjawxcnsjjobweucxfpf.supabase.co
SUPABASE_STORAGE_BUCKET_AUTHORIZATIONS    customer-authorizations
SUPABASE_STORAGE_BUCKET_PROMISSORY_NOTES  promissory-notes
EXPERIAN_BASE_URL                         https://uat-api.datacredito.com.co
FRONTEND_URL                              https://staging.creditia.co
CORS_ORIGINS                              https://staging.creditia.co
LOGO_URL                                  https://bjawxcnsjjobweucxfpf.supabase.co/storage/v1/object/public/general/creditia-logo.png
SUPPORT_EMAIL                             soporte@creditia.co
EPAYCO_TEST                               true
ZAPSIGN_SANDBOX                           true
ZAPSIGN_CUSTOMER_AUTH_TEMPLATE_ID_PN      186c0137-b0e5-4f90-a3b4-5d48044d2399
ZAPSIGN_CUSTOMER_AUTH_TEMPLATE_ID_PJ      e93a0fb4-15de-4ad6-a769-12a6f5665a2e
ZAPSIGN_PROMISSORY_NOTE_TEMPLATE_ID       cd10b4fb-b124-4c39-a4ec-eb0ccaf0154e
DATA_MIGRATION_VERSION                    v003
SENTRY_ENV                                staging
SENTRY_TRACES_SAMPLE_RATE                 0
SWAGGER_ENABLED                           true
BACKEND_PUBLIC_URL                        <la Application URL de ECS>
```

Notas:
- **Sin comillas**: `gemini`, no `"gemini"`.
- `CORS_ORIGINS` y `SWAGGER_ENABLED` no existen en `.env.staging`, son nuevas
  para el despliegue. Sin `SWAGGER_ENABLED=true`, el `NODE_ENV=production` del
  Dockerfile apaga `/docs`.
- `BACKEND_PUBLIC_URL` es la URL que reciben los webhooks de ePayco y Zapsign.
  Se llena en un segundo update, cuando ECS ya dio la Application URL.
- **No se llevan**: `PORT` y `NODE_ENV` (fijadas en el Dockerfile) ni `DIRECT_URL`.
- `DATA_MIGRATION_VERSION` **no hace falta en el servidor**: solo la usa
  `scripts/apply-data-migrations.js`, que corre desde tu máquina. (De paso: en
  `.env.staging` aparece dos veces, `v001` y `v003`; dotenv se queda con la
  última.)

### Verificar que quedaron cargadas

Es el error más común de este paso: las de texto plano entran y **las de tipo
`Secret` no**, porque el desplegable de la fila se quedó en *Environment
variable*. La app arranca, pero se cae con `supabaseKey is required` o registra
`Credenciales de Experian incompletas`.

**ECS** → **Task definitions** → la familia del servicio → la revisión más
reciente → pestaña **JSON**. Son dos bloques separados:

```json
"environment": [ { "name": "SUPABASE_URL", "value": "https://..." }, ... ],
"secrets":     [ { "name": "DATABASE_URL", "valueFrom": "arn:aws:ssm:..." }, ... ]
```

`"environment"` debe tener 24 entradas y `"secrets"` **16**. Si `"secrets"` sale
`[]`, no se guardaron.

> Ojo también con lo contrario: si una fila secreta queda como *Environment
> variable*, el contenedor recibe el ARN **como texto literal** y el error es más
> confuso — Supabase intentaría autenticarse con la cadena `arn:aws:ssm:...`.

### Value type = `Secret` (el valor es el ARN completo)

```
arn:aws:ssm:us-east-1:854847082271:parameter/creditia/staging/<NOMBRE>
```

Uno por cada uno de los 16 parámetros del Paso 4, con el mismo nombre de
variable que espera la app.

### Qué pasa al guardar

Express Mode usa **despliegue canario**:

1. Crea una revisión nueva de la task definition y levanta tareas nuevas.
2. Les manda **5% del tráfico** y espera 3 minutos vigilando errores 4xx/5xx.
3. Si la tasa de error se mantiene bajo 1%, pasa al **100%**.
4. Tras otros 3 minutos de observación, apaga las tareas viejas.

Si algo falla, **hace rollback solo**. Cuenta 6–10 minutos por actualización;
se sigue en la pestaña **Deployments**.

---

## Paso 8 — Verificar y cerrar pendientes

> **Por qué este paso.** Que ECS diga *Running* solo significa que el proceso
> arrancó y responde el health check; no que la aplicación funcione. Las cosas
> que fallan en un contenedor son justo las que no se prueban solas: que Chromium
> tenga memoria suficiente, que los buckets sean accesibles, que los webhooks
> lleguen a la URL correcta. Y un despliegue que no es repetible es un despliegue
> que se degrada: sin el redespliegue automático dependes de acordarte, y sin
> tags por commit no hay rollback posible. Este paso convierte "lo levanté" en
> "puedo volver a levantarlo, y volver atrás si sale mal".

### Dónde mirar cuando algo falla

En orden, de lo más útil a lo más rebuscado:

1. **CloudWatch Logs** — es lo único que persiste. **CloudWatch** → **Logs** →
   **Log groups** → el grupo `/aws/ecs/<cluster>/<servicio>` (el nombre exacto
   está en la task definition, en `logConfiguration.options.awslogs-group`) → el
   stream más reciente.

   Si el grupo **no tiene ningún stream**, el contenedor nunca llegó a
   ejecutarse: el problema es de secretos o del pull de la imagen, no de la app.

2. **Eventos del servicio** — pestaña **Events** del servicio. Es el log del
   orquestador: aquí salen los mensajes de colocación de tareas y de health
   checks fallidos.

3. **La tarea detenida** — pestaña **Tasks** con filtro *Desired status:
   Stopped* → **Stopped reason** y el `exit code` del contenedor. **ECS purga las
   tareas detenidas al cabo de un rato**, así que puede que ya no esté.

4. **Reproducirlo en vivo** — **Update service** sin cambiar nada, y ve de
   inmediato a **Tasks** con filtro *Any* para abrir la tarea mientras existe.

**Los exit codes dicen mucho:**

| Código | Significa |
|---|---|
| `1` | Error de la aplicación. En este proyecto es literalmente el `process.exit(1)` de `src/main.ts`; busca en los logs la línea **`Fallo al arrancar`**, que trae el mensaje real justo antes del stack trace. |
| `137` | Lo mató el kernel por falta de memoria (OOM). Sube la RAM. |
| `143` | `SIGTERM` — apagado normal durante un despliegue, no es un error. |

### 8.1 Pruebas, en orden

1. `https://<application-url>/api/health` → arrancó.
2. `https://<application-url>/docs` → Nest cargó todos los módulos.
3. **Generar un PDF** → la prueba que de verdad importa: confirma que
   `chrome-headless-shell` quedó bien en la imagen y que 2 GB le alcanzan.
4. Un endpoint autenticado con un token de Supabase válido.

### 8.2 Redespliegue automático desde CodeBuild

A diferencia de App Runner, **Express Mode no redespliega solo** cuando llega una
imagen nueva a ECR. Para automatizarlo:

1. Agrega al final del `post_build` del buildspec:

```yaml
      - aws ecs update-service --cluster default --service creditia-api-staging --force-new-deployment
```

2. Dale permiso al rol de CodeBuild: **IAM** → `codebuild-creditia-api-build-service-role`
   → **Add permissions** → **Create inline policy** → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ecs:UpdateService", "ecs:DescribeServices"],
      "Resource": "*"
    }
  ]
}
```

3. Opcional: en CodeBuild activa **Rebuild every time a code change is pushed**
   para que cada push a `staging` dispare el ciclo completo.

### 8.3 Ciclo de trabajo

```
1. npm run migrate:check          # revisar drift local / staging / prod
2. npm run prisma:migrate:deploy  # migraciones ANTES del código
3. push a staging                 # CodeBuild construye y sube
4. ECS despliega en canario       # ~6-10 min
5. verificar /api/health y logs
```

Las migraciones van **antes** del despliegue y conviene que sean compatibles
hacia atrás (agregar columnas antes de usarlas, no borrar en el mismo paso).

### 8.4 Rollback

El buildspec etiqueta cada imagen con el hash del commit justamente para esto:

**Update service** → **Image URI** → *Select image by: Image tag* → elige el tag
del commit bueno (ej. `32a972e`) → **Update**. Cuando tengas la corrección,
vuelves a `latest`.

### 8.5 Dominio propio

Una vez estable, apunta `api-staging.creditia.co` al balanceador y actualiza
`CORS_ORIGINS`, `FRONTEND_URL` y `BACKEND_PUBLIC_URL`.

> Errores de CORS: casi siempre una barra final (`https://app.com/`) o `http` vs
> `https`. El valor debe coincidir exacto con el `Origin` del navegador.

### 8.6 Producción

Es mecánico, mismos pasos:

- Parámetros con prefijo `/creditia/prod/` y valores de `.env`.
- Una política `CreditiaProdSecretsRead` y un `CreditiaEcsExecutionRoleProd`.
- Proyecto de CodeBuild apuntando a la rama `main`.
- Servicio `creditia-api-prod` con **1 vCPU / 2 GB** y `SWAGGER_ENABLED=false`.
- Migraciones con `npm run prisma:migrate:pro`.

---

## Costos

| Concepto | Aprox. mensual |
|---|---|
| Fargate 0.5 vCPU / 2 GB, 1 tarea 24/7 | ~$21 |
| Balanceador de aplicación (ALB) | ~$17 |
| ECR + CodeBuild + logs | ~$2–4 |
| **Total staging** | **~$40** |

Verifica las tarifas vigentes en la calculadora de AWS. Para bajar el gasto:
borrar el servicio de staging cuando no se use (el ALB se cobra por hora exista
tráfico o no) y poner retención de 30 días en **CloudWatch → Log groups**, que
por defecto guardan para siempre.

**Para desmontar todo**, en este orden: servicio ECS (borra también el ALB),
proyecto CodeBuild, imágenes y repositorio ECR, parámetros de SSM, roles de IAM.

---

## Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| CodeBuild: `Cannot connect to the Docker daemon` | Falta marcar **Privileged** en Environment. |
| CodeBuild: `denied: ... ecr:PutImage` | Falta `AmazonEC2ContainerRegistryPowerUser` en su rol (3.4). |
| CodeBuild no lista los repositorios | La conexión quedó en `Pending`: falta *Install a new app* (3.1), o la app de GitHub no tiene acceso a ese repo. |
| ECR: `ImageTagAlreadyExistsException` | El repositorio quedó *Immutable*. Debe ser **Mutable**. |
| ECS: `ResourceInitializationError: unable to pull secrets` | El execution role no tiene `CreditiaStagingSecretsRead`, o un ARN está mal escrito. |
| ECS: tarea en bucle de reinicio | La app no arranca. Revisa CloudWatch: casi siempre una variable faltante. |
| `Error: supabaseKey is required` (o `supabaseUrl is required`) | Las variables de tipo `Secret` no quedaron en la task definition (`"secrets": []`). Ver *Verificar que quedaron cargadas* en el Paso 7. `SupabaseService` usa `!` en el constructor, así que no valida nada y revienta al instanciar. |
| `Credenciales de Experian incompletas` en el arranque | Mismo origen: faltan los secretos `EXPERIAN_*`. Es un warning, no tumba la app, pero la integración con la central no funciona. |
| `TypeError: Invalid URL` al arrancar | Un valor se copió **con comillas**. En `.env` van entrecomillados y dotenv las quita; la consola de AWS no. Se guarda el valor pelado. |
| `deployment failed: tasks failed to start` + `No rollback candidate was found` | Normal cuando el servicio **nunca** tuvo una versión sana: no hay a dónde volver. Corrige la causa y vuelve a desplegar. |
| `PrismaClientInitializationError` | `DATABASE_URL` mal copiada. Debe ser la **pooled** (puerto 6543). |
| Health check falla siempre | Port `3000` y path `/api/health`; si quedaron en `80` y `/`, corrígelos. |
| PDFs con `Target closed` / `Navigation timeout` | Falta memoria. Sube a 3–4 GB. |
| Cambié un secreto y la app sigue con el viejo | Los secretos se leen al arrancar la tarea. Fuerza un **Update service**. |
| IAM: *Invalid characters* en un nombre válido | Un espacio invisible al final del campo. Escríbelo a mano. |
| Un servicio no aparece / no se deja crear | Región equivocada, o la cuenta sigue en **Free Plan** (upgrade solo desde root). |
