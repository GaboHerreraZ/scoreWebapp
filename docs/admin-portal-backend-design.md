# Diseño Backend — Portal de Administración (Creditia)

> **Estado:** propuesta de diseño. Implementación **aditiva**: se agrega lo nuevo sin
> tocar lo que funciona hoy. La limpieza de lo que quede obsoleto (suscripción
> self-service, ePayco recurrente) se hará en una fase posterior, separada.

---

## 1. Contexto y decisiones

El modelo de negocio cambia de **planes self-service empaquetados** (5/20/50/100)
a un **modelo de cuota configurada por contrato**, gestionado por el equipo comercial:

- **Producto único:** acceso PRO completo (todo el `Subscription` al máximo).
- **Variable de venta:** estudios/mes (el "nivel").
- **Vigencia:** anual.
- **Cobro:** por fuera (el comercial factura). ePayco se conserva **solo** para
  enviar links de pago manuales y registrar referencias (trazabilidad), NO para
  suscripciones recurrentes automáticas.
- **Onboarding:** asistido. El admin crea la empresa + suscripción + invitación en
  una sola operación atómica; el cliente recibe un link, se autentica y encuentra
  todo configurado.

### Decisiones de diseño ya tomadas

| Tema | Decisión |
|------|----------|
| Modelo nuevo vs. planes actuales | **Reemplaza** el self-service; ePayco solo para links/trazabilidad |
| Estrategia de implementación | **Aditiva**: nuevo primero, limpieza después |
| Frontend del portal | **Proyecto Angular separado** (ver doc de frontend) |
| Backend | **El mismo** NestJS; se agregan endpoints `/admin/*` |
| Cambio de nivel | Cerrar registro `CompanySubscription` actual + abrir uno nuevo |
| Estado del registro reemplazado | Nuevo estado `superseded` (distinto de `cancelled`) |
| Cambio de nivel — vigencia | **Inmediato**; el ciclo de consumo se reinicia con el nuevo registro |
| Rol del usuario dueño | Nuevo rol `owner` (hoy el alta asigna `administrator`/`assistant`) |
| Onboarding | **Operación atómica** (todo o nada) |

---

## 2. Lo que ya existe (NO se toca)

Resumen del estado actual relevante (para no duplicar ni romper):

- **Auth:** `SupabaseAuthGuard` global (`app.module.ts`, `APP_GUARD`). Solo valida el
  token de Supabase y setea `request.user = { id, email }`. **No maneja roles.**
  `@Public()` exime endpoints.
- **Prefijo global:** `/api` (`main.ts`).
- **CORS:** configurable por env `CORS_ORIGINS` (comma-separated), default
  `http://localhost:4200`. **No requiere cambio de código** para el portal admin,
  solo agregar su origen a la variable.
- **Roles:** viven en `parameters` con `type = 'user_company_role'`
  (`administrator`, `invitado`, `assistant`). Se chequean a nivel de servicio.
- **Estados de suscripción:** `parameters` con `type = 'subscription_status'`
  (`active`, `cancelled`, `rejected`, `pending`).
- **Empresas:** `CompaniesService.create()` crea la empresa y, vía
  `createWithUserCompany()`, asocia al usuario actual como `administrator`.
- **Suscripciones:** `CompanySubscriptionsService` maneja `subscribe-free`,
  `subscribe` (ePayco), `change-plan`, `cancel`, y el webhook `handleEpaycoConfirmation`.
  El consumo del ciclo se cuenta con `countCurrentCycleByType` (relativo a `startDate`).
  La suscripción vigente se identifica por `isCurrent = true`.
- **Invitaciones:** `InvitationsService.create()` (invita a empresa existente) y
  `acceptAndRegister()` (registro público con token). Hoy el aceptado queda como
  `assistant`.

---

## 3. Cambios de datos (mínimos)

### 3.1 Nuevos parámetros (seed, tabla `parameters`)

| type | code | Uso |
|------|------|-----|
| `subscription_status` | `superseded` | Registro de suscripción reemplazado por cambio de nivel (NO es baja) |
| `user_company_role` | `owner` | Dueño/responsable de la empresa cliente (alta por onboarding) |
| `parameter` (o el type que uses para roles de plataforma) | `super_admin` | Rol global del equipo Creditia para el portal admin |

> El `super_admin` NO es un `user_company_role` (no pertenece a una empresa). Ver
> sección 4 sobre cómo se modela la identidad del super-admin.

