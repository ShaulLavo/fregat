import type { LspWorkerLike } from '@singapore-editor/lsp'
import {
  createTypeScriptLspWorkerOwner,
  workerEventError,
  type TypeScriptLspWorkerOwnerSnapshot,
} from './workerOwner'

export type TypeScriptLspServerSession = {
  receive(message: string | ArrayBuffer | ArrayBufferView | unknown): void
  inspectWorker(): TypeScriptLspWorkerOwnerSnapshot
  dispose(): void
}

export type TypeScriptLspServerSessionOptions = {
  send(message: string): void
  workerFactory?: () => LspWorkerLike
  onError?: (error: unknown) => void
}

export function createTypeScriptLspServerSession(
  options: TypeScriptLspServerSessionOptions,
): TypeScriptLspServerSession {
  const worker = createTypeScriptLspWorkerOwner({ workerFactory: options.workerFactory })
  const handleMessage = (event: Event): void => {
    const message = messageEventData(event)
    if (message === null) return
    options.send(message)
  }
  const handleError = (event: Event): void => {
    options.onError?.(workerEventError(event))
  }

  worker.addEventListener('message', handleMessage)
  worker.addEventListener('error', handleError)

  return {
    receive(message) {
      worker.postMessage(decodeSocketMessage(message))
    },
    inspectWorker() {
      return worker.inspect()
    },
    dispose() {
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
      worker.terminate()
    },
  }
}

function decodeSocketMessage(message: string | ArrayBuffer | ArrayBufferView | unknown): unknown {
  if (typeof message === 'string') return message
  if (message instanceof ArrayBuffer) return textFromBytes(new Uint8Array(message))
  if (ArrayBuffer.isView(message)) return textFromBytes(viewBytes(message))
  return message
}

function viewBytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}

function textFromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function messageEventData(event: Event): string | null {
  const data = (event as MessageEvent).data
  if (typeof data === 'string') return data
  if (data === undefined) return null
  return JSON.stringify(data)
}
