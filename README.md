# Operator Data Migration Agent

A **separate, loosely-coupled** service that migrates operator data (products,
bookings, travelers, guides, qualifications, staffing rules) into the UNI
operator platform. This milestone is the **Spreadsheet MVP**: upload a CSV/XLSX,
normalize it into a canonical domain, review and resolve issues, then preview /
commit / rollback the import into the platform.

The service owns its **own database and job queue** and never writes platform
tables directly — every platform mutation goes through a narrow, typed
`PublisherPort` (explicit publish actions only).

- Out of scope this milestone: browser agent, booking-email ingestion, direct
  integrations.
- The real platform import client is **not built yet**; publishing runs against
  a deterministic **stub** (`OperatorImportStubPublisher`). The seam is designed
  so the real HTTP client drops in without touching orchestration.

---

## Table of contents

- [Architecture](#architecture)
- [Pipeline & batch lifecycle](#pipeline--batch-lifecycle)
- [Tech stack](#tech-stack)
- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [Running the service](#running-the-service)
- [API reference](#api-reference)
- [End-to-end walkthrough](#end-to-end-walkthrough)
- [Spreadsheet mapping](#spreadsheet-mapping)
- [Testing](#testing)
- [Observability](#observability)
- [Runbook](#runbook)
- [Project structure](#project-structure)
- [Roadmap](#roadmap)

---

## Architecture

Layered **ports-and-adapters** design. Dependencies point inward: API →
application services → domain; infrastructure (Prisma, pg-boss, parsers,
publisher) is reached only through interfaces.

```
API (Fastify)            routes · Zod validation · service-to-service auth
        │
Application services     SessionService · IngestService · PipelineService
        │                ReviewService · PublishService
        │
Domain (pure)            canonical schemas · normalization · matching · publish actions
        │
Ports                    SourceConnector · PublisherPort · ArtifactStore · JobQueue
        │
Infrastructure           Prisma repos · pg-boss · CSV/XLSX parsers ·
                         local-fs ArtifactStore · OperatorImport publisher STUB
```

**Loose-coupling guarantees**

- Own Postgres DB and own job queue (pg-boss lives in the same DB, separate
  schema). No shared schema with the platform.
- The only outbound contact with the platform is `PublisherPort` — a narrow set
  of explicit typed actions (`CREATE` / `UPDATE` / `LINK` / `DEACTIVATE`).
- External entity links are stored as opaque `externalId` strings; there are no
  foreign keys into platform tables.

---

## Pipeline & batch lifecycle

A single uploaded file becomes an **ImportBatch** that flows through these
stages (async stages run on pg-boss workers):

```
upload ──> EXTRACTED ──(normalize)──> NORMALIZED ──(match)──> MATCHED
                                                                │
                                          ┌─────────────────────┤
                                   open review items?      no open items
                                          │                     │
                                       IN_REVIEW ──(resolve)──> READY
                                                                │
                                              preview ──> PREVIEWED
                                                                │
                                               commit ──> COMMITTED ──(rollback)──> ROLLED_BACK
```

Any stage failure moves the batch to **FAILED** with a structured error. The
`BatchStatus` enum also defines transient `*ING` states (EXTRACTING,
NORMALIZING, MATCHING, COMMITTING, ROLLING_BACK) used while a stage is running.

**Entity types**: `PRODUCT`, `BOOKING`, `TRAVELER`, `GUIDE`, `QUALIFICATION`,
`STAFFING_RULE`. All persist into one generic `CanonicalRecord` table
(discriminated by `entityType`, with the body validated in code via per-entity
Zod schemas, plus promoted match-key columns for indexing).

---

## Tech stack

- **Node 20+**, TypeScript (ESM, strict)
- **Fastify** (HTTP) + **Zod** (validation)
- **Postgres** + **Prisma** (ORM + migrations)
- **pg-boss** (job queue, same Postgres DB)
- **exceljs** / **csv-parse** (spreadsheet parsing)
- **pino** (structured logging), **Vitest** (tests)

---

## Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Create your env file
cp .env.example .env
#    (edit SERVICE_AUTH_TOKEN; the defaults work with the bundled Postgres)

# 3. Start Postgres (Docker)
docker compose up -d

# 4. Apply database migrations
npm run prisma:migrate     # or: npx prisma migrate deploy

# 5. Run the service (API + worker)
npm run dev
```

The API listens on `http://localhost:3001`. Check it:

```bash
curl -s localhost:3001/health
# {"status":"ok","service":"operator-data-migration-agent"}
```

---

## Configuration

All config is environment-driven and validated at boot (`src/config/env.ts`);
the process fails fast if anything is missing or malformed. See `.env.example`.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — (required) | Postgres connection for **this** service (also hosts pg-boss). Never point at the platform DB. |
| `SERVICE_AUTH_TOKEN` | — (required, ≥16 chars) | Shared bearer token for service-to-service auth. Generate with `openssl rand -hex 32`. |
| `PORT` | `3001` | HTTP port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `LOG_LEVEL` | `info` | `trace`–`fatal`. |
| `ARTIFACT_DIR` | `./.artifacts` | Where raw uploaded files are stored (local-fs adapter). |
| `PGBOSS_SCHEMA` | `pgboss` | Postgres schema for the job queue tables. |
| `NODE_ENV` | `development` | `development` enables pretty logs. |

---

## Running the service

One deployable, three roles (so API and workers can scale independently):

```bash
npm run dev          # API + worker (local default), tsx watch
npm run dev:api      # API only
npm run dev:worker   # worker only

npm run build        # tsc -> dist/
npm start            # node dist/index.js --api --worker
```

Role flags: `node dist/index.js --api`, `--worker`, or both. pg-boss is started
in every role (the API enqueues jobs; the worker runs them).

Other scripts: `npm run typecheck`, `npm run prisma:studio`,
`npm run prisma:generate`.

---

## API reference

All endpoints except `/health` require `Authorization: Bearer $SERVICE_AUTH_TOKEN`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + DB reachability (public). |
| `POST` | `/sessions` | Create a migration session. |
| `GET` | `/sessions` | List sessions. |
| `GET` | `/sessions/:id` | Get a session. |
| `POST` | `/sessions/:id/batches` | Upload a CSV/XLSX (multipart `file`, optional `mapping`). Starts the pipeline. |
| `GET` | `/sessions/:id/batches` | List batches in a session. |
| `GET` | `/batches/:id` | Batch detail (status, counts, source, artifacts). |
| `GET` | `/batches/:id/timeline` | Lifecycle view: status, counts/timings, error, readiness, review audit, publish log. |
| `POST` | `/batches/:id/retry` | Re-run normalize→match for a failed/stuck batch. |
| `GET` | `/batches/:id/review` | List review items (filters: `status`, `reason`, `entityType`). |
| `GET` | `/batches/:id/readiness` | `{ openReviewItems, openByReason, ready }`. |
| `GET` | `/review/:id` | A review item + its audit events. |
| `POST` | `/review/:id/resolve` | Resolve: `ACCEPT/REJECT/REMAP/MERGE/EDIT`. |
| `POST` | `/batches/:id/preview` | Plan publish actions (no platform writes) → `PREVIEWED`. |
| `POST` | `/batches/:id/commit` | Execute the plan → `COMMITTED`. Idempotent/resumable. |
| `POST` | `/batches/:id/rollback` | Compensate a committed batch → `ROLLED_BACK`. |
| `GET` | `/batches/:id/actions` | The publish action log. |
| `POST` | `/sessions/:id/rollback-latest` | Roll back the most recent committed batch in a session. |

Publishing is **gated**: `preview`/`commit` return `409 not_publishable` while a
batch has open review items.

---

## End-to-end walkthrough

```bash
TOKEN="$SERVICE_AUTH_TOKEN"; BASE=http://localhost:3001
auth="authorization: Bearer $TOKEN"

# Create a session
SID=$(curl -s -X POST $BASE/sessions -H "$auth" -H 'content-type: application/json' \
  -d '{"name":"Acme migration","operatorRef":"op_acme"}' | jq -r .id)

# Upload a spreadsheet (single workbook with one sheet per entity type)
BID=$(curl -s -X POST "$BASE/sessions/$SID/batches" -H "$auth" \
  -F "file=@tests/fixtures/staging/operator-migration-sample.xlsx" | jq -r .batchId)

# Watch it progress (EXTRACTED -> NORMALIZED -> READY/IN_REVIEW)
curl -s "$BASE/batches/$BID" -H "$auth" | jq .status

# If IN_REVIEW: list and resolve items
curl -s "$BASE/batches/$BID/review?status=OPEN" -H "$auth" | jq '.[] | {id,reason,details}'
curl -s -X POST "$BASE/review/<itemId>/resolve" -H "$auth" -H 'content-type: application/json' \
  -d '{"resolution":"MERGE","resolvedBy":"you"}'

# Preview, then commit, then (optionally) roll back
curl -s -X POST "$BASE/batches/$BID/preview"  -H "$auth" | jq .summary
curl -s -X POST "$BASE/batches/$BID/commit"   -H "$auth" | jq .summary
curl -s -X POST "$BASE/batches/$BID/rollback" -H "$auth" | jq .
```

---

## Spreadsheet mapping

Each sheet is mapped to an entity type, resolved in this order:

1. explicit `mapping` (sheet-scoped),
2. an unscoped `mapping` entry for a single-sheet file,
3. sheet-name convention (`Products`, `Travelers`, `Guides`, `Qualifications`,
   `Bookings`, `Staffing Rules`),
4. for a CSV, the **filename stem** (e.g. `products.csv` → PRODUCT).

The optional `mapping` field (multipart, JSON) shape:

```json
{
  "sheets": [
    { "entityType": "BOOKING", "sheet": "Reservations",
      "columns": { "reference": "Ref", "startDate": "Departs" } }
  ]
}
```

`columns` (canonicalField → sourceHeader) is captured at upload and applied at
the normalize stage. Without it, header aliases are matched automatically.

Sample fixtures live in `tests/fixtures/` (and `tests/fixtures/staging/` for a
full 6-entity workbook). Regenerate the staging workbook with:

```bash
node scripts/make-staging-fixtures.mjs
```

---

## Testing

```bash
npm test               # all tests (needs Postgres for integration)
npm run test:unit      # unit only — no DB required
npm run test:integration   # full-pipeline tests against Postgres
```

- **Unit**: normalization/aliasing, dedupe/scoring, publisher contract.
- **Contract**: a reusable `PublisherPort` suite run against the stub (and the
  test fake) — the real client must pass it too.
- **Integration**: ingest → normalize → match → review → commit → rollback
  against Postgres, including readiness gating and commit resume-after-failure.

Integration tests run the pipeline inline (no pg-boss) via a `SyncJobQueue` test
double and publish to an in-memory `FakePublisher`.

---

## Observability

- **Structured logs** (pino): each stage logs `{ batchId, stage, counts,
  durationMs }`. Pretty in development; JSON in production.
- **Per-stage timings** persisted in `batch.counts.timings`.
- **Timeline endpoint** `GET /batches/:id/timeline` aggregates status,
  counts/timings, error, readiness, the review audit trail (`ReviewEvent`), and
  the publish log (`PublishAction`) — one call to see a batch's whole history.

---

## Runbook

**A batch is stuck / FAILED.**
Inspect: `GET /batches/:id/timeline` → check `batch.error` (`{ stage, message }`).
- Pipeline failure (`stage: normalize|match`): fix the cause, then
  `POST /batches/:id/retry` — normalize is an idempotent rebuild.
- Commit failure (`stage: commit`): just call `POST /batches/:id/commit` again;
  it resumes from `PLANNED`/`FAILED` actions and skips already-`COMMITTED` ones.

**Roll back a bad import.**
`POST /batches/:id/rollback`, or `POST /sessions/:id/rollback-latest` for the
most recent committed batch. Rollback emits compensating `DEACTIVATE` actions
(best-effort; not a guaranteed perfect reversal against the real API).

**Commit was blocked (`409 not_publishable`).**
The batch still has open review items. `GET /batches/:id/readiness` shows the
count by reason; resolve them via `POST /review/:id/resolve`, then retry commit.

**Inspect what was/would be sent to the platform.**
`GET /batches/:id/actions` — the full `PublishAction` log (op, status, payload,
result externalId, errors, compensation links).

**Worker isn't processing jobs.**
Ensure a `--worker` process is running and `DATABASE_URL` matches the API's.
Queues use `retryLimit: 0`, so a failed stage stays FAILED for manual retry
rather than auto-looping.

**Reset local state.**
`docker compose down -v` drops the Postgres volume; `docker compose up -d` +
`npm run prisma:migrate` recreates it. Raw artifacts live under `ARTIFACT_DIR`.

---

## Project structure

```
prisma/                 schema.prisma + migrations
scripts/                fixture generators
src/
  api/                  routes, request schemas, service-to-service auth
  application/          orchestration services (session, ingest, pipeline, review, publish) + container
  domain/               pure logic: canonical schemas/normalize, match, publish actions, ingest mapping
  ports/                interfaces: SourceConnector, PublisherPort, ArtifactStore, JobQueue, repositories
  infra/                adapters: Prisma client, pg-boss, CSV/XLSX connectors, local-fs store, publisher stub
  workers/              pg-boss handlers (normalize, match)
  config/ lib/          env, logger
tests/
  unit/ integration/    test suites
  support/              test doubles (FakePublisher, SyncJobQueue, contract)
  fixtures/             sample CSV/XLSX (+ staging/ workbook)
```

---

## Roadmap

- **Real publisher client** — replace `OperatorImportStubPublisher` with an HTTP
  client against the platform import API (behind the existing `PublisherPort`;
  no orchestration changes). Depends on the platform-side contract (UNI-135).
- **Staging e2e validation** (UNI-138) — run the staging fixtures end to end
  against a deployed environment + real platform.
- **Later milestones** — browser-agent source discovery, booking-email
  ingestion, direct integrations.
