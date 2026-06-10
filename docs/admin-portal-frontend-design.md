# Diseño Frontend — Portal de Administración (Creditia)

> **Estado:** propuesta de diseño. El portal admin es una **aplicación Angular
> separada** de la app cliente, que consume el mismo backend NestJS vía los
> endpoints `/api/admin/*`. Acompaña a `admin-portal-backend-design.md`.

---

## 1. Por qué un proyecto Angular separado

- **Seguridad:** el código del portal admin (que gestiona TODAS las empresas) nunca
  se sirve al navegador de un cliente. Un guard de Angular es UI, no seguridad real;
  separar las apps reduce la superficie de ataque.
- **Despliegue independiente:** se publica en un subdominio interno
  (ej. `admin.creditia...`), con su propio ciclo de release; un cambio en el portal
  no afecta producción de clientes.
- **Simplicidad:** cada app tiene rutas, navegación y permisos propios, sin
  condicionales "si es admin muestra esto".

**El backend es uno solo.** Dos frontends, una API. La autorización real vive en el
`AdminGuard` de `/api/admin/*`.

---

## 2. Stack y arranque

- **Angular** (misma versión mayor que la app cliente para reuso de conocimiento).
- **Auth:** Supabase Auth JS (mismo proyecto Supabase que la app cliente). El usuario
  que entra debe ser super-admin (validado en el backend; el front solo muestra error
  si el backend responde 403).
- **HTTP:** `HttpClient` con un interceptor que agrega `Authorization: Bearer <token>`
  de Supabase a cada request.
- **Base URL del API:** misma API que la app cliente, rutas `/api/admin/*`.
  Configurable por `environment.ts` (`apiUrl`).

### CORS

El backend lee orígenes de `CORS_ORIGINS`. Hay que **agregar el origen del portal**
(ej. `http://localhost:4300` en dev, `https://admin.creditia...` en prod) a esa
variable de entorno del backend. Sin esto, el portal no puede llamar a la API.

---

## 3. Autenticación y guardas (lado front)

1. **Login** con Supabase (email/clave del equipo Creditia).
2. Tras login, el front guarda la sesión y agrega el token a las llamadas.
3. **Guard de ruta** (`authGuard`): si no hay sesión Supabase → redirige a login.
4. **Autorización real:** la decide el backend. Si un usuario logueado NO es
   super-admin, las llamadas a `/api/admin/*` devuelven **403** y el front muestra
   "No autorizado". (No se confía en el front para esto.)
5. Opcional producción: restringir el portal por IP/VPN además del login.

> El front NO implementa lógica de permisos de negocio; solo refleja lo que el
> backend permite.

---

## 4. Cómo el front consume el backend

Un **servicio Angular por dominio**, que llama a los endpoints `/api/admin/*`:

| Servicio Angular | Endpoints que consume |
|------------------|------------------------|
| `AdminClientsService` | `POST /admin/clients/onboard`, `GET /admin/clients`, `GET /admin/clients/:id`, `GET /admin/clients/:id/usage`, `GET /admin/clients/:id/contract-summary` |
| `AdminSubscriptionService` | `POST /admin/companies/:id/subscription/change-tier`, `PATCH /admin/companies/:id/suspend` |
| `AdminCompanyService` | `PATCH /admin/companies/:id`, `POST /admin/companies/:id/invitations/resend` |
| `AdminPaymentsService` | `POST /admin/companies/:id/payments/link`, `POST /admin/companies/:id/payments` |

Modelos/interfaces TypeScript: como es repo separado, se **duplican** los DTOs
mínimos necesarios (no compartir librería hasta que duela). Mantener nombres
alineados con el backend (`OnboardClientDto`, `ChangeTierDto`, etc.).

---

## 5. Pantallas

### 5.1 Login
- Formulario Supabase (email/clave).
- Manejo de error de credenciales y de "no autorizado" (403 del backend).

### 5.2 Dashboard / Home
- Resumen: nº de clientes activos, estudios consumidos en el período (agregado),
  contratos por vencer pronto, invitaciones pendientes.
- Accesos rápidos: "Nuevo cliente", "Ver clientes".

### 5.3 Listado de clientes (`/clients`)
Consume `GET /admin/clients`.
- Tabla: empresa (nombre/NIT), nivel vigente (estudios/mes), consumo del ciclo
  (X/Y), vigencia (fin de contrato), estado (activo/suspendido).
- Filtros: búsqueda por nombre/NIT, estado.
- Acción principal: **"Nuevo cliente"** (abre el wizard de onboarding).
- Click en fila → detalle del cliente.

