import type { BrowserSpeechRecognition } from '../../src/features/chat/utils/speech-recognition'

/** External browser API fixture, also injected into the live composer scenario. */
export function createSpeechRecognitionFixture() {
  return class SpeechRecognitionFixture implements BrowserSpeechRecognition {
    static current: SpeechRecognitionFixture | null = null
    static delayedAudio = false
    static delayedService = false
    static delayedFinish = false
    static failure: string | null = null
    lang = ''
    continuous = false
    interimResults = false
    onstart: BrowserSpeechRecognition['onstart'] = null
    onaudiostart: (() => void) | null = null
    onaudioend: (() => void) | null = null
    onend: BrowserSpeechRecognition['onend'] = null
    onerror: BrowserSpeechRecognition['onerror'] = null
    onresult: BrowserSpeechRecognition['onresult'] = null
    aborted = false
    stopped = false
    start() {
      SpeechRecognitionFixture.current = this
      if (SpeechRecognitionFixture.failure) {
        this.onerror?.({ error: SpeechRecognitionFixture.failure })
        return
      }
      if (!SpeechRecognitionFixture.delayedService) this.onstart?.()
      if (!SpeechRecognitionFixture.delayedAudio) this.onaudiostart?.()
    }
    stop() {
      this.stopped = true
      if (!SpeechRecognitionFixture.delayedFinish) this.onend?.()
    }
    abort() {
      this.aborted = true
    }
    result(text: string, isFinal = true) {
      this.onresult?.({ results: [{ isFinal, 0: { transcript: text } }] })
    }
  }
}

declare global {
  interface Window {
    speechRecognitionFixture?: ReturnType<typeof createSpeechRecognitionFixture>
  }
}
