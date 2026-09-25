import { describe, expect, it } from 'vitest'
import { claudeTranscriptUsage, codexRolloutUsage } from '../imported-usage'

function prompt(uuid: string, timestamp: string) {
  return { type: 'user', uuid, timestamp, message: { content: `prompt ${uuid}` } }
}

function response(
  id: string,
  timestamp: string,
  usage: Record<string, unknown>,
  model = 'claude-opus-5-5',
) {
  return { type: 'assistant', timestamp, message: { id, model, usage } }
}

describe('claudeTranscriptUsage', () => {
  it('keeps the largest counters for a response across streaming partials and copied blocks', () => {
    const partials = [
      prompt('p1', '2026-09-24T10:00:00.000Z'),
      response('m1', '2026-09-24T10:00:01.000Z', { input_tokens: 10, output_tokens: 1 }),
      response('m1', '2026-09-24T10:00:02.000Z', { input_tokens: 10, output_tokens: 20 }),
      response('m1', '2026-09-24T10:00:01.000Z', { input_tokens: 10, output_tokens: 1 }),
    ]
    expect(claudeTranscriptUsage(partials, [])).toEqual([
      expect.objectContaining({
        inputTokens: 10,
        outputTokens: 20,
        recordedAt: '2026-09-24T10:00:02.000Z',
      }),
    ])
  })
  it('retains each response identity with subagents in the prompt they ran under', () => {
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }
    const main = [
      prompt('p1', '2026-09-24T10:00:00.000Z'),
      response('m1', '2026-09-24T10:00:01.000Z', usage),
      // One row per content block, same message id.
      response('m1', '2026-09-24T10:00:02.000Z', usage),
      {
        type: 'user',
        uuid: 'tool',
        message: { content: [{ type: 'tool_result', content: 'ok' }] },
      },
      response('m2', '2026-09-24T10:00:03.000Z', {
        ...usage,
        output_tokens_details: { thinking_tokens: 2 },
      }),
      response('s0', '2026-09-24T10:00:04.000Z', usage, '<synthetic>'),
      prompt('p2', '2026-09-24T11:00:00.000Z'),
      response('m3', '2026-09-24T11:00:01.000Z', usage),
    ]
    const subagent = [response('a1', '2026-09-24T10:30:00.000Z', usage, 'claude-haiku-4-5')]

    expect(claudeTranscriptUsage(main, [subagent])).toEqual([
      expect.objectContaining({
        billingKey: 'm1',
        cacheReadTokens: 100,
        inputTokens: 10,
        model: 'claude-opus-5-5',
        outputTokens: 5,
        reasoningTokens: 0,
        recordedAt: '2026-09-24T10:00:02.000Z',
        turnKey: 'p1',
      }),
      expect.objectContaining({
        billingKey: 'm2',
        cacheReadTokens: 100,
        inputTokens: 10,
        model: 'claude-opus-5-5',
        outputTokens: 5,
        reasoningTokens: 2,
        recordedAt: '2026-09-24T10:00:03.000Z',
        turnKey: 'p1',
      }),
      expect.objectContaining({ inputTokens: 10, turnKey: 'p2' }),
      expect.objectContaining({ model: 'claude-haiku-4-5', turnKey: 'p1' }),
    ])
  })
})

describe('codexRolloutUsage', () => {
  it.each([true, false])('excludes inherited totals with a preceding baseline: %s', (baseline) => {
    const counts = (input: number, output: number) => ({
      input_tokens: input,
      output_tokens: output,
    })
    const tokenCount = (total: unknown, last: unknown) => ({
      type: 'event_msg',
      timestamp: '2026-09-24T10:00:00.000Z',
      payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } },
    })
    const rows = [
      { type: 'session_meta', payload: { forked_from_id: 'parent' } },
      ...(baseline ? [tokenCount(counts(100, 20), counts(100, 20))] : []),
      { type: 'turn_context', payload: { turn_id: 'child-turn', model: 'gpt-5.5' } },
      tokenCount(counts(150, 30), counts(50, 10)),
      tokenCount(counts(170, 35), counts(20, 5)),
    ]
    expect(codexRolloutUsage(rows)).toEqual([
      expect.objectContaining({ turnKey: 'child-turn', inputTokens: 70, outputTokens: 15 }),
    ])
  })
  it('bills each turn the growth of the running totals, to the turn’s model', () => {
    const total = (input: number, cached: number, output: number) => ({
      type: 'event_msg',
      timestamp: `2026-09-24T10:00:0${output / 10}.000Z`,
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: cached,
            output_tokens: output,
          },
        },
      },
    })
    const rows = [
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
      { type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-5.5' } },
      total(100, 40, 10),
      total(300, 140, 20),
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 't2' } },
      { type: 'turn_context', payload: { turn_id: 't2', model: 'gpt-6-astra' } },
      total(500, 200, 30),
    ]

    expect(codexRolloutUsage(rows)).toEqual([
      expect.objectContaining({
        cacheReadTokens: 140,
        inputTokens: 160,
        model: 'gpt-5.5',
        outputTokens: 20,
        turnKey: 't1',
      }),
      expect.objectContaining({
        cacheReadTokens: 60,
        inputTokens: 140,
        model: 'gpt-6-astra',
        outputTokens: 10,
        turnKey: 't2',
      }),
    ])
  })
})
