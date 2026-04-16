# WebApp API

REST API for a credit study management system built with NestJS, Prisma, and Supabase.

## Tech Stack

- **Framework**: NestJS 11
- **Language**: TypeScript 5.7 (ESM modules)
- **ORM**: Prisma 7
- **Database**: PostgreSQL (Supabase)
- **Authentication**: Supabase Auth
- **Documentation**: Swagger/OpenAPI

## Environments

The project uses two environments managed via separate `.env` files:

| Environment | Env file | Purpose |
|-------------|----------|---------|
| **Staging** | `.env.staging` | Development and testing — default for all dev commands |
| **Production** | `.env` | Production Supabase project — only used with `:pro` commands |

Environment switching is handled by `dotenv-cli`. All commands **default to staging** to prevent accidental changes in production.

## Local Development

### Prerequisites

- Node.js 18+
- npm
- PostgreSQL database (via Supabase — one project per environment)

### Setup

```bash
# Install dependencies
npm install

# Configure environment files
# .env           → Production Supabase credentials
# .env.staging   → Staging Supabase credentials

# Generate Prisma client
npm run prisma:generate

# Run migrations (applies to staging by default)
npm run prisma:migrate:deploy

# Start development server (staging)
npm run start:dev
```

The API will be available at `http://localhost:3000/api` and Swagger docs at `http://localhost:3000/docs`.

### Scripts

#### Application

| Script | Environment | Description |
|--------|-------------|-------------|
| `npm run start:dev` | Staging | Development server with watch mode |
| `npm run start:debug` | Staging | Debug server with watch mode |
| `npm run start:pro` | Production | Development server pointing to production |
| `npm run start:prod` | — | Start built production server (`node dist/`) |
| `npm run build` | — | Build the project |
| `npm run build:prod` | — | Full production build (prisma generate + build + migrate) |
| `npm run lint` | — | ESLint + fix |
| `npm run test` | — | Run unit tests |
| `npm run test:e2e` | — | Run e2e tests |

#### Prisma (Staging — default)

| Script | Description |
|--------|-------------|
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run prisma:migrate:dev` | Run migrations interactively |
| `npm run prisma:migrate:create` | Create migration without applying |
| `npm run prisma:migrate:deploy` | Apply pending migrations |
| `npm run prisma:migrate:status` | Check migration status |
| `npm run prisma:studio` | Open Prisma Studio |

#### Prisma (Production)

| Script | Description |
|--------|-------------|
| `npm run prisma:migrate:pro` | Apply pending migrations to production |
| `npm run prisma:studio:pro` | Open Prisma Studio for production |

#### Data Migrations

Versioned SQL scripts for data changes (inserts, updates, resets) that should
run on both staging and production. Tracked in the `_data_migrations` table so
each script runs only once per environment.

| Script | Description |
|--------|-------------|
| `npm run data:apply` | Apply data migrations to staging (uses `.env.staging`) |
| `npm run data:apply:pro` | Apply data migrations to production (uses `.env`) |

Scripts live in [prisma/data/](prisma/data/) grouped by version folder
(`vNNN/`). Inside each folder, files are prefixed with an execution order
number (`01_`, `02_`, ...) so they run in the intended sequence. Example:

```
prisma/data/
└── v001/
    ├── 01_reset_parameters.sql
    └── 02_reset_subscriptions.sql
