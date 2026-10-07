import { afterEach, vi } from 'vitest'
import { expect, test } from '../../../../../test/fixtures'
import { createSpeechRecognitionFixture } from '../../../../../test/factories/speech-recognition'
import { BrowserVoiceInput } from '../browser-voice-input'

const owned: BrowserVoiceInput[] = []
afterEach(() => {
  for (const capture of owned.splice(0)) capture.cancel()
  vi.useRealTimers()
})
function setup() {
  const capture = new BrowserVoiceInput()
  owned.push(capture)
  const Recognition = createSpeechRecognitionFixture()
  const result = capture.run(Recognition, 'en-US', 300)
  const recognition = Recognition.current!
  return { capture, recognition, result }
}

test('finish waits for final speech and returns a revised result once', async () => {
  const { capture, recognition, result } = setup()
  recognition.result('hello', false)
  expect(capture.store.getState().preview).toBe('hello')
  recognition.result('hello world')
  recognition.result('Hello world.')
  capture.finish()
  expect(await result).toBe('Hello world.')
  expect(recognition.stopped).toBe(true)
  expect(recognition.aborted).toBe(true)
  expect(capture.store.getState().phase).toBe('idle')
})

test('cancel discards text and detaches late browser callbacks', async () => {
  const { capture, recognition, result } = setup()
  const lateResult = recognition.onresult
  recognition.result('discard this')
  capture.cancel()
  expect(await result).toBeNull()
  expect(recognition.aborted).toBe(true)
  expect(recognition.onend).toBeNull()
  // The browser may already have queued an event before abort.
  lateResult?.({ results: [{ isFinal: true, 0: { transcript: 'late speech' } }] })
  expect(capture.store.getState().preview).toBe('')
})

test('browser failure rejects and releases capture', async () => {
  const { capture, recognition, result } = setup()
  recognition.onerror?.({ error: 'not-allowed' })
  await expect(result).rejects.toMatchObject({ message: 'Speech recognition stopped.' })
  expect(recognition.aborted).toBe(true)
  expect(capture.store.getState().phase).toBe('idle')
})

test('the time limit finishes recording and clears its timer', async () => {
  vi.useFakeTimers()
  const { capture, recognition, result } = setup()
  recognition.result('bounded recording')
  vi.advanceTimersByTime(300_000)
  expect(await result).toBe('bounded recording')
  expect(capture.store.getState().phase).toBe('idle')
  expect(vi.getTimerCount()).toBe(0)
})
