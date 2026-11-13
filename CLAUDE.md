# soupi

Backend API for **Sous**, a shared household cooking app (recipes, meal plan, pantry,
shopping list) with live sync between household members. The only client is the
**sous-web** PWA (`dotrodeo/sous-web`). The native iOS app (`sous-swift`) is retired,
so don't keep API shapes around just for it.

## Stack

Express 5 + TypeScript, Prisma 6 on Postgres 17, Clerk auth, Zod validation, Pino
logging, Vitest. Recipe import uses Puppeteer (system Chromium in the image) plus a
Python ingredient parser (`python/`). `/ai` routes call OpenAI.

## Layout

- `src/routes/`: thin HTTP layer. Each data route is
  `/household/:householdId/...` behind `requireAuth()` + `withHousehold()`, which
  checks that the Clerk user is a household member.
- `src/services/`: business logic and every Prisma call. Mutations wrap their write
  in `broadcast(householdId, type, from, cb)` (`utils/sse.ts`), which pushes an SSE
  event to the household's open `/events/:householdId` streams. The broadcaster and
  the rate limiters are in-memory, so run a single instance per environment.
- `src/schemas/index.ts`: Zod request schemas. `z.object` **strips unknown keys**,
  so a field the client sends but the schema lacks is silently dropped (no 400).
  When you add a column, add it to the schema too.
- `src/middleware/handle.ts`: wraps handlers, maps errors to responses.
- `prisma/schema/*.prisma`: modular schema; migrations in `prisma/schema/migrations/`.
- `utils/`: logger, SSE, join codes, dates, AI helpers.
- `tests/unit/`: Vitest with a mocked Prisma (`tests/mocks/prisma.ts`) and mocked
  broadcast (`tests/mocks/broadcast.ts`). There are no DB integration tests.

Conventions: soft deletes via `deletedAt` (filter them out in reads), ESLint with
`perfectionist` (sorted keys and imports), Prettier with 4-space indent.

## Checks

```bash
npx prisma generate      # after schema changes, before tsc/tests
npm run format:check
npm run lint
npm run build            # tsc
npm run typecheck        # tsc over tests, seed and src
npm test
```

CI runs the same steps on pushes and PRs to `main`.

## Schema changes

Create migrations against a throwaway Postgres, never a shared database:
`npx prisma migrate dev --name <name>` with `DATABASE_URL` pointing at a scratch
container. The container entrypoint runs `prisma migrate deploy` on start
(`RUN_MIGRATIONS=true`), so a deploy applies pending migrations automatically.
Prefer additive migrations (new nullable columns): the previous image keeps working
against the new schema, which keeps rollback a simple image swap.

## Deploy

Docker Compose, one stack per environment: `soupi-dev` and `soupi-prod`, each with
`db` (Postgres), `api` and `tunnel` (cloudflared). Container names are
`soupi_<env>_{db,api,tunnel}`.

- Pass `--env-file .env.dev` or `--env-file .env.prod` on **every** `docker compose`
  command. Without it Compose falls back to `dev` and empty Postgres credentials.
- Rebuild only the API: `docker compose --env-file .env.<env> up -d --build api`.
  Avoid `npm run deploy`, which runs `up -d --build` for the whole stack.
- Before a prod deploy, tag the current image so it can be rolled back
  (`docker tag soupi:prod soupi:prod-pre-<change>`), and `pg_dump` the prod DB if
  the deploy includes a migration.
- Verify: `curl 127.0.0.1:<API_PORT>/health` → `{"db":"ok","status":"ok"}`, check
  the logs for the migration lines, and confirm an unauthenticated request to a
  data route returns 401 through the public hostname.
- `.env.*` files hold secrets. Never print or commit them.
