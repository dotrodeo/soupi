# soupi

Backend API for **Sous**, a shared household cooking app (recipes, meal plan, pantry,
shopping list) with live sync between household members. The only client is the
**sous-web** PWA (`dotrodeo/sous-web`). The native iOS app (`sous-swift`) is retired,
so don't keep API shapes around just for it.

## Stack

Express 5 + TypeScript, Prisma 6 on Postgres 17, Clerk auth, Zod validation, Pino
logging, Vitest. Recipe import loads pages with Puppeteer (system Chromium in the
image, presenting as regular Chrome because many recipe sites refuse headless
browsers) and reads them with rules; OpenAI is only a fallback, used when
`OPENAI_API_KEY` is set. A Python parser (`python/`) splits each saved ingredient
line into amount, unit and item.

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
- `src/middleware/handle.ts`: wraps handlers, maps errors to responses: a
  `NotFoundError` (`src/middleware/errors.ts`) or Prisma's P2025 becomes 404,
  anything else 500.
- `prisma/schema/*.prisma`: modular schema; migrations in `prisma/schema/migrations/`.
- `src/services/scraper.ts` + `src/services/import/`: recipe import. `parsePage()`
  tries pure parsers in order: schema.org JSON-LD, microdata, the post's
  "Ingredients"/"Directions" headings (`headings.ts` + `lines.ts`; an "Optional:"
  section marks lines optional, links go to `notes` when there are no steps), and
  for TikTok/Instagram the `og:description` caption (`caption.ts`). Only when they
  all find nothing does `scrapeRecipe()` ask the AI. Test parsers with sample HTML
  in `tests/unit/services/import.test.ts`; the orchestration (AI gating, link
  following) is tested with puppeteer and `ai` mocked in `scraper.test.ts`.
- Meals (`services/meal.ts`, sous-web#67): planned meals that aren't recipes, a name
  plus `MealItem`s pointing at pantry items (with `optional`). They sit on plan days
  through `PlanDay.meals`. Made or taken off the plan they're kept (the client offers
  them again); `DELETE` soft-deletes. "Made" for recipes and meals shares
  `applyPantryUsage()` (`services/pantry-usage.ts`).
- Ingredients have an `optional` flag. Recipe saves take each ingredient as a plain
  line or `{ sentence, optional }`; a plain line is optional when it says
  "optional" (`toIngredientRow()` in `services/recipe.ts`).
- `utils/`: logger, SSE, join codes, dates, constants.
- `tests/unit/`: Vitest with a mocked Prisma (`tests/mocks/prisma.ts`) and mocked
  broadcast (`tests/mocks/broadcast.ts`).
- `tests/integration/`: the real app against a real Postgres (see its README).
  `household-scoping.test.ts` seeds two households and calls every route as one
  household's member with the other's ids. **A new route that takes a household's
  ids gets a row there**: 403 for the other household in the path, 404 for its ids
  under your own household, and the other household's data must be unchanged.

Conventions: soft deletes via `deletedAt` (filter them out in reads), done by `DELETE`
routes — upsert schemas don't accept `deletedAt`, and Zod would silently drop it. Scope
every lookup by a client-sent id to the household (`pantry: { householdId }` or
equivalent), and throw `NotFoundError` (404) when it isn't found, so another
household's id looks the same as a missing one. ESLint with
`perfectionist` (sorted keys and imports), Prettier with 4-space indent.

## Checks

```bash
npx prisma generate      # after schema changes, before tsc/tests
npm run format:check
npm run lint
npm run build            # tsc
npm run typecheck        # tsc over tests, seed and src
npm test
# integration: a local throwaway Postgres, see tests/integration/README.md
DATABASE_URL=postgresql://postgres:it@127.0.0.1:55432/soupi_test npm run test:integration
```

CI runs the same steps on every PR and on pushes to `main`, with a Postgres service
container for the integration tests.

## Workflow

`main` is protected: every change goes through a pull request, CI (`Lint, Build & Test`) must
pass, and the branch must be up to date with `main`. The rules apply to admins too,
so pushing to `main` directly is rejected.

1. Branch off `origin/main` (in a worktree, not the deploy checkout), commit, push,
   and open a PR. Every prod deploy is a release: if the PR will be deployed, bump
   `version` in `package.json` (semver) in the same PR, with
   `npm version <x.y.z> --no-git-tag-version` so the lockfile matches.
2. When CI passes, merge it with a merge commit and delete the branch. If `main`
   moved in the meantime, run `gh pr update-branch <n> --rebase` and wait for CI
   again.
3. Release: tag the merge commit and publish it:
   `git tag vX.Y.Z <merge-sha> && git push origin vX.Y.Z && gh release create vX.Y.Z --generate-notes`.
4. Deploy: `git pull --ff-only` in the deploy checkout, then follow
   [Deploy](#deploy): dev first, verify, then prod.

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
- After the prod build, tag the image with the release version:
  `docker tag soupi:prod soupi:X.Y.Z`. Keep the last three version images and
  `docker rmi` older ones. Don't version-tag dev images.
- Roll back by pointing `prod` at the previous version's image:
  `docker tag soupi:<prev> soupi:prod && docker compose --env-file .env.prod up -d api`.
- `pg_dump` the prod DB before a deploy that includes a migration.
- Verify: `curl 127.0.0.1:<API_PORT>/health` → `{"db":"ok","status":"ok"}`, check
  the logs for the migration lines, and confirm an unauthenticated request to a
  data route returns 401 through the public hostname.
- `.env.*` files hold secrets. Never print or commit them.
