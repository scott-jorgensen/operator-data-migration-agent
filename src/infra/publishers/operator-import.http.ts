import type { EntityType } from '@prisma/client';
import type {
  CompensateRequest,
  CompensateResult,
  FindKeys,
  FoundEntity,
  PublishRequest,
  PublishResult,
} from '../../domain/publish/actions.js';
import {
  ApplyActionResponseSchema,
  CompensateResponseSchema,
  ErrorResponseSchema,
  FindResponseSchema,
  HealthResponseSchema,
  IDEMPOTENCY_HEADER,
} from '../../domain/publish/contract.js';
import type { PublisherPort } from '../../ports/publisher.port.js';
import type { z } from 'zod';

export interface HttpPublisherConfig {
  /** Root URL of the platform (the /v1/import paths are appended). */
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

/** Thrown for non-2xx responses, carrying the contract error code + status. */
export class OperatorImportError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = 'OperatorImportError';
  }
}

/**
 * Real PublisherPort: an HTTP client for the operator platform import API,
 * coded against the shared contract (src/domain/publish/contract.ts). Responses
 * are validated with the contract schemas; non-2xx responses become
 * OperatorImportError. Selected via config (PUBLISHER=http); the migration
 * orchestration is unchanged because it only depends on PublisherPort.
 */
export class OperatorImportHttpPublisher implements PublisherPort {
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: HttpPublisherConfig) {
    this.base = cfg.baseUrl.replace(/\/$/, '');
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
  }

  async apply(req: PublishRequest): Promise<PublishResult> {
    const body = await this.send(
      'POST',
      '/v1/import/actions',
      {
        op: req.op,
        entityType: req.entityType,
        externalId: req.externalId ?? null,
        data: req.data ?? {},
        idempotencyKey: req.idempotencyKey,
      },
      req.idempotencyKey,
      ApplyActionResponseSchema,
    );
    return { externalId: body.externalId, response: body.response };
  }

  async compensate(req: CompensateRequest): Promise<CompensateResult> {
    const body = await this.send(
      'POST',
      '/v1/import/actions/compensate',
      {
        originalOp: req.originalOp,
        entityType: req.entityType,
        externalId: req.externalId,
        idempotencyKey: req.idempotencyKey,
      },
      req.idempotencyKey,
      CompensateResponseSchema,
    );
    return { response: body.response };
  }

  async find(entityType: EntityType, keys: FindKeys): Promise<FoundEntity[]> {
    const qs = new URLSearchParams({ type: entityType });
    if (keys.email) qs.set('email', keys.email);
    if (keys.code) qs.set('code', keys.code);
    if (keys.name) qs.set('name', keys.name);
    const body = await this.send('GET', `/v1/import/entities?${qs.toString()}`, undefined, undefined, FindResponseSchema);
    return body.results;
  }

  async status(): Promise<{ ok: boolean; adapter: string }> {
    try {
      const body = await this.send('GET', '/v1/import/health', undefined, undefined, HealthResponseSchema);
      return { ok: body.ok, adapter: 'operator-import-http' };
    } catch {
      return { ok: false, adapter: 'operator-import-http' };
    }
  }

  private async send<S extends z.ZodTypeAny>(
    method: string,
    path: string,
    payload: unknown,
    idempotencyKey: string | undefined,
    schema: S,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.cfg.token}`,
      'content-type': 'application/json',
    };
    if (idempotencyKey) headers[IDEMPOTENCY_HEADER] = idempotencyKey;

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : {};

    if (!res.ok) {
      const parsed = ErrorResponseSchema.safeParse(json);
      const code = parsed.success ? parsed.data.error.code : 'internal';
      const message = parsed.success ? parsed.data.error.message : `HTTP ${res.status}`;
      throw new OperatorImportError(code, message, res.status);
    }

    return schema.parse(json);
  }
}
