import * as v from 'valibot'
import type { ProviderImportedUsage } from '../types'
import type { ProviderUsageAmounts } from './usage-totals'

const PRELUDE_TURN = 'prelude'

export const importedUsageListSchema = v.array(
  v.object({
    billingKey: v.string(),
    turnKey: v.string(),
    model: v.string(),
    recordedAt: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheWriteTokens: v.number(),
    reasoningTokens: v.number(),
    costUsd: v.nullable(v.number()),
  }),
)

const count = v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0)

const claudeRowSchema = v.looseObject({
  type: v.string(),
  uuid: v.optional(v.string()),
  timestamp: v.optional(v.string()),
  isMeta: v.optional(v.nullable(v.boolean())),
  isCompactSummary: v.optional(v.boolean()),
  message: v.optional(
    v.looseObject({
      id: v.optional(v.string()),
      model: v.optional(v.string()),
      content: v.optional(v.unknown()),
      usage: v.optional(
        v.looseObject({
          input_tokens: count,
          output_tokens: count,
          cache_read_input_tokens: count,
          cache_creation_input_tokens: count,
          output_tokens_details: v.optional(v.looseObject({ thinking_tokens: count })),
        }),
      ),
    }),
  ),
})

type ClaudeRow = v.InferOutput<typeof claudeRowSchema>

const codexRowSchema = v.looseObject({
  type: v.string(),
  timestamp: v.optional(v.string()),
  payload: v.optional(
    v.looseObject({
      type: v.optional(v.string()),
      forked_from_id: v.optional(v.nullable(v.string())),
      source: v.optional(
        v.looseObject({
          subagent: v.optional(
            v.looseObject({
              thread_spawn: v.optional(v.looseObject({ parent_thread_id: v.optional(v.string()) })),
            }),
          ),
        }),
      ),
    }),
  ),
})

const codexTurnSchema = v.looseObject({ turn_id: v.string(), model: v.optional(v.string()) })

const codexAmountsSchema = v.looseObject({
  input_tokens: count,
  cached_input_tokens: count,
  cache_write_input_tokens: count,
  output_tokens: count,
  reasoning_output_tokens: count,
})
const codexTotalSchema = v.looseObject({
  info: v.looseObject({
    total_token_usage: codexAmountsSchema,
    last_token_usage: v.optional(codexAmountsSchema),
  }),
})

type Totals = Omit<ProviderUsageAmounts, 'costUsd'>

/** Sums usage per turn and model, the turn's time being its last billed request. */
class TurnUsage {
  private readonly rows = new Map<string, ProviderImportedUsage>()

  add(turnKey: string, model: string, recordedAt: string, amounts: Totals) {
    const key = `${turnKey}\0${model}`
    const row = this.rows.get(key)
    if (!row) {
      this.rows.set(key, {
        ...amounts,
        billingKey: turnKey,
        costUsd: null,
        model,
        recordedAt,
        turnKey,
      })
      return
    }
    row.inputTokens += amounts.inputTokens
    row.outputTokens += amounts.outputTokens
    row.cacheReadTokens += amounts.cacheReadTokens
    row.cacheWriteTokens += amounts.cacheWriteTokens
    row.reasoningTokens += amounts.reasoningTokens
    if (recordedAt > row.recordedAt) row.recordedAt = recordedAt
  }

  list() {
    return [...this.rows.values()].filter((row) => row.inputTokens + row.outputTokens > 0)
  }
}

/**
 * A Claude transcript bills each API response once, though it writes one row per
 * content block. Subagent files join the prompt that was running when they spoke.
 */
export function claudeTranscriptUsage(
  main: readonly unknown[],
  subagents: readonly (readonly unknown[])[],
): ProviderImportedUsage[] {
  const billed = new Map<string, ProviderImportedUsage>()
  const prompts: { at: string; key: string }[] = []
  let turnKey = PRELUDE_TURN
  for (const row of parsedRows(claudeRowSchema, main)) {
    if (isClaudePrompt(row) && row.uuid) {
      turnKey = row.uuid
      if (row.timestamp) prompts.push({ at: row.timestamp, key: row.uuid })
      continue
    }
    addClaudeResponse(billed, row, turnKey)
  }
  for (const rows of subagents) {
    for (const row of parsedRows(claudeRowSchema, rows)) {
      const at = row.timestamp ?? ''
      const prompt = prompts.findLast((candidate) => candidate.at <= at)
      addClaudeResponse(billed, row, prompt?.key ?? PRELUDE_TURN)
    }
  }
  return [...billed.values()]
}

function addClaudeResponse(
  billed: Map<string, ProviderImportedUsage>,
  row: ClaudeRow,
  turnKey: string,
) {
  const message = row.message
  if (row.type !== 'assistant' || !message?.usage || !message.id || !row.timestamp) return
  if (!message.model || message.model === '<synthetic>') return

  const previous = billed.get(message.id)
  billed.set(message.id, {
    billingKey: message.id,
    turnKey: previous?.turnKey ?? turnKey,
    model: message.model,
    recordedAt:
      previous && previous.recordedAt > row.timestamp ? previous.recordedAt : row.timestamp,
    costUsd: null,
    cacheReadTokens: Math.max(
      previous?.cacheReadTokens ?? 0,
      message.usage.cache_read_input_tokens,
    ),
    cacheWriteTokens: Math.max(
      previous?.cacheWriteTokens ?? 0,
      message.usage.cache_creation_input_tokens,
    ),
    inputTokens: Math.max(previous?.inputTokens ?? 0, message.usage.input_tokens),
    outputTokens: Math.max(previous?.outputTokens ?? 0, message.usage.output_tokens),
    reasoningTokens: Math.max(
      previous?.reasoningTokens ?? 0,
      message.usage.output_tokens_details?.thinking_tokens ?? 0,
    ),
  })
}

