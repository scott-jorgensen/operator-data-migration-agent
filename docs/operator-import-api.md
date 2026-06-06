# Operator Import API contract

The migration service publishes into the operator platform **only** through this
API. It is the server-side counterpart of the migration service's
`PublisherPort` (`apply` / `compensate` / `find` / `status`). The platform team
(UNI-135) implements these endpoints; the migration service's
`OperatorImportHttpPublisher` (UNI-141) is the client. The shared, executable
form of this contract is `src/domain/publish/contract.ts` (Zod) and
`openapi.yaml`.

## Conventions

- **Base path**: `/v1/import`. JSON request/response bodies (`application/json`).
- **Auth**: service-to-service bearer token — `Authorization: Bearer <token>`.
- **Idempotency**: every mutating call carries a stable `idempotencyKey`
  (also sent as the `Idempotency-Key` header). Re-sending the same key MUST
  return the same result without creating a duplicate (`idempotent: true`).
  The migration service derives the key as `"{batchId}:{canonicalRecordId}:{op}"`.
- **Entity types**: `PRODUCT`, `BOOKING`, `TRAVELER`, `GUIDE`,
  `QUALIFICATION`, `STAFFING_RULE`.
- **Publish ops**: `CREATE`, `UPDATE`, `LINK`, `DEACTIVATE`.
- **External identity**: the platform returns an opaque `externalId` string
  that the migration service stores and reuses; the migration service never
  assumes its format.

## Endpoints

### POST /v1/import/actions — apply a publish action

The single mutation entry point. `op` selects the operation:

- `CREATE` — create a new entity from `data`. No `externalId`.
- `UPDATE` — update the entity identified by `externalId` with `data`.
- `LINK` — associate without creating (e.g. confirm an existing match);
  requires `externalId`.
- `DEACTIVATE` — soft-deactivate the entity identified by `externalId`.

Request:

```json
{
  "op": "CREATE",
  "entityType": "PRODUCT",
  "externalId": null,
  "data": { "name": "Kilimanjaro 7-Day", "sku": "TZ-KILI-7D", "price": 2450 },
  "idempotencyKey": "batch_123:rec_456:CREATE"
}
```

Response `200`:

```json
{
  "externalId": "prod_98f2",
  "op": "CREATE",
  "entityType": "PRODUCT",
  "status": "COMMITTED",
  "idempotent": false,
  "response": { }
}
```

### POST /v1/import/actions/compensate — reverse an action

Best-effort compensation used by rollback. Typically a soft-deactivate of a
previously created entity. Idempotent on `idempotencyKey`.

Request:

```json
{
  "originalOp": "CREATE",
  "entityType": "PRODUCT",
  "externalId": "prod_98f2",
  "idempotencyKey": "batch_123:rec_456:DEACTIVATE"
}
```

Response `200`:

```json
{ "externalId": "prod_98f2", "status": "ROLLED_BACK", "response": {} }
```

### GET /v1/import/entities — find existing entities (for matching)

Look up existing platform entities to match against. Query params: `type`
(required entity type), plus any of `email`, `code`, `name`. Returns possibly
empty results. (For the MVP the migration service matches intra-batch and this
may return `[]`.)

Response `200`:

```json
{ "results": [ { "externalId": "trav_1", "data": { "email": "ana@example.com" } } ] }
```

### GET /v1/import/health — connectivity check

Response `200`: `{ "ok": true, "service": "operator-platform-import" }`.

## Errors

All errors use one envelope:

```json
{ "error": { "code": "validation_error", "message": "price must be a number", "details": {} } }
```

| Code | HTTP | When |
|---|---|---|
| `invalid_request` | 400 | Malformed body / missing required field. |
| `unauthorized` | 401 | Missing/invalid bearer token. |
| `not_found` | 404 | `externalId` target does not exist (UPDATE/LINK/DEACTIVATE). |
| `conflict` | 409 | Idempotency key reused with a different payload. |
| `validation_error` | 422 | Payload well-formed but rejected by platform rules. |
| `internal` | 500 | Unexpected platform error (safe to retry with same key). |

## Mapping to `PublisherPort`

| PublisherPort | Endpoint |
|---|---|
| `apply(req)` | `POST /v1/import/actions` |
| `compensate(req)` | `POST /v1/import/actions/compensate` |
| `find(type, keys)` | `GET /v1/import/entities` |
| `status()` | `GET /v1/import/health` |

Because the migration service codes against `PublisherPort`, swapping the stub
for the real HTTP client is a configuration change with no orchestration impact.

## Open questions for the platform team (UNI-135)

1. Does the platform support true delete, or only soft-`DEACTIVATE`? (Affects
   rollback fidelity.)
2. Is `idempotencyKey` honored server-side, or must the client guarantee
   at-most-once another way?
3. Should cross-entity references (booking→product, etc.) be resolved by the
   client (send `externalId`s) or by the platform (send natural keys)? The
   client currently plans to send resolved `externalId`s.