```

**The version to apply is read from the `DATA_MIGRATION_VERSION` env var**
(defined in `.env` and `.env.staging`). The runner only applies pending
scripts from that single version folder — already-applied scripts are skipped.
This means you control which version to deploy by editing the env var.

When releasing a new version:
1. Create folder `prisma/data/v002/` with the new SQL scripts
2. Update `DATA_MIGRATION_VERSION="v002"` in `.env.staging` (and later in `.env`)
3. Run `npm run data:apply` (staging) → validate → `npm run data:apply:pro` (production)

**When to use data-migrations vs. Prisma migrations**
- **Prisma migrations** → structural changes (tables, columns, indexes, FKs)
- **data-migrations** → data-only changes (seeds, resets, catalog updates,
  backfills) that need to run across environments

## Environment Variables

Both `.env` and `.env.staging` share the same variables. Only `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` differ between environments — the rest (API keys, config) are shared.

| Variable | Description | Differs per env |
|----------|-------------|-----------------|
| `DATABASE_URL` | Pooled Supabase PostgreSQL connection (port 6543) | Yes |
| `DIRECT_URL` | Direct PostgreSQL connection (port 5432, for migrations) | Yes |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes |
| `ANTHROPIC_API_KEY` | Anthropic API key for AI analysis | No |
| `ANTHROPIC_MODEL` | Claude model to use | No |
| `ANTHROPIC_MAX_TOKENS` | Max tokens for AI responses | No |
| `RESEND_API_KEY` | Resend email API key | No |
| `DOCUSEAL_API_URL` | DocuSeal API URL | No |
| `DOCUSEAL_API_KEY` | DocuSeal API key | No |
| `DOCUSEAL_PROMISSORY_TEMPLATE_ID` | DocuSeal template ID for promissory notes | No |
| `DOCUSEAL_WEBHOOK_SECRET` | DocuSeal webhook secret | No |
| `SUPABASE_STORAGE_BUCKET_PROMISSORY` | Storage bucket name for promissory notes | No |
| `WOMPI_INTEGRITY_KEY` | Wompi payment integrity key | No |
| `WOMPI_EVENTS_KEY` | Wompi webhook events key | No |
| `FRONTEND_URL` | Frontend URL for CORS and emails | No |
| `PORT` | Server port (default: `3000`) | No |

## Database - Prisma Migrations

### Adding columns without affecting existing data

1. **Modify the schema** (`prisma/schema.prisma`) - new fields must be optional (`?`) or have a default value (`@default`)
2. **Create migration without applying**: `npm run prisma:migrate:create -- --name description`
3. **Review** the generated SQL in `prisma/migrations/`
4. **Apply**: `npm run prisma:migrate:dev` (dev) or `npm run prisma:migrate:deploy` (prod)
5. **Regenerate client**: `npm run prisma:generate`

Quick single command in dev: `npm run prisma:migrate:dev -- --name description`

## Deployment (Railway)

### Railway Service Configuration

| Setting | Value |
|---------|-------|
| **Install Command** | `npm install --include=dev` |
| **Build Command** | `npm run build:prod` |
| **Start Command** | `npm run start:prod` |

> Railway omits devDependencies by default. The install command with `--include=dev` ensures that `typescript`, `@nestjs/cli`, and `prisma` are available during the build step.

### Railway Environment Variables

Configure these in **Railway > Service > Variables**:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Supabase pooled connection string (port 6543) |
| `DIRECT_URL` | Supabase direct connection string (port 5432) |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key from Supabase dashboard |
| `WOMPI_INTEGRITY_KEY` | Wompi integrity key |
| `WOMPI_EVENTS_KEY` | Wompi events key |
| `CORS_ORIGINS` | Frontend URL(s) separated by comma, e.g. `https://myapp.com,http://localhost:4200` |

### Deploy Steps

1. Create a new project in [railway.app](https://railway.app)
2. Connect your GitHub repository
3. Configure the install, build, and start commands as shown above
4. Add all environment variables
5. Deploy

### Post-Deployment Verification

- API: `https://<your-app>.up.railway.app/api`
- Swagger Docs: `https://<your-app>.up.railway.app/docs`

### CORS

CORS is configured via the `CORS_ORIGINS` environment variable. Set it to your frontend URL(s) separated by commas. If not set, it defaults to `http://localhost:4200`.

```
CORS_ORIGINS=https://myapp.vercel.app,http://localhost:4200
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| `nest: not found` during build | Ensure install command is `npm install --include=dev` |
| `Cannot find module '/app/dist/main'` | The entry point is `dist/src/main.js`, already configured in `start:prod` |
| CORS errors (`status 0 undefined`) | Verify `CORS_ORIGINS` matches your frontend URL exactly (no trailing slash) |
| Prisma migration fails | Verify `DIRECT_URL` points to port 5432 (direct connection, not pooled) |
