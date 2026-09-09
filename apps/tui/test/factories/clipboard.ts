import type { ClipboardReadResult, ClipboardReadOptions, HostClipboardOptions } from '@opentui/core'

export function clipboardBoundary(result: ClipboardReadResult) {
  const reads: ClipboardReadOptions[] = []
  const configurations: (HostClipboardOptions | undefined)[] = []
  let disposed = false
  return {
    reads,
    configurations,
    get disposed() {
      return disposed
    },
    create(options?: HostClipboardOptions) {
      configurations.push(options)
      return {
        maxWriteBytes: 0,
        async read(options: ClipboardReadOptions) {
          reads.push(options)
          return result
        },
        async writeText() {
          return { status: 'unsupported' as const }
        },
        async clear() {
          return { status: 'unsupported' as const }
        },
        async dispose() {
          disposed = true
        },
      }
    },
  }
}
