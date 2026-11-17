# Integration tests

These run the real Express app and services against a real Postgres, with Clerk,
the recipe scraper and the Python ingredient parser mocked. They seed two
households and check that a member of one can't read or change the other's data
through any route (`household-scoping.test.ts`).

They need a **local, throwaway** database whose name ends in `_test`; the suite
refuses anything else, because it deletes every row before each test.

```bash
# a Postgres in memory (nothing written to disk), removed when stopped
docker run -d --rm --name soupi-it-db --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=it -e POSTGRES_DB=soupi_test -p 127.0.0.1:55432:5432 postgres:17-alpine

DATABASE_URL=postgresql://postgres:it@127.0.0.1:55432/soupi_test npm run test:integration

docker stop soupi-it-db
```

CI runs them against a Postgres service container.
