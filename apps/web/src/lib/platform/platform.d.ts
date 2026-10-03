declare global {
  interface WindowControlsOverlay extends EventTarget {
    readonly visible: boolean
    getTitlebarAreaRect(): DOMRect
  }

  interface Navigator {
    readonly windowControlsOverlay?: WindowControlsOverlay
  }

  interface Window {
    launchQueue?: {
      setConsumer(consumer: (parameters: { readonly targetURL?: string }) => void): void
    }
  }
}

export {}