### 3.2 `CompanySubscription` — agrupar tramos (contractId)

Para recalcular el **compromiso anual** cuando hay cambios de nivel, los registros
(tramos) de un mismo contrato deben poder agruparse. Hoy no hay forma de saber que
dos registros son "el mismo contrato partido".

**Propuesta:** agregar `contractId` (UUID, nullable) a `CompanySubscription`. Todos
los tramos de un mismo contrato comparten `contractId`. El primer registro genera el
`contractId`; cada cambio de nivel crea un registro nuevo con el mismo `contractId`.

```prisma
// Agregar a CompanySubscription
contractId  String?  @map("contract_id") @db.Uuid  // agrupa tramos del mismo contrato anual
```

> Nullable para no afectar registros existentes. Los nuevos contratos del portal
> admin siempre lo setean.

### 3.3 (Opcional) Auditoría de quién configura

Para trazabilidad del portal admin, considerar `configuredBy` (UUID del super-admin)
en `CompanySubscription`. Opcional; se puede inferir del log. **No bloqueante.**

---

## 4. Autorización del super-admin

El guard actual no distingue roles. Se necesita una capa nueva **solo para `/admin/*`**,
sin tocar el guard global.

### Opción elegida: rol super-admin en el mismo backend

**Identidad del super-admin (DECIDIDO):** tabla **`platform_admins`** con
`{ userId, email, isActive, createdAt }`. El `userId` es el de Supabase Auth. Es
explícita, consultable, auditable y gestionable desde el portal. NO se usan claims de
Supabase. El login reusa el **mismo** Supabase Auth; el acceso al portal lo determina
estar presente y activo en `platform_admins`.

```prisma
model PlatformAdmin {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @unique @map("user_id") @db.Uuid  // Supabase auth.users
  email     String   @db.VarChar(255)
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("platform_admins")
}
```

### Mecanismo

1. **`AdminGuard`** (nuevo): se ejecuta después del `SupabaseAuthGuard` (que ya validó
   el token y puso `request.user`). Verifica que `request.user.id` esté en
   `platform_admins` (o tenga el claim). Si no, `ForbiddenException`.
2. Se aplica a nivel de **controller** en cada controller `/admin/*` (con
   `@UseGuards(AdminGuard)`), NO como guard global.
3. Opcional: decorator `@SuperAdmin()` para legibilidad.

```
Request -> SupabaseAuthGuard (global, valida token) -> AdminGuard (solo /admin/*) -> handler
```

---

## 5. Endpoints nuevos (`/api/admin/*`)

Todos bajo el prefijo global `/api`, protegidos por `SupabaseAuthGuard` + `AdminGuard`.
Agrupados en un módulo nuevo **`AdminModule`** que importa los servicios existentes
(`CompaniesService`, `CompanySubscriptionsService`, `InvitationsService`,
`ParametersService`) y orquesta. **No reimplementa** lógica: reusa.

### 5.1 Onboarding de cliente (operación atómica)

**`POST /api/admin/clients/onboard`**

Crea empresa + suscripción PRO con nivel + invitación al dueño, todo o nada
(transacción). Devuelve el cliente creado y el estado de la invitación.

Request:
```jsonc
{
  "company": {
    "name": "Acme S.A.",
    "nit": "900123456-7",
    "sectorId": 12,
    "state": "Antioquia",
    "city": "Medellín",
    "address": "Calle 1 #2-3",
    // facturación (opcional, para trazabilidad de los links de pago)
    "billingName": "...", "billingLastName": "...", "billingDocNumber": "...",
    "billingEmail": "...", "billingPhone": "..."
  },
  "subscription": {
    "studiesPerMonth": 10,          // el "nivel" -> maxStudiesPerMonthOverride
    "startDate": "2026-06-08",      // inicio del contrato anual
    "endDate": "2027-06-08"         // fin (startDate + 1 año)
  },
  "owner": {
    "email": "dueño@acme.com"       // recibe el link de invitación
  }
}
```

Flujo interno (en una transacción):
1. Validar NIT único (reusa validación de `CompaniesService`).
2. Crear `Company` (sin asociar usuario todavía — el dueño llega por invitación).
3. Crear `CompanySubscription`:
   - `subscriptionId` = plan PRO único (ver 5.4)
   - `maxStudiesPerMonthOverride` = `studiesPerMonth`
   - `startDate`, `endDate`
   - `isCurrent = true`, `status = active`, `autoRenew = false`
   - `contractId` = nuevo UUID
