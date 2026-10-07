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

test('service start alone keeps preparing until microphone capture starts', async () => {
  const capture = new BrowserVoiceInput()
  owned.push(capture)
  const Recognition = createSpeechRecognitionFixture()
  Recognition.delayedAudio = true
  const result = capture.run(Recognition, 'en-US', 300)
  expect(capture.store.getState().phase).toBe('preparing')
  Recognition.current!.onaudiostart?.()
  expect(capture.store.getState().phase).toBe('recording')
  capture.cancel()
  expect(await result).toBeNull()
})

test('audio capture alone keeps preparing until the recognition service starts', async () => {
  const capture = new BrowserVoiceInput()
  owned.push(capture)
  const Recognition = createSpeechRecognitionFixture()
  Recognition.delayedService = true
  const result = capture.run(Recognition, 'en-US', 300)
  expect(capture.store.getState().phase).toBe('preparing')
  Recognition.current!.onstart?.()
  expect(capture.store.getState().phase).toBe('recording')
  capture.cancel()
  expect(await result).toBeNull()
})

test('capture ending stops the Listening state while final results are pending', async () => {
  const { capture, recognition, result } = setup()
  recognition.onaudioend?.()
  expect(capture.store.getState().phase).toBe('transcribing')
  recognition.result('complete transcript')
  recognition.onend?.()
  expect(await result).toBe('complete transcript')
})

test('finish waits for late final words, preserves earlier segments and excludes provisional text', async () => {
  const capture = new BrowserVoiceInput()
  owned.push(capture)
  const Recognition = createSpeechRecognitionFixture()
  Recognition.delayedFinish = true
  const result = capture.run(Recognition, 'en-US', 300)
  const recognition = Recognition.current!
  recognition.onresult?.({
    results: [
      { isFinal: true, 0: { transcript: 'first phrase' } },
      { isFinal: false, 0: { transcript: 'uncertain tail' } },
    ],
  })
  capture.finish()
  expect(capture.store.getState().phase).toBe('transcribing')
  recognition.onaudioend?.()
  recognition.onresult?.({
    results: [
      { isFinal: true, 0: { transcript: 'first phrase' } },
      { isFinal: true, 0: { transcript: 'corrected final phrase' } },
    ],
  })
  recognition.onend?.()
  expect(await result).toBe('first phrase corrected final phrase')
})

test('cancel during microphone preparation ignores late start events on the next recording', async () => {
  const capture = new BrowserVoiceInput()
  owned.push(capture)
  const Recognition = createSpeechRecognitionFixture()
  Recognition.delayedAudio = true
  const first = capture.run(Recognition, 'en-US', 300)
  const lateAudioStart = Recognition.current!.onaudiostart
  capture.cancel()
  expect(await first).toBeNull()
  const second = capture.run(Recognition, 'en-US', 300)
  lateAudioStart?.()
  expect(capture.store.getState().phase).toBe('preparing')
  Recognition.current!.onaudiostart?.()
  expect(capture.store.getState().phase).toBe('recording')
  capture.cancel()
  expect(await second).toBeNull()
})
