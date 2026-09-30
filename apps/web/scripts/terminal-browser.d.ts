declare global {
  interface Window {
    __terminalProofDiscardedMessages: string[]
    __terminalReloadFrames: import('./terminal-reload-proof.ts').TerminalFrame[]
  }
}

export {}
