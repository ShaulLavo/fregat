import { expect, it } from 'vitest'
import { initialTranscriptJsonState, TranscriptJsonProjector } from '../transcript-json'

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
  expect(projector.finish()).toEqual({ message: { id: 'native' }, type: 'assistant' })
})