/** The same rows history import turns into user messages: typed text, not tool results. */
function isClaudePrompt(row: ClaudeRow) {
  if (row.type !== 'user' || row.isMeta || row.isCompactSummary) return false
  const content = row.message?.content
  if (typeof content === 'string')
    return content.trim().length > 0 && !content.startsWith('[Request interrupted by user')
  if (!Array.isArray(content)) return false
  return content.some(
    (block) =>
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      block.type === 'text' &&
      'text' in block &&
      typeof block.text === 'string' &&
      block.text.trim().length > 0,
  )
}

/** The only rollout lines the usage read parses; a rollout is mostly tool output. */
export function isCodexUsageLine(line: string) {
  return (
    line.includes('"token_count"') ||
    line.includes('"session_meta"') ||
    line.includes('"task_started"') ||
    line.includes('"turn_context"')
  )
}

/**
 * Codex writes running totals for the thread; a turn is the difference between the
 * last totals inside it and the last totals before it, billed to the turn's model.
 */
export function codexRolloutUsage(lines: readonly unknown[]): ProviderImportedUsage[] {
  const usage = new TurnUsage()
  const state = initialCodexUsageState()
  for (const row of lines) {
    const request = reduceCodexUsage(state, row)
    if (request) usage.add(request.turnKey, request.model, request.recordedAt, request)
  }
  return usage.list()
}

export const codexUsageStateSchema = v.object({
  turn: v.nullable(v.object({ key: v.string(), model: v.nullable(v.string()) })),
  previous: v.nullable(
    v.object({
      inputTokens: count,
      outputTokens: count,
      cacheReadTokens: count,
      cacheWriteTokens: count,
      reasoningTokens: count,
    }),
  ),
  forked: v.nullable(v.boolean()),
})
export type CodexUsageState = v.InferOutput<typeof codexUsageStateSchema>

export function initialCodexUsageState(): CodexUsageState {
  return { turn: null, previous: null, forked: null }
}

/** Shared with incremental local scans: reducer state contains only usage metadata. */
export function reduceCodexUsage(
  state: CodexUsageState,
  input: unknown,
): ProviderImportedUsage | null {
  const parsed = v.safeParse(codexRowSchema, input)
  if (!parsed.success) return null
  const row = parsed.output
  if (row.type === 'session_meta') {
    state.forked ??= Boolean(
      row.payload?.forked_from_id || row.payload?.source?.subagent?.thread_spawn?.parent_thread_id,
    )
    return null
  }
  const kind = row.type === 'event_msg' ? row.payload?.type : row.type
  if (kind === 'task_started' || kind === 'turn_context') {
    state.turn = codexTurn(row.payload, state.turn)
    return null
  }
  if (kind !== 'token_count') return null
  const total = codexTotal(row.payload)
  if (!total) return null
  const delta =
    !state.previous && state.forked
      ? codexTotal(row.payload, 'last_token_usage')
      : codexDelta(total, state.previous)
  state.previous = total
  if (!state.turn?.model || !row.timestamp || !delta) return null
  return {
    ...delta,
    billingKey: state.turn.key,
    turnKey: state.turn.key,
    model: state.turn.model,
    recordedAt: row.timestamp,
    costUsd: null,
  }
}

function codexTurn(payload: unknown, current: { key: string; model: string | null } | null) {
  const parsed = v.safeParse(codexTurnSchema, payload)
  if (!parsed.success) return current
  const model =
    parsed.output.model ?? (current?.key === parsed.output.turn_id ? current.model : null)
  return { key: parsed.output.turn_id, model }
}

function codexTotal(
  payload: unknown,
  field: 'total_token_usage' | 'last_token_usage' = 'total_token_usage',
): Totals | null {
  const parsed = v.safeParse(codexTotalSchema, payload)
  if (!parsed.success) return null
  const total = parsed.output.info[field]
  if (!total) return null
  return {
    cacheReadTokens: total.cached_input_tokens,
    cacheWriteTokens: total.cache_write_input_tokens,
    inputTokens: Math.max(0, total.input_tokens - total.cached_input_tokens),
    outputTokens: total.output_tokens,
    reasoningTokens: total.reasoning_output_tokens,
  }
}

export function codexRolloutBaseline(lines: readonly unknown[]) {
  let latest: Totals | null = null
  for (const row of parsedRows(codexRowSchema, lines)) {
    if (row.type !== 'event_msg' || row.payload?.type !== 'token_count') continue
    latest = codexTotal(row.payload) ?? latest
  }
  return latest
}

/** A total below the previous one is a restarted counter, so all of it is new. */
function codexDelta(total: Totals, previous: Totals | null): Totals {
  if (
    !previous ||
    total.outputTokens < previous.outputTokens ||
    total.inputTokens < previous.inputTokens ||
    total.cacheReadTokens < previous.cacheReadTokens ||
    total.cacheWriteTokens < previous.cacheWriteTokens
  )
    return total
  return {
    cacheReadTokens: Math.max(0, total.cacheReadTokens - previous.cacheReadTokens),
    cacheWriteTokens: Math.max(0, total.cacheWriteTokens - previous.cacheWriteTokens),
    inputTokens: Math.max(0, total.inputTokens - previous.inputTokens),
    outputTokens: total.outputTokens - previous.outputTokens,
    reasoningTokens: Math.max(0, total.reasoningTokens - previous.reasoningTokens),
  }
}

function parsedRows<Schema extends v.GenericSchema>(schema: Schema, rows: readonly unknown[]) {
  return rows.flatMap((row) => {
    const parsed = v.safeParse(schema, row)
    return parsed.success ? [parsed.output as v.InferOutput<Schema>] : []
  })
}
