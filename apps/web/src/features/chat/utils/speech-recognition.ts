type SpeechRecognitionResult = {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}
export interface BrowserSpeechRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onaudiostart: (() => void) | null
  onaudioend: (() => void) | null
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
