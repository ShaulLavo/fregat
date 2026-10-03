import { expect, it } from 'vitest'
import * as v from 'valibot'
import {
  initialTranscriptJsonState,
  transcriptJsonStateSchema,
  TranscriptJsonProjector,
} from '../transcript-json'

it.each([
  '{"type":"assistant",}',
  '{"message":{"content":[1,]},"type":"assistant"}',
  '{"message":{"content":"bad\\q"},"type":"assistant"}',
  '{"message":{"content":"bad\\u12xz"},"type":"assistant"}',
  '{"type":"assistant" }',
])('rejects malformed syntax even in discarded content: %s', (text) => {
  const projector = new TranscriptJsonProjector(initialTranscriptJsonState(), 1024)
  for (const character of text) projector.write(character)
  expect(projector.finish()).toBeUndefined()
})

it('persists a split escape without keeping discarded conversation text', () => {
  const state = initialTranscriptJsonState()
  new TranscriptJsonProjector(state, 1024).write('{"message":{"content":"PRIVATE\\u12')
  expect(JSON.stringify(state)).not.toContain('PRIVATE')
  const projector = new TranscriptJsonProjector(structuredClone(state), 1024)
  projector.write('34\\n","id":"native"},"type":"assistant"}')
  expect(projector.finish()).toEqual({ message: { content: 'x', id: 'native' }, type: 'assistant' })
})

it.each([
  '{"type":"assistant","message":{"id":{"prompt":"PRIVATE_PROMPT_MARKER"}}}',
  '{"type":"assistant","message":{"usage":{"input_tokens":"PRIVATE_PROMPT_MARKER"}}}',
  '{"PRIVATE_PROMPT_MARKER":"PRIVATE_PROMPT_MARKER","type":"assistant"}',
  '"PRIVATE_PROMPT_MARKER"',
  '{"timestamp":{"nested":"PRIVATE_PROMPT_MARKER"}}',
  '{"isMeta":{"nested":"PRIVATE_PROMPT_MARKER"}}',
  '{"message":{"usage":{"input_tokens":[{"text":"PRIVATE_PROMPT_MARKER"}],"extra":{"PRIVATE_PROMPT_MARKER":"PRIVATE_PROMPT_MARKER"}}}}',
  '{"message":{"content":[{"type":"tool_result","content":{"PRIVATE_PROMPT_MARKER":"PRIVATE_PROMPT_MARKER"}}]}}',
])(
  'keeps malformed selected shapes and unknown keys out of persisted partial state: %s',
  (text) => {
    let state = initialTranscriptJsonState()
    for (const character of text) {
      new TranscriptJsonProjector(state, 1024).write(character)
      expect(JSON.stringify(state)).not.toContain('PRIVATE_PROMPT_MARKER')
      state = v.parse(transcriptJsonStateSchema, JSON.parse(JSON.stringify(state)))
    }
  },
)

it('projects only content-shape markers, including escaped whitespace and text blocks', () => {
  const projector = new TranscriptJsonProjector(initialTranscriptJsonState(), 1024)
  projector.write(
    '{"message":{"content":[{"type":"text","text":"PRIVATE PROMPT"},{"type":"tool_result","content":"PRIVATE TOOL"}]}}',
  )
  expect(projector.finish()).toEqual({
    message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_result' }] },
  })
  const empty = new TranscriptJsonProjector(initialTranscriptJsonState(), 1024)
  empty.write('{"message":{"content":"\\u0020\\n\\t"}}')
  expect(empty.finish()).toEqual({ message: { content: '' } })
})
