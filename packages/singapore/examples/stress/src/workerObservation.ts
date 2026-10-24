export type WorkerTransportObservation = {
  readonly type: string
  readonly at: number
  readonly durationMs?: number
  readonly sourceUnits: number
}

/** Fixture-only observation of postMessage through reply, including ordinary-reader payloads. */
export function observeWorkerTransport(
  observe: (event: WorkerTransportObservation) => void,
  enabled: () => boolean = () => true,
): () => void {
  let active = true
  const OriginalWorker = globalThis.Worker
  const ObservedWorker = class extends OriginalWorker {
    private readonly requests = new Map<number, { readonly at: number; readonly type: string }>()
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options)
      this.addEventListener('message', (event) => {
        if (!active) return
        const value: unknown = event.data
        if (!isReply(value)) return
        const request = this.requests.get(value.id)
        if (!request) return
        this.requests.delete(value.id)
        observe({
          type: request.type,
          at: request.at,
          durationMs: performance.now() - request.at,
          sourceUnits: 0,
        })
      })
    }
    override postMessage(
      message: unknown,
      transferOrOptions: Transferable[] | StructuredSerializeOptions = [],
    ): void {
      if (active && enabled() && isRequest(message)) {
        const at = performance.now()
        this.requests.set(message.id, { at, type: message.payload.type })
        observe({ type: message.payload.type, at, sourceUnits: sourceUnits(message.payload) })
      }
      if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions)
      else super.postMessage(message, transferOrOptions)
    }
  }
  globalThis.Worker = ObservedWorker
  return () => {
    active = false
    if (globalThis.Worker === ObservedWorker) globalThis.Worker = OriginalWorker
  }
}

function isReply(value: unknown): value is { readonly id: number } {
  return (
    typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'number'
  )
}
function isRequest(
  value: unknown,
): value is { readonly id: number; readonly payload: { readonly type: string } } {
  return (
    isReply(value) &&
    'payload' in value &&
    typeof value.payload === 'object' &&
    value.payload !== null &&
    'type' in value.payload &&
    typeof value.payload.type === 'string'
  )
}
function sourceUnits(payload: object): number {
  const direct = textUnits(payload) + editUnits(payload)
  if (!('command' in payload) || typeof payload.command !== 'object' || payload.command === null)
    return direct
  const command = payload.command
  const chunks =
    'chunks' in command && Array.isArray(command.chunks)
      ? command.chunks.reduce(
          (units: number, text: unknown) => units + (typeof text === 'string' ? text.length : 0),
          0,
        )
      : 0
  return direct + chunks + editUnits(command)
}
function textUnits(value: object): number {
  return 'text' in value && typeof value.text === 'string' ? value.text.length : 0
}
function editUnits(value: object): number {
  if (!('edits' in value) || !Array.isArray(value.edits)) return 0
  return value.edits.reduce(
    (units: number, edit: unknown) =>
      units + (typeof edit === 'object' && edit !== null ? textUnits(edit) : 0),
    0,
  )
}