4. Crear `Invitation` para `owner.email` con rol `owner`, token + expiración.
5. Enviar email con el link (reusa el envío actual de invitaciones).

Response `201`:
```jsonc
{
  "company": { "id": "...", "name": "...", "nit": "..." },
  "subscription": { "id": "...", "studiesPerMonth": 10, "startDate": "...", "endDate": "...", "contractId": "..." },
  "invitation": { "id": "...", "email": "...", "status": "pending", "expiresAt": "..." }
}
```

> **Rol `owner` en `accept-register` (DECIDIDO):** se modifica `acceptAndRegister()`
> para **respetar el `roleId` que trae la invitación** en vez de forzar `assistant`.
> La invitación ya almacena un `roleId`; el onboarding la crea con rol `owner`, las
> invitaciones normales conservan su rol. Cambio acotado, con cuidado de no alterar el
> comportamiento del flujo de invitación de colaboradores (que debe seguir resultando
> en su rol habitual).

### 5.2 Gestión de suscripción / cambio de nivel

**`POST /api/admin/companies/:companyId/subscription/change-tier`**

Cambia el nivel mensual (ej. 5 → 10). Inmediato; reinicia ciclo.

Request:
```jsonc
{ "studiesPerMonth": 10 }
```

Flujo interno (transacción):
1. Buscar `CompanySubscription` vigente (`isCurrent = true`).
2. Marcar vieja: `endDate = hoy`, `isCurrent = false`, `status = superseded`.
3. Crear nueva: `startDate = hoy`, `endDate = endDate del contrato`,
   `maxStudiesPerMonthOverride = studiesPerMonth`, `isCurrent = true`,
   `status = active`, **mismo `contractId`**.
4. El consumo se cuenta contra el `startDate` del registro nuevo → ciclo reiniciado.

Response: la nueva suscripción vigente.

**`POST /api/admin/companies/:companyId/subscription/recharge`** (opcional, fase 2)

Si más adelante quieres recargas puntuales (estudios extra sin cambiar de nivel).
Por ahora la "recarga" = `change-tier` a un nivel mayor.

### 5.3 Consulta y administración

| Método | Ruta | Uso |
|--------|------|-----|
| GET | `/api/admin/clients` | Listar todas las empresas (cross-tenant) con su nivel, consumo del ciclo, vigencia, estado. Paginado + filtros (search, estado). |
| GET | `/api/admin/clients/:companyId` | Detalle de un cliente: empresa, suscripción vigente, consumo, historial de tramos (por `contractId`), usuarios, invitaciones. |
| GET | `/api/admin/clients/:companyId/usage` | Consumo del ciclo actual (estudios usados / cupo) — reusa `countCurrentCycleByType`. |
| GET | `/api/admin/clients/:companyId/contract-summary` | Recálculo anual: total comprometido = Σ (meses por tramo × nivel). Ver sección 6. |
| PATCH | `/api/admin/companies/:companyId` | Editar datos de la empresa / facturación. |
| POST | `/api/admin/companies/:companyId/invitations/resend` | Reenviar invitación al dueño (reusa Invitation). |
| PATCH | `/api/admin/companies/:companyId/suspend` | Suspender/reactivar acceso (estado de la suscripción). |

### 5.4 Plan PRO único

Se crea **una** fila `Subscription` "PRO" con todos los límites al máximo
(`maxUsers`, `maxCompanies`, `excelReports = true`, `emailNotifications = true`,
`themeCustomization = true`, dashboard y support en nivel PRO). `maxStudiesPerMonth`
del plan puede quedar como referencia/null; el cupo real lo da el
`maxStudiesPerMonthOverride` por empresa.

- Seed vía migración de datos (o un endpoint admin `POST /api/admin/subscriptions/pro`
  ejecutado una vez).
- El onboarding siempre referencia este plan.

### 5.5 ePayco — links de pago manuales (trazabilidad)

ePayco deja de crear suscripciones recurrentes en este flujo. Se conserva para:

- **`POST /api/admin/companies/:companyId/payments/link`** — generar un link de pago
  ePayco para un monto/concepto, enviarlo al cliente.
- **`POST /api/admin/companies/:companyId/payments`** — registrar manualmente una
  referencia de pago recibida (monto, fecha, referencia ePayco) en `PaymentHistory`
  para trazabilidad.
- El webhook existente `handleEpaycoConfirmation` puede reusarse/adaptarse para
  registrar confirmaciones de estos links (a evaluar; no romper el actual).

