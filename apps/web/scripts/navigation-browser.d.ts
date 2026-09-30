declare global {
  interface Window {
    navigationHistoryControl: ReturnType<typeof import('@tanstack/history').createBrowserHistory>
    navigationProofInputAt: number
    navigationProofTraversals: string[]
  }
}

export {}
