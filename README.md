# soupi

The API server for **Sous**, a cooking app for households. Members share one recipe
box, meal plan, pantry and shopping list, and changes show up on everyone's devices
as they happen. The web app is [sous-web](https://github.com/dotrodeo/sous-web).

soupi stores the household's data in Postgres, handles sign-in through
[Clerk](https://clerk.com), imports recipes from web pages, and streams changes to
connected clients.

## Features

- **Households.** Signing up creates a household with a pantry and a default set of
  categories. Other people join it with the household's join code.
- **Recipes.** Create, edit and delete recipes with per-household tags and ratings,
  and track when each was last made. Marking a recipe as made can mark the pantry
  items it used up as out of stock, and removes it from the meal plan.
- **Recipe import.** Given a URL, soupi loads the page in headless Chromium, reads
  its structured recipe data (or the post caption, for TikTok and Instagram), and has
  an OpenAI model turn that into a recipe. A Python parser
  ([ingredient-parser-nlp](https://pypi.org/project/ingredient-parser-nlp/)) splits
  each ingredient line into amount, unit and item.
- **Pantry and shopping list.** Items with a category, stock status, staple flag,
  quantity and expiration date. The shopping list is the items flagged for it.
- **Meal plan.** Dated plan days holding recipes.
- **Live updates.** Every change is pushed to the household's open
  `/events/:householdId` Server-Sent Events streams.

API documentation (Swagger UI) is served at `/docs`. `GET /health` reports database
connectivity.

## Stack

Node 22, Express 5, TypeScript, Prisma 6, PostgreSQL 17, Clerk, Zod, Pino, Puppeteer,
Python 3, Vitest.

## Run it locally

You need Node 22, Python 3, a Postgres database, a Clerk application and an OpenAI
API key (see [Configuration](#configuration)).

```bash
npm ci                                   # also downloads Chromium for Puppeteer
python3 -m venv python/venv
python/venv/bin/pip install -r python/requirements.txt

cp .env.example .env                     # fill in the values
npx prisma generate
npx prisma migrate deploy
npm run dev                              # http://localhost:8080
```

To start with sample data, set `SEED_USER_ID` to your Clerk user ID and run
`npx prisma db seed`.

Point a local [sous-web](https://github.com/dotrodeo/sous-web) at
`http://localhost:8080` to use the app.

## Configuration

Environment variables are validated at startup; the server won't start without the
required ones.

| Variable                                    | Required | Description                                                                                             |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | yes      | Postgres connection string.                                                                             |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | yes      | Keys from your Clerk application. sous-web must use the same application.                               |
| `OPENAI_API_KEY`                            | yes      | Used by recipe import.                                                                                  |
| `NLP_PYTHON_PATH`, `NLP_PARSER_PATH`        | yes\*    | Python interpreter and `python/parser.py`. \*The server starts without them, but saving a recipe fails. |
| `CORS_ORIGINS`                              | no       | Comma-separated origins allowed to call the API, such as your sous-web URL. Unset allows any origin.    |
| `PORT`, `HOST`                              | no       | Listen address. Defaults: `3000` and `0.0.0.0`. `.env.example` and the Docker image use `8080`.         |
| `LOG_LEVEL`                                 | no       | `fatal`, `error`, `warn`, `info` (default), `debug` or `trace`.                                         |
| `RUN_MIGRATIONS`                            | no       | Docker image only. `true` (default) runs `prisma migrate deploy` before the server starts.              |

**Clerk:** sous-web signs users in with an email and password, verified by an
emailed code, so enable those in your Clerk application. Development keys
(`pk_test_…`) work locally; a production Clerk instance is tied to your own domain.

## Self-hosting

`docker-compose.yml` runs three services: `db` (Postgres 17), `api` (this server)
and `tunnel` (an optional
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)).
One env file defines one environment, and container, volume and network names are
suffixed with its `ENV`, so several environments (say `dev` and `prod`) can run on
one host.

1. Copy the template and fill it in:

    ```bash
    cp .env.deploy.example .env.prod
    ```

    Set `ENV=prod`, the `POSTGRES_*` credentials, a `DATABASE_URL` that matches them
    (host `db`), your Clerk and OpenAI keys, `CORS_ORIGINS` (your sous-web URL), and
    `API_PORT` (the host port, bound to `127.0.0.1`).

2. Start it. Pass `--env-file` on **every** `docker compose` command; without it
   Compose falls back to `dev` with empty database credentials.

    ```bash
    docker compose --env-file .env.prod up -d --build          # with the tunnel
    docker compose --env-file .env.prod up -d --build db api   # without it
    ```

    The API container applies database migrations when it starts.

3. Give the API a public HTTPS URL. The browser calls it directly. Either:
    - set `TUNNEL_TOKEN` to a Cloudflare Tunnel token and route the tunnel's public
      hostname to `http://soupi_<ENV>_api:8080`, or
    - put your own reverse proxy in front of `127.0.0.1:<API_PORT>`.

4. Check it:

    ```bash
    curl http://127.0.0.1:<API_PORT>/health    # {"db":"ok","status":"ok"}
    docker compose --env-file .env.prod logs -f api
    ```

Then deploy [sous-web](https://github.com/dotrodeo/sous-web) with this API's public
URL.

**Updating:** `git pull`, then rebuild only the API:
`docker compose --env-file .env.prod up -d --build api`.

**Backups:** the database is in the `soupi_<ENV>_pgdata` volume. Dump it with:

```bash
docker exec soupi_prod_db pg_dump -U <POSTGRES_USER> -d <POSTGRES_DB> > soupi.sql
```

Run one API instance per environment: rate limits and live-update connections are
held in memory.

## Development

| Command                                | What it does           |
| -------------------------------------- | ---------------------- |
| `npm run dev`                          | Dev server with reload |
| `npm run build`                        | Compile to `dist/`     |
| `npm test`                             | Unit tests (Vitest)    |
| `npm run lint`, `npm run format`       | ESLint, Prettier       |
| `npx prisma migrate dev --name <name>` | Create a migration     |
| `npm run studio`                       | Browse the database    |

```
src/routes/       HTTP layer: auth, household access check, request validation
src/services/     Business logic and all database access
src/schemas/      Zod request schemas
src/middleware/   Auth, household membership, error handling
prisma/schema/    Data model (one file per model) and migrations
python/           Ingredient parser and scraper helpers
utils/            Logging, live-update broadcaster, constants
tests/unit/       Vitest tests with a mocked Prisma client
```

Data routes live under `/household/:householdId/…` and require a Clerk session token
belonging to a member of that household. Request bodies are validated with Zod, which
drops fields the schema doesn't list. Records are soft-deleted (`deletedAt`).
