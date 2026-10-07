import { createStore } from 'zustand/vanilla'
import { voiceErrors } from './voice-errors'

type SpeechRecognitionResult = {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}
export interface BrowserSpeechRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { readonly error: string }) => void) | null
  onresult: ((event: { readonly results: ArrayLike<SpeechRecognitionResult> }) => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

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
      recognition.lang = locale
      recognition.continuous = true
      recognition.interimResults = true
      this.recognition = recognition
      this.store.setState({ ...IDLE, phase: 'preparing' })
      const settle = (text: string | null, error?: unknown) => {
        if (this.recognition !== recognition) return
        this.release(recognition)
        if (error) reject(error)
        else resolve(text)
      }
      this.settle = settle
      recognition.onstart = () => {
        if (this.recognition === recognition) this.recordingStarted(limitSeconds)
      }
      recognition.onresult = ({ results }) => {
        if (this.recognition !== recognition) return
        const entries = Array.from(results)
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
      recognition.onerror = ({ error }) =>
        settle(null, voiceErrors.CAPTURE_FAILED({ internal: { reason: error } }))
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