### 5.4 Onboarding de cliente (`/clients/new`) — la pantalla clave
Consume `POST /admin/clients/onboard` (operación atómica).
Formulario (puede ser un wizard de 1-3 pasos o un solo formulario):
- **Datos de la empresa:** nombre, NIT, sector, departamento, ciudad, dirección.
- **Facturación** (para trazabilidad de pagos): nombre, documento, email, teléfono.
- **Contrato/Suscripción:** nivel (estudios/mes), fecha inicio, fecha fin
  (autocompletar +1 año).
- **Dueño:** email del contacto que recibirá la invitación.
- Al enviar: una sola llamada; si éxito, muestra confirmación con el estado de la
  invitación (enviada a X email) y opción de copiar/reenviar el link.

### 5.5 Detalle de cliente (`/clients/:id`)
Consume `GET /admin/clients/:id`, `.../usage`, `.../contract-summary`.
Secciones:
- **Resumen:** empresa, estado, vigencia, nivel vigente.
- **Consumo del ciclo:** barra X/Y estudios del mes actual.
- **Resumen del contrato (anual):** total comprometido (recálculo Σ tramos),
  historial de tramos (cada cambio de nivel con sus fechas).
- **Usuarios de la empresa:** lista (dueño + colaboradores), estado.
- **Invitaciones:** estado de la invitación del dueño; botón "Reenviar".
- **Acciones:**
  - **Cambiar nivel** (modal) → `POST .../subscription/change-tier`.
  - **Editar empresa/facturación** → `PATCH /admin/companies/:id`.
  - **Suspender/Reactivar** → `PATCH .../suspend`.
  - **Pagos:** generar link de pago / registrar pago (trazabilidad).

### 5.6 Cambiar nivel (modal desde el detalle)
- Input del nuevo nivel (estudios/mes).
- Aviso: "El cambio es inmediato y reinicia el ciclo de consumo del mes."
- Confirmar → llamada → refresca el detalle.

### 5.7 Pagos del cliente (sección dentro del detalle)
Consume `AdminPaymentsService`.
- **Generar link de pago:** monto + concepto → genera link ePayco → mostrar/copiar
  para enviar al cliente.
- **Registrar pago:** registrar manualmente una referencia recibida (monto, fecha,
  ref ePayco) → aparece en el historial de pagos.
- Historial de pagos del cliente (trazabilidad).

### 5.8 (Opcional) Gestión de super-admins
Si se usa la tabla `platform_admins`: pantalla para listar/agregar/desactivar
miembros del equipo con acceso al portal. Baja prioridad.

---

## 6. Estructura sugerida del proyecto Angular

```
admin-portal/
  src/app/
    core/
      auth/            # servicio Supabase, authGuard, interceptor de token
      http/            # base API service / interceptors de error (403, etc.)
    shared/            # componentes UI reutilizables (tabla, modal, badges de estado)
    features/
      auth/            # login
      dashboard/
      clients/
        list/          # 5.3
        onboard/       # 5.4
        detail/        # 5.5 (+ modales 5.6, sección 5.7)
      admins/          # 5.8 (opcional)
    models/            # interfaces alineadas con DTOs del backend
  src/environments/    # apiUrl, supabase keys
```

---

## 7. Manejo de estados y errores

- **403 (no super-admin):** pantalla/aviso "No tienes acceso al portal".
- **Errores de validación (400):** mostrar mensajes del backend (el backend usa
  validación i18n).
- **Onboarding atómico:** si falla, el backend no deja datos a medias; el front
  muestra el error y permite reintentar sin crear duplicados.
- **Estados visuales:** badges para estado de suscripción (activo, suspendido,
  superseded no se muestra como "baja"), consumo (verde/amarillo/rojo según % usado),
  vigencia próxima a vencer.

---

## 8. Checklist de construcción

- [ ] Crear proyecto Angular separado (`admin-portal`).
- [ ] Configurar Supabase Auth + interceptor de token.
- [ ] `authGuard` + manejo de 403.
- [ ] `environment` con `apiUrl` y keys.
- [ ] Agregar origen del portal a `CORS_ORIGINS` del backend.
- [ ] Servicios HTTP por dominio (clients, subscription, company, payments).
- [ ] Pantallas: login, dashboard, listado, onboarding, detalle, modales de nivel y pagos.
- [ ] Modelos TS alineados con los DTOs del backend.
- [ ] Despliegue en subdominio interno.

---

## 9. Dependencias del backend

Este portal **no puede construirse hasta** que existan los endpoints `/api/admin/*`
del documento de backend. Orden recomendado:
1. Backend: `AdminModule`, `AdminGuard`, onboarding, change-tier, listados.
2. Frontend: login + listado + onboarding (MVP), luego detalle y pagos.
