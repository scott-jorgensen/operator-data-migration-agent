import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { EntityType } from '@prisma/client';
import { FIELD_ALIASES } from '../../domain/canonical/schemas.js';
import type {
  ColumnMapper,
  MappingSuggestion,
  SheetSample,
  SuggestedSheetMapping,
} from '../../ports/column-mapper.port.js';

/**
 * The single Messages API call we need, injected so the mapper is unit-testable
 * with a fake (no real API calls in CI). The real client satisfies this via
 * `(body) => client.messages.create(body)`.
 */
export type MessageCreateFn = (
  body: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message>;

const TOOL_NAME = 'propose_mapping';

/** Validates the tool input Claude returns. */
const ProposalSchema = z.object({
  sheets: z.array(
    z.object({
      sheet: z.string().nullish(),
      entityType: z.nativeEnum(EntityType),
      fields: z.array(
        z.object({
          canonicalField: z.string(),
          sourceHeader: z.string(),
          confidence: z.number().min(0).max(1),
        }),
      ),
      needsReview: z.boolean(),
    }),
  ),
});

/** Canonical field catalog injected into the (cacheable) system prompt. */
function canonicalFieldCatalog(): string {
  return (Object.keys(FIELD_ALIASES) as EntityType[])
    .map((entity) => `- ${entity}: ${Object.keys(FIELD_ALIASES[entity]).join(', ')}`)
    .join('\n');
}

const SYSTEM_PROMPT = `You map messy spreadsheet columns to a fixed canonical data model for a travel-operator migration.

Entities and their canonical fields:
${canonicalFieldCatalog()}

Rules:
- For each input sheet, choose exactly one entityType from the list above.
- Map canonical fields to the source header that best represents them. Use the EXACT source header string as given.
- Only include a field when a source header plausibly matches it; omit fields with no good match.
- Give each mapped field a confidence in [0,1].
- Set needsReview=true when the entity type is ambiguous, confidence is low, or a clearly important field (e.g. a name/identifier) has no match.
- Respond ONLY by calling the ${TOOL_NAME} tool.`;

const PROPOSE_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Propose a canonical column mapping for each input sheet.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      sheets: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sheet: { type: ['string', 'null'], description: 'Sheet name, or null for a single-sheet CSV' },
            entityType: { type: 'string', enum: Object.values(EntityType) },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  canonicalField: { type: 'string' },
                  sourceHeader: { type: 'string' },
                  confidence: { type: 'number' },
                },
                required: ['canonicalField', 'sourceHeader', 'confidence'],
              },
            },
            needsReview: { type: 'boolean' },
          },
          required: ['entityType', 'fields', 'needsReview'],
        },
      },
    },
    required: ['sheets'],
  },
};

export class ColumnMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColumnMappingError';
  }
}

/**
 * LLM-backed ColumnMapper. Uses a cached system prompt (the canonical field
 * catalog) and forces a single tool call for structured output, which we
 * validate before returning. Falls back is handled at the container level
 * (alias mapper) when no API key is configured.
 */
export class ClaudeColumnMapper implements ColumnMapper {
  constructor(
    private readonly create: MessageCreateFn,
    private readonly model: string,
  ) {}

  async suggest(sheets: SheetSample[]): Promise<MappingSuggestion> {
    const message = await this.create({
      model: this.model,
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [PROPOSE_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: buildUserPrompt(sheets) }],
    });

    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME,
    );
    if (!toolUse) throw new ColumnMappingError('model did not return a mapping proposal');

    const parsed = ProposalSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new ColumnMappingError(`invalid mapping proposal: ${parsed.error.message}`);
    }

    const out: SuggestedSheetMapping[] = parsed.data.sheets.map((s) => ({
      sheet: s.sheet ?? undefined,
      entityType: s.entityType,
      columns: Object.fromEntries(s.fields.map((f) => [f.canonicalField, f.sourceHeader])),
      fieldConfidence: Object.fromEntries(s.fields.map((f) => [f.canonicalField, f.confidence])),
      needsReview: s.needsReview,
    }));

    return { source: 'ai', sheets: out };
  }
}

function buildUserPrompt(sheets: SheetSample[]): string {
  const blocks = sheets.map((s, i) => {
    const rows = s.sampleRows.slice(0, 5);
    return [
      `Sheet ${i + 1}: "${s.name ?? '(unnamed CSV)'}"`,
      `Target entity type: ${s.entityType ?? 'unknown — infer it'}`,
      `Headers: ${JSON.stringify(s.headers)}`,
      `Sample rows: ${JSON.stringify(rows)}`,
    ].join('\n');
  });
  return `Map these sheets to the canonical model.\n\n${blocks.join('\n\n')}`;
}
