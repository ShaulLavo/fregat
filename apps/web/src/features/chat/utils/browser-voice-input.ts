import { createWideEventScope } from '@/lib/wide-event-scope'
import { createStore } from 'zustand/vanilla'
import { voiceErrors } from './voice-errors'

import type { BrowserSpeechRecognition, SpeechRecognitionConstructor } from './speech-recognition'

export function browserSpeechRecognition() {
  if (typeof window === 'undefined' || !window.isSecureContext) return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

type CaptureState = {
  readonly phase: 'idle' | 'preparing' | 'recording' | 'transcribing'
  readonly elapsedSeconds: number
  readonly preview: string
}
const IDLE: CaptureState = { phase: 'idle', elapsedSeconds: 0, preview: '' }

/** Owns browser capture events; TanStack owns the operation and its error. */
export class BrowserVoiceInput {
  readonly store = createStore<CaptureState>(() => IDLE)
  private recognition: BrowserSpeechRecognition | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private settle: ((text: string | null, error?: unknown) => void) | null = null

  run(Recognition: SpeechRecognitionConstructor, locale: string, limitSeconds: number) {
    return new Promise<string | null>((resolve, reject) => {
      const recognition = new Recognition()
      let transcript = ''
      let serviceStarted = false
      let audioStarted = false
      let resultCount = 0
      const startedAt = performance.now()
      const event = createWideEventScope({ action: 'chat.voice.capture', area: 'chat' })
      recognition.lang = locale
      recognition.continuous = true
      recognition.interimResults = true
      this.recognition = recognition
      this.store.setState({ ...IDLE, phase: 'preparing' })
      const settle = (text: string | null, error?: unknown) => {
        if (this.recognition !== recognition) return
        event.end({
          outcome: captureOutcome(text, error),
          durationMs: performance.now() - startedAt,
        })
        this.release(recognition)
        if (error) reject(error)
        else resolve(text)
      }
      this.settle = settle
      const ready = () => {
        if (this.recognition !== recognition || !serviceStarted || !audioStarted) return
        if (this.store.getState().phase !== 'preparing') return
        event.set({ readyMs: performance.now() - startedAt })
        this.recordingStarted(limitSeconds)
      }
      recognition.onstart = () => {
        if (this.recognition !== recognition) return
        serviceStarted = true
        event.set({ serviceStartMs: performance.now() - startedAt })
        ready()
      }
      recognition.onaudiostart = () => {
        if (this.recognition !== recognition) return
        audioStarted = true
        event.set({ audioStartMs: performance.now() - startedAt })
        ready()
      }
      recognition.onaudioend = () => {
        if (this.recognition !== recognition) return
        audioStarted = false
        event.set({ audioEndMs: performance.now() - startedAt })
        this.clearTimer()
        this.store.setState({ phase: 'transcribing' })
      }
      recognition.onresult = ({ results }) => {
        if (this.recognition !== recognition) return
        const entries = Array.from(results)
        resultCount += 1
        if (resultCount === 1) event.set({ firstResultMs: performance.now() - startedAt })
        event.set({
          resultCount,
          finalSegments: entries.filter((result) => result.isFinal).length,
          interimSegments: entries.filter((result) => !result.isFinal).length,
        })
        transcript = entries
          .filter((result) => result.isFinal)
          .map((result) => result[0].transcript)
          .join(' ')
        this.store.setState({
          preview: entries
            .map((result) => result[0].transcript)
            .join(' ')
            .trim(),
        })
      }
      recognition.onend = () => settle(transcript.trim())
      recognition.onerror = ({ error }) => {
        if (this.recognition !== recognition) return
        event.set({ browserError: error })
        settle(null, voiceErrors.CAPTURE_FAILED({ internal: { reason: error } }))
      }
      try {
        recognition.start()
      } catch (error) {
        settle(
          null,
          voiceErrors.CAPTURE_FAILED({
            internal: { reason: error instanceof Error ? error.name : 'start-failed' },
          }),
        )
      }
    })
  }

  finish() {
    if (this.store.getState().phase !== 'recording') return
    this.clearTimer()
    this.store.setState({ phase: 'transcribing' })
    try {
      this.recognition?.stop()
    } catch {
      this.settle?.(null, voiceErrors.CAPTURE_FAILED({ internal: { reason: 'stop-failed' } }))
    }
  }

  cancel() {
    this.settle?.(null)
  }

  private recordingStarted(limitSeconds: number) {
    const started = Date.now()
    this.store.setState({ phase: 'recording' })
    this.timer = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - started) / 1_000)
      this.store.setState({ elapsedSeconds })
      if (elapsedSeconds >= limitSeconds) this.finish()
    }, 1_000)
  }

  private clearTimer() {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  private release(recognition: BrowserSpeechRecognition) {
    this.clearTimer()
    recognition.onstart = null
    recognition.onaudiostart = null
    recognition.onaudioend = null
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    try {
      recognition.abort()
    } catch {
      /* Capture may already have ended. */
    }
    this.recognition = null
    this.settle = null
    this.store.setState(IDLE, true)
  }
}

function captureOutcome(text: string | null, error: unknown) {
  if (error) return 'failed'
  if (text === null) return 'cancelled'
  return 'completed'
}
