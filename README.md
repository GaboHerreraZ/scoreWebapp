# WebApp API

REST API for a credit study management system built with NestJS, Prisma, and Supabase.

## Tech Stack

- **Framework**: NestJS 11
- **Language**: TypeScript 5.7 (ESM modules)
- **ORM**: Prisma 7
- **Database**: PostgreSQL (Supabase)
- **Authentication**: Supabase Auth
- **Documentation**: Swagger/OpenAPI

## Local Development

### Prerequisites

- Node.js 18+
- npm
- PostgreSQL database (via Supabase)

### Setup

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Fill in the values in .env

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate:dev

# Start development server
npm run start:dev
```

The API will be available at `http://localhost:3000/api` and Swagger docs at `http://localhost:3000/docs`.

### Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Development with watch mode |
| `npm run build` | Build the project |
| `npm run start:prod` | Start production server |
| `npm run build:prod` | Full production build (prisma generate + build + migrate) |
| `npm run lint` | ESLint + fix |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run e2e tests |
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run prisma:migrate:dev` | Run migrations in dev |
| `npm run prisma:migrate:create` | Create migration without applying |
| `npm run prisma:migrate:deploy` | Apply pending migrations (production) |
| `npm run prisma:studio` | Open Prisma Studio |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Pooled Supabase PostgreSQL connection (port 6543) | Yes |
| `DIRECT_URL` | Direct PostgreSQL connection (port 5432, used for migrations) | Yes |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes |
| `WOMPI_INTEGRITY_KEY` | Wompi payment integrity key | Yes |
| `WOMPI_EVENTS_KEY` | Wompi webhook events key | Yes |
| `CORS_ORIGINS` | Allowed origins separated by comma (default: `http://localhost:4200`) | No |
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
