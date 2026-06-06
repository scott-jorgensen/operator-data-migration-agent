import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { EntityType } from '@prisma/client';
import { AliasColumnMapper } from '../../src/infra/ai/alias-mapper.js';
import { ClaudeColumnMapper, ColumnMappingError } from '../../src/infra/ai/claude-mapper.js';
import type { SheetSample } from '../../src/ports/column-mapper.port.js';

describe('AliasColumnMapper', () => {
  const mapper = new AliasColumnMapper();

  it('maps headers via aliases for a known entity type', async () => {
    const sheets: SheetSample[] = [
      {
        name: 'whatever',
        headers: ['Email', 'Full Name', 'Mobile'],
        sampleRows: [{ Email: 'a@b.com', 'Full Name': 'Ana', Mobile: '123' }],
        entityType: EntityType.TRAVELER,
      },
    ];
    const { source, sheets: out } = await mapper.suggest(sheets);
    expect(source).toBe('alias');
    expect(out[0]?.columns).toEqual({ email: 'Email', fullName: 'Full Name', phone: 'Mobile' });
    expect(out[0]?.fieldConfidence.email).toBeGreaterThan(0.5);
    expect(out[0]?.needsReview).toBe(false);
  });

  it('infers entity type from the sheet name when no hint is given', async () => {
    const { sheets } = await mapper.suggest([
      { name: 'Products', headers: ['sku', 'name'], sampleRows: [] },
    ]);
    expect(sheets[0]?.entityType).toBe(EntityType.PRODUCT);
    expect(sheets[0]?.columns).toMatchObject({ sku: 'sku', name: 'name' });
    expect(sheets[0]?.needsReview).toBe(true); // inferred type -> worth confirming
  });

  it('flags needsReview when the entity type cannot be determined', async () => {
    const { sheets } = await mapper.suggest([
      { name: 'mystery', headers: ['a', 'b'], sampleRows: [] },
    ]);
    expect(sheets[0]?.needsReview).toBe(true);
    expect(sheets[0]?.columns).toEqual({});
  });
});

describe('ClaudeColumnMapper', () => {
  function toolUseMessage(input: unknown): Anthropic.Message {
    return {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-8',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 } as Anthropic.Usage,
      content: [{ type: 'tool_use', id: 'tu_1', name: 'propose_mapping', input }],
    } as unknown as Anthropic.Message;
  }

  it('parses a valid tool-use proposal into a suggestion', async () => {
    const create = vi.fn().mockResolvedValue(
      toolUseMessage({
        sheets: [
          {
            sheet: 'Sheet1',
            entityType: 'PRODUCT',
            fields: [
              { canonicalField: 'name', sourceHeader: 'Product Name', confidence: 0.9 },
              { canonicalField: 'sku', sourceHeader: 'Code', confidence: 0.7 },
            ],
            needsReview: false,
          },
        ],
      }),
    );
    const mapper = new ClaudeColumnMapper(create, 'claude-opus-4-8');

    const result = await mapper.suggest([
      { name: 'Sheet1', headers: ['Product Name', 'Code'], sampleRows: [] },
    ]);

    expect(result.source).toBe('ai');
    expect(result.sheets[0]).toMatchObject({
      entityType: EntityType.PRODUCT,
      columns: { name: 'Product Name', sku: 'Code' },
      fieldConfidence: { name: 0.9, sku: 0.7 },
      needsReview: false,
    });

    // Forced a single tool call against the latest model with a cached system prompt.
    const body = create.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.tool_choice).toMatchObject({ type: 'tool', name: 'propose_mapping' });
    expect((body.system as Anthropic.TextBlockParam[])[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('throws when no tool call is returned', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'm',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-8',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: 'no tool here' }],
    } as unknown as Anthropic.Message);
    const mapper = new ClaudeColumnMapper(create, 'claude-opus-4-8');
    await expect(mapper.suggest([{ headers: ['a'], sampleRows: [] }])).rejects.toBeInstanceOf(
      ColumnMappingError,
    );
  });

  it('throws on a malformed proposal', async () => {
    const create = vi.fn().mockResolvedValue(
      toolUseMessage({ sheets: [{ entityType: 'NOT_AN_ENTITY', fields: [], needsReview: false }] }),
    );
    const mapper = new ClaudeColumnMapper(create, 'claude-opus-4-8');
    await expect(mapper.suggest([{ headers: ['a'], sampleRows: [] }])).rejects.toBeInstanceOf(
      ColumnMappingError,
    );
  });
});
