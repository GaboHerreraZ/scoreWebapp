# CLAUDE.md - Project Context for AI Assistants

## Project Overview

NestJS REST API for a **credit study management system** with multi-tenancy, role-based access, and Supabase authentication.

## Tech Stack

- **Runtime**: Node.js with ESM modules (`"type": "module"`)
- **Framework**: NestJS 11
- **Language**: TypeScript 5.7 (target ES2023, module NodeNext)
- **ORM**: Prisma 7 with custom client output at `./generated/prisma/`
- **Database**: PostgreSQL via Supabase (pooled connection on port 6543, direct on 5432)
- **Authentication**: Supabase Auth (Bearer token, global guard)
- **Validation**: class-validator + class-transformer
- **Documentation**: Swagger/OpenAPI at `/docs`
- **Testing**: Jest 30 + Supertest
- **Linting**: ESLint 9 (flat config) + Prettier

## Project Structure

```
src/
├── main.ts                      # Entry point (port 3000, prefix /api, CORS localhost:4200)
├── app.module.ts                # Root module, global guard & config
├── auth/                        # Supabase auth guard + service
│   ├── supabase.service.ts
│   └── guards/supabase-auth.guard.ts
├── common/
│   ├── decorators/public.decorator.ts   # @Public() bypasses auth
│   └── dto/pagination.dto.ts            # Base PaginationDto (page, limit, search)
├── prisma/                      # PrismaService (connection lifecycle)
├── parameters/                  # Master key-value lookup table (roles, sectors, statuses)
├── subscriptions/               # Subscription plans (maxUsers, maxCompanies, etc.)
├── companies/                   # Company management
├── profiles/                    # User profiles (extends Supabase auth.users)
├── user-companies/              # User ↔ Company association (roles, invitations)
├── customers/                   # Customer management per company
└── credit-studies/              # Credit study financial analysis (50+ fields)
```

## Architecture Pattern

Every module follows: **Controller → Service → Repository**

- **Controller**: HTTP handling, Swagger decorators, DTO validation, ParseUUIDPipe/ParseIntPipe
- **Service**: Business logic, uniqueness checks, error handling (NotFoundException, ConflictException)
- **Repository**: Direct Prisma queries, CRUD, includes, helper methods
- **DTOs**: `create-*.dto.ts`, `update-*.dto.ts` (PartialType), `filter-*.dto.ts` (extends PaginationDto)

## Database Models (Prisma)

| Model | PK Type | Table Name | Key Relations |
|-------|---------|------------|---------------|
| Parameter | Int (auto) | parameters | Self-referencing hierarchy, used as lookup by many models |
| Profile | UUID (from Supabase) | profiles | → role (Parameter), → userCompanies, → invitedUsers |
| Subscription | UUID | subscriptions | → companies |
| Company | UUID | companies | → subscription, → sector (Parameter), → userCompanies |
| UserCompany | UUID | user_companies | → user (Profile), → company, → role (Parameter), → invitedByUser (Profile). Unique on [userId, companyId] |
| Customer | UUID | customers | → company, → personType (Parameter), → createdBy/updatedBy (Profile) |
| CreditStudy | UUID | credit_studies | → customer, → company, → status (Parameter), → incomeStatement (Parameter), → createdBy/updatedBy (Profile) |

## Key Conventions

- **Imports**: Use `.js` extension for local imports (ESM requirement)
- **Prisma types**: Use `Prisma.*UncheckedCreateInput`, `Prisma.*WhereInput`, `Prisma.*OrderByWithRelationInput`
- **Prisma client**: Import from `../../generated/prisma/client.js`
- **Soft deletes**: `isActive` boolean field (no Prisma middleware)
- **Audit fields**: `createdAt`, `updatedAt` on all models; `createdBy`, `updatedBy` on Customer and CreditStudy
- **UUID PKs**: All models except Parameter (Int autoincrement)
- **Global validation**: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- **Auth bypass**: Use `@Public()` decorator on routes that don't require authentication

## Common Commands

```bash
npm run start:dev          # Development with watch mode
npm run build              # Build project
npm run lint               # ESLint + fix
npm run prisma:generate    # Regenerate Prisma client
npm run prisma:migrate:dev # Run migrations in dev
npm run prisma:studio      # Open Prisma Studio
npm run test               # Run unit tests
npm run test:e2e           # Run e2e tests
```

## Environment Variables

- `DATABASE_URL` — Pooled Supabase PostgreSQL connection (PgBouncer, port 6543)
- `DIRECT_URL` — Direct PostgreSQL connection (port 5432, used for migrations)
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key
- `PORT` — Server port (default 3000)
- `AI_MAX_TOKENS` — Output limit for the credit-study narrative analysis
- `AI_MAX_TOKENS_EXTRACTION` — Output limit for PDF extraction (data + reliability flags)

## Migrations & Environments

There are **two separate Supabase projects**, mapped by env file:

| Env file | Supabase project | Region | Used by |
|----------|------------------|--------|---------|
| `.env.staging` | `bjawxcnsjjobweucxfpf` | us-east-2 | **STAGING** — `npm run start:dev`, `prisma:migrate:*` scripts |
| `.env` / `.env.pro` | `rggavdujvohqxfgjzuyd` | us-east-1 | **PRODUCTION** — `start:pro`, `*:pro` scripts |

**CRITICAL:** Never run `npx prisma ...` directly. `prisma.config.ts` loads `.env` by
default = **PRODUCTION**, so a bare `npx prisma migrate ...` applies changes to prod.
Always use the npm scripts (they prepend the correct `dotenv -e`). `prisma.config.ts`
prints a banner showing which environment a command targets (⚠️ yellow for PROD).

**Migration workflow (no shadow DB):** Supabase has no free shadow database, so the
standard `migrate dev` is avoided (it tries to reset). Instead:

```bash
npm run prisma:migrate:create   # migrate dev --create-only on staging: generates SQL, no apply
# review the generated SQL, then:
npm run prisma:migrate:deploy   # applies pending migrations to STAGING
npm run prisma:migrate:pro      # applies pending migrations to PRODUCTION
npm run prisma:migrate:status   # check status (staging)
npm run migrate:check           # compare local vs staging vs prod, flag drift/duplicates
```

After applying via the pooled connection, **restart the app** (`start:dev`) so the
Prisma connection pool refreshes its cached schema — otherwise you get P2022
"column does not exist" on a column that actually exists.

**Note:** the `_data_migrations` table is intentional (it backs the custom data
migration system, see `DATA_MIGRATION_VERSION` and `scripts/apply-data-migrations.js`).
It is NOT managed by Prisma and showing up in `migrate diff` is expected — not drift.
