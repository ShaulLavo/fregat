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
  it('bills each response once, per prompt and model, with subagents in the prompt they ran under', () => {
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
        cacheReadTokens: 200,
        inputTokens: 20,
        model: 'claude-opus-5-5',
        outputTokens: 10,
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
