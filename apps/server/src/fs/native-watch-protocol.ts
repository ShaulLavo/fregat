export type NativeWatchRequest =
  | {
      readonly type: 'watch'
      readonly id: number
      readonly path: string
      readonly recursive: boolean
    }
  | { readonly type: 'close'; readonly id: number }

export type NativeWatchError = {
  readonly code?: string
  readonly message: string
  /** Absolute path the error names, when the runtime says. */
  readonly path?: string
}

export type NativeWatchResponse =
  | {
      readonly type: 'attached'
      readonly id: number
      readonly attachMs: number
      /** Errors raised while the watch walked its tree, such as an unreadable subdirectory. */
      readonly errors: readonly NativeWatchError[]
    }
  | { readonly type: 'failed'; readonly id: number; readonly error: NativeWatchError }
  | { readonly type: 'error'; readonly id: number; readonly error: NativeWatchError }
  | { readonly type: 'events'; readonly events: ReadonlyArray<readonly [number, string, string]> }
