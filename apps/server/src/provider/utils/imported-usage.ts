import * as v from 'valibot'
import type { ProviderImportedUsage } from '../types'
import type { ProviderUsageAmounts } from './usage-totals'

const PRELUDE_TURN = 'prelude'

export const importedUsageListSchema = v.array(
  v.object({
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

const count = v.optional(v.number(), 0)

const claudeRowSchema = v.looseObject({
  type: v.string(),
  uuid: v.optional(v.string()),
  timestamp: v.optional(v.string()),
  isMeta: v.optional(v.nullable(v.boolean())),
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
  payload: v.optional(v.looseObject({ type: v.optional(v.string()) })),
})

const codexTurnSchema = v.looseObject({ turn_id: v.string(), model: v.optional(v.string()) })

const codexTotalSchema = v.looseObject({
  info: v.looseObject({
    total_token_usage: v.looseObject({
      input_tokens: count,
      cached_input_tokens: count,
      cache_write_input_tokens: count,
      output_tokens: count,
      reasoning_output_tokens: count,
    }),
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
      this.rows.set(key, { ...amounts, costUsd: null, model, recordedAt, turnKey })
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
  const usage = new TurnUsage()
  const billed = new Set<string>()
  const prompts: { at: string; key: string }[] = []
  let turnKey = PRELUDE_TURN
  for (const row of parsedRows(claudeRowSchema, main)) {
    if (isClaudePrompt(row) && row.uuid) {
      turnKey = row.uuid
      if (row.timestamp) prompts.push({ at: row.timestamp, key: row.uuid })
      continue
    }
    addClaudeResponse(usage, billed, row, turnKey)
  }
  for (const rows of subagents) {
    for (const row of parsedRows(claudeRowSchema, rows)) {
      const at = row.timestamp ?? ''
      const prompt = prompts.findLast((candidate) => candidate.at <= at)
      addClaudeResponse(usage, billed, row, prompt?.key ?? PRELUDE_TURN)
    }
  }
  return usage.list()
}

function addClaudeResponse(usage: TurnUsage, billed: Set<string>, row: ClaudeRow, turnKey: string) {
  const message = row.message
  if (row.type !== 'assistant' || !message?.usage || !message.id || !row.timestamp) return
  if (!message.model || message.model === '<synthetic>' || billed.has(message.id)) return

  billed.add(message.id)
  usage.add(turnKey, message.model, row.timestamp, {
    cacheReadTokens: message.usage.cache_read_input_tokens,
    cacheWriteTokens: message.usage.cache_creation_input_tokens,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    reasoningTokens: message.usage.output_tokens_details?.thinking_tokens ?? 0,
  })
}

/** The same rows history import turns into user messages: typed text, not tool results. */
function isClaudePrompt(row: ClaudeRow) {
  if (row.type !== 'user' || row.isMeta) return false
  const content = row.message?.content
  if (typeof content === 'string') return content.trim().length > 0
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
  let turn: { key: string; model: string | null } | null = null
  let previous: Totals | null = null
  for (const row of parsedRows(codexRowSchema, lines)) {
    const kind = row.type === 'event_msg' ? row.payload?.type : row.type
    if (kind === 'task_started' || kind === 'turn_context') {
      turn = codexTurn(row.payload, turn)
      continue
    }
    if (kind !== 'token_count' || !turn?.model || !row.timestamp) continue
    const total = codexTotal(row.payload)
    if (!total) continue

    usage.add(turn.key, turn.model, row.timestamp, codexDelta(total, previous))
    previous = total
  }
  return usage.list()
}

function codexTurn(payload: unknown, current: { key: string; model: string | null } | null) {
  const parsed = v.safeParse(codexTurnSchema, payload)
  if (!parsed.success) return current
  const model =
    parsed.output.model ?? (current?.key === parsed.output.turn_id ? current.model : null)
  return { key: parsed.output.turn_id, model }
}

function codexTotal(payload: unknown): Totals | null {
  const parsed = v.safeParse(codexTotalSchema, payload)
  if (!parsed.success) return null
  const total = parsed.output.info.total_token_usage
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
  if (!previous || total.outputTokens < previous.outputTokens) return total
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