> Detalle de la API de links de ePayco a definir en implementación según lo que
> ofrezca su SDK (link de cobro / checkout). Esto es secundario al onboarding.

---

## 6. Recálculo anual (compromiso) — `contract-summary`

Con `contractId` agrupando los tramos:

```
tramos = CompanySubscription where contractId = X order by startDate
totalComprometido = Σ  mesesEntre(tramo.startDate, tramo.endDate) × tramo.maxStudiesPerMonthOverride
nivelVigente      = tramo where isCurrent = true -> maxStudiesPerMonthOverride
consumoCicloActual = countCurrentCycleByType(...) contra startDate del tramo vigente
```

**Política de redondeo (DECIDIDO):** **mes completo al nivel nuevo** desde el cambio.
El mes en que ocurre el cambio cuenta completo al nivel nuevo (sin prorrateo por día).
Coherente con el reinicio de ciclo y simple para la factura del comercial.

Ejemplo (cambio el 15-abr de 5/mes a 10/mes, contrato ene–dic):
- ene, feb, mar, abr → contaban a 5, pero **abr pasa completo al nivel nuevo**:
  ene–mar (3 meses × 5 = 15) + abr–dic (9 meses × 10 = 90) = **105**.

> El "mes" se alinea al ciclo relativo a `startDate` (igual que `countCurrentCycleByType`).

---

## 7. Estructura de módulos nueva

```
src/admin/
  admin.module.ts            # importa CompaniesModule, CompanySubscriptionsModule,
                             # InvitationsModule, ParametersModule
  admin.controller.ts        # /admin/* (o varios controllers por dominio)
  admin.service.ts           # orquesta onboarding atómico, change-tier, summaries
  guards/admin.guard.ts      # verifica super-admin (platform_admins)
  decorators/super-admin.decorator.ts
  dto/
    onboard-client.dto.ts
    change-tier.dto.ts
    ...
```

`AdminModule` **no** reimplementa lógica: inyecta y orquesta los services existentes.
La transacción del onboarding vive en `admin.service.ts` (o se delega a un método
transaccional en los repositorios reusados).

---

## 8. Resumen de cambios (checklist de implementación)

**Datos:**
- [ ] Seed parámetros: `subscription_status/superseded`, `user_company_role/owner`.
- [ ] Migración: `contractId` en `CompanySubscription` (nullable).
- [ ] Migración: tabla `platform_admins` + seed inicial (tu usuario del equipo).
- [ ] Seed: plan `Subscription` "PRO" único.

**Backend:**
- [ ] `AdminModule` + `AdminGuard` + decorator.
- [ ] `POST /admin/clients/onboard` (atómico).
- [ ] `POST /admin/companies/:id/subscription/change-tier`.
- [ ] GET de listado/detalle/usage/contract-summary.
- [ ] PATCH editar empresa / suspend / resend invitation.
- [ ] Endpoints ePayco link/registro de pago (trazabilidad).
- [ ] Ajuste en `acceptAndRegister` para respetar el `roleId` de la invitación (owner).

**Config:**
- [ ] Agregar origen del portal admin a `CORS_ORIGINS`.

**Fase posterior (limpieza, NO ahora):**
- [ ] Deprecar/retirar `subscribe`, `change-plan`, `subscribe-free` self-service.
- [ ] Retirar lógica de suscripción recurrente ePayco si ya no se usa.

---

## 9. Decisiones resueltas

1. **Identidad super-admin:** tabla **`platform_admins`** (`{ userId, email, isActive,
   createdAt }`). El `AdminGuard` hace lookup por `request.user.id`. Gestionable desde
   el portal. NO se usan claims de Supabase.
2. **Rol `owner`:** `acceptAndRegister` se modifica para **respetar el `roleId` que
   trae la invitación** en vez de forzar `assistant`. Una invitación con rol `owner`
   crea un owner; las invitaciones normales mantienen su rol. (Cambio acotado: usar el
   `roleId` ya almacenado en el registro de invitación.)
3. **Redondeo de meses (recálculo anual):** **mes completo al nivel nuevo** desde el
   cambio. Sin prorrateo por día. Coherente con el reinicio de ciclo y la facturación.
4. **Login super-admin:** **mismo Supabase Auth**; el acceso al portal lo determina
   estar en `platform_admins`. Sin infraestructura de auth nueva.
5. **ePayco (links de cobro):** alcance a definir en implementación según el SDK; es
   secundario al onboarding y no bloquea el MVP.
