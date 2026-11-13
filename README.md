# soupi

The backend API for **sous** — a collaborative household cooking app (recipes,
meal planning, pantry inventory, and shopping lists) with real-time sync.

## Stack

- **Express 5** + **TypeScript**
- **Prisma 6** over **PostgreSQL** (currently Prisma Postgres + Accelerate; see
  [Deployment](#deployment))
- **Clerk** (`@clerk/express`) for auth — every data route is scoped to a household
- **Zod** for request validation, **Pino** for logging
- **Puppeteer** (headless Chromium) for recipe scraping from URLs
- **Python NLP parser** for structured ingredient parsing (`python/`)
- **OpenAI** to structure recipes scraped from URLs (recipe import)
- Real-time updates via **Server-Sent Events** (`/events/:householdId`)

## Getting started

Requires Node (see `.nvmrc`), PostgreSQL access, and Python 3 for the parser.

```bash
nvm use                       # Node 22
npm ci
cp .env.example .env          # fill in DB, Clerk, OpenAI keys (see below)

# Python NLP parser
python3 -m venv python/venv
python/venv/bin/pip install -r python/requirements.txt

# Database
npx prisma generate
npx prisma migrate deploy     # or `prisma migrate dev` while iterating on schema
npm run dev                   # http://localhost:8080
```

Health check: `GET /health` → `{ "db": "ok", "status": "ok" }`.

## Environment

All variables are documented in [`.env.example`](./.env.example) and validated
at startup by `src/env.ts` (the server refuses to boot if a required one is
missing). Key ones: `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY`,
`OPENAI_API_KEY`, `NLP_PYTHON_PATH`/`NLP_PARSER_PATH`, `PORT`, `LOG_LEVEL`,
`CORS_ORIGINS`.

## Scripts

| Script                            | Purpose                                   |
| --------------------------------- | ----------------------------------------- |
| `npm run dev`                     | Dev server with reload (`ts-node-dev`)    |
| `npm run build`                   | Compile TypeScript to `dist/`             |
| `npm start` / `npm run dist`      | Run via `ts-node` / from compiled `dist/` |
| `npm test`                        | Unit tests (Vitest)                       |
| `npm run lint` / `npm run format` | ESLint / Prettier                         |
| `npm run migrate`                 | `prisma migrate deploy`                   |
| `npm run studio`                  | Prisma Studio                             |
| `npm run db:reset`                | Reset DB + re-run migrations + seed       |
| `npx prisma db seed`              | Seed a household for `SEED_USER_ID`       |

## Architecture

```
src/
  app.ts          Express app: middleware (cors, clerk, rate limit, pino) + routes
  server.ts       Boot + listen
  env.ts          Zod-validated environment
  routes/         Thin HTTP layer (user, household, recipe, pantry, category,
                  shopping-list, plan, events, health, docs, meta)
  services/       Business logic + Prisma access
  middleware/     require-auth, with-household, centralized error handler (handle)
  schemas/        Zod request schemas
utils/            logger (pino), sse (in-memory per-household broadcast), constants
prisma/           Modular schema (prisma/schema/) + seed
python/           NLP ingredient parser (parser.py) + scraper helpers
tests/            Vitest unit tests
```

Requests are authenticated by Clerk, scoped to a household by `with-household`,
validated with Zod, and handled by services that own all DB access. Mutations
broadcast SSE events to connected household members. API docs (Swagger UI) are
served at `/docs`.

## Deployment

Self-hosted on a Debian server as a Docker Compose stack — **PostgreSQL + API +
Cloudflare Tunnel** — with isolated `dev` and `prod` stacks (own database, Clerk
keys, and tunnel). The API connects to Postgres directly (no Prisma Accelerate).

```bash
cp .env.deploy.example .env.dev     # fill in; likewise .env.prod
npm run deploy dev                  # or: docker compose --env-file .env.dev up -d --build
```

See **[DEPLOY.md](./DEPLOY.md)** for the full runbook (provisioning, the one-time
data migration off Prisma Postgres, Cloudflare ingress, and operations).
