import { TerminalWorkerRuntime } from '../runtime.js'
import type { WorkerInitialize, WorkerMessage, WorkerRequest } from '../protocol.js'

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerInitialize>) => void) | null
}

scope.onmessage = ({ data }) => {
  scope.onmessage = null
  const transport = new MessageChannel()
  const close = globalThis.close.bind(globalThis)
  let closing = false
  let disposalId: number | undefined
  // Relay the actor's final acknowledgement before terminating its fixture transport.
  globalThis.close = () => {
    closing = true
  }
  let refreshControl: number | undefined
  let outputControl: number | undefined
  const held: WorkerRequest[] = []
  let frame: WorkerMessage | undefined

  function forward(request: WorkerRequest): void {
    const transfer: Transferable[] = []
    if (request.command === 'open' || request.command === 'attachOutput')
      transfer.push(request.args[0])
    transport.port1.postMessage(request, transfer)
  }

  function forwardQueued(): void {
    while (held.length > 0) {
      const request = held.shift()!
      forward(request)
      if (
        request.command === 'write' ||
        request.command === 'writeln' ||
        request.command === 'writeAndReadGeometry'
      ) {
        outputControl = request.control
        return
      }
    }
  }

  function release(): void {
    if (held.length === 0 || !frame) return
    data.port.postMessage(frame)
    refreshControl = undefined
    frame = undefined
    forwardQueued()
  }

  data.port.onmessage = ({ data: request }: MessageEvent<WorkerRequest>) => {
    if (request.command === 'refresh') refreshControl = request.control
    if (request.command === 'dispose') disposalId = request.id
    // Deliver the real refresh submission after the page has posted its next write.
    if (
      request.command !== 'refresh' &&
      (refreshControl !== undefined || outputControl !== undefined)
    ) {
      held.push(request)
      release()
      return
    }
    forward(request)
  }
  transport.port1.onmessage = ({ data: message }: MessageEvent<WorkerMessage>) => {
    if (message.type === 'frame' && message.control === refreshControl) {
      frame = message
      release()
      return
    }
    data.port.postMessage(message)
    if (message.type === 'frame' && message.control === outputControl) {
      outputControl = undefined
      forwardQueued()
    }
    if (closing && message.type === 'reply' && (message.id === disposalId || message.failure))
      close()
  }
  data.port.start()
  transport.port1.start()
  void new TerminalWorkerRuntime({ ...data, port: transport.port2 }).start()
}
