import { deepStrictEqual, notDeepStrictEqual, strictEqual } from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as v from 'valibot'
import { messageIdSchema } from '../../packages/contracts/src/chat-ids'
import { ProviderRuntimeBuffers } from '../../apps/server/src/orchestration/provider-runtime-buffers'
import { splitBufferedAssistantText } from '../../apps/server/src/orchestration/response-delivery'
import inventory from '../../plans/126-t3code-alignment/inventory.json'

const pin = '7445aa733ada33e45289e5aa5055f79142556513'
strictEqual(inventory.upstream_commit, pin)
const source = execFileSync(
  'git',
  [
    '-C',
    'references/t3code',
    'show',
    `${pin}:apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`,
  ],
  { encoding: 'utf8' },
)
const splitter = source.slice(
  source.indexOf('const MARKDOWN_FENCE_PATTERN'),
  source.indexOf('\nfunction proposedPlanIdForTurn'),
)
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(splitter)
const upstream = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)
const texts = [
  '',
  '\n',
  'a\n\n',
  'a\r\n \t\r\nb',
  'a\n\u00a0\nb',
  '- a\n- b',
  '1. a\n2. b',
  'a\n-',
  'a\n1.',
  'a\n1234567890. b',
  '```ts\nx\n```\nend',
  '~~~\nx\n~~~\n',
  '```\nx\n```bad\n',
  '```\nx\n    ```\n',
  '```\n- a\n\n',
  'a'.repeat(24001),
]
let splits = 0
for (const text of texts) {
  for (let length = 0; length <= Math.min(text.length, 100); length++) {
    const value = text.slice(0, length)
    deepStrictEqual(splitBufferedAssistantText(value), upstream.splitBufferedAssistantText(value))
    splits++
  }
  deepStrictEqual(splitBufferedAssistantText(text), upstream.splitBufferedAssistantText(text))
  splits++
}
const append = source.slice(
  source.indexOf('  const appendBufferedAssistantText ='),
  source.indexOf('  const takeBufferedAssistantText ='),
)
const body = append
  .slice(append.indexOf('          const nextText'), append.lastIndexOf('        }),'))
  .replaceAll('hasRenderableAssistantText(ready)', 'ready.trim().length > 0')
  .replaceAll('yield* Cache.getOption(', 'cacheGet(')
  .replaceAll('yield* Cache.set(', 'cacheSet(')
  .replaceAll('yield* Cache.invalidate(', 'cacheDelete(')
const oracle = new Function(
  'existingText',
  'delta',
  'mode',
  'atMillis',
  'messageId',
  'bufferedAssistantTextByMessageId',
  'lastAssistantDeliveryAtByMessageId',
  'splitBufferedAssistantText',
  'Option',
  'cacheGet',
  'cacheSet',
  'cacheDelete',
  'MAX_BUFFERED_ASSISTANT_CHARS',
  'MIN_ASSISTANT_DELIVERY_INTERVAL_MS',
  body,
)
let deliveries = 0
const option = {
  match: (
    value: string | undefined,
    handlers: { onNone: () => string; onSome: (value: string) => string },
  ) => (value === undefined ? handlers.onNone() : handlers.onSome(value)),
  getOrUndefined: (value: unknown) => value,
}
for (const mode of ['paragraph', 'turn'] as const) {
  for (const spacing of [0, 1, 399, 400, 401]) {
    const buffer = new Map<string, string>()
    const last = new Map<string, number>()
    const local = new ProviderRuntimeBuffers({ now: () => 0 })
    const id = v.parse(messageIdSchema, 'oracle-message')
    let clock = 0
    for (const delta of [...texts, 'x'.repeat(24000), 'a\n\n', 'tail']) {
      clock += spacing
      const expected = oracle(
        buffer.get(id),
        delta,
        mode,
        clock,
        id,
        buffer,
        last,
        upstream.splitBufferedAssistantText,
        option,
        (map: Map<string, unknown>, key: string) => map.get(key),
        (map: Map<string, unknown>, key: string, value: unknown) => map.set(key, value),
        (map: Map<string, unknown>, key: string) => map.delete(key),
        24000,
        400,
      )
      strictEqual(local.appendBufferedAssistantText(id, delta, mode, clock), expected)
      deliveries++
    }
    strictEqual(local.takeBufferedAssistantText(id), buffer.get(id) ?? '')
  }
}
notDeepStrictEqual(upstream.splitBufferedAssistantText('```\na\n\nb\n'), {
  ready: '```\na\n\n',
  rest: 'b\n',
})
notDeepStrictEqual(upstream.splitBufferedAssistantText('- a\n- b'), { ready: '', rest: '- a\n- b' })
console.log(
  JSON.stringify({
    pin,
    splits,
    deliveries,
    negativeControls: 2,
    result: 'matched',
    scope:
      'Pinned splitter and extracted append body; cache lifetime and activity domain not claimed equivalent',
  }),
)
