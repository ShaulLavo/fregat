import { EventEmitter } from 'node:events'
import type { AttachHost } from '../../src/host/attach'

export function recordingAttachHost() {
  const inputEvents = new EventEmitter()
  const outputEvents = new EventEmitter()
  const writes: Uint8Array[] = []
  const rawModes: boolean[] = []
  const dimensions = { columns: 80, rows: 24 }
  let paused = false
  const host: AttachHost = {
    input: {
      isRaw: false,
      on: inputEvents.on.bind(inputEvents),
      off: inputEvents.off.bind(inputEvents),
      setRawMode(mode) {
        rawModes.push(mode)
        return this
      },
      resume() {
        paused = false
        return this
      },
      pause() {
        paused = true
        return this
      },
    },
    output: {
      get columns() {
        return dimensions.columns
      },
      get rows() {
        return dimensions.rows
      },
      on: outputEvents.on.bind(outputEvents),
      off: outputEvents.off.bind(outputEvents),
      write(chunk: string | Uint8Array) {
        writes.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
        return true
      },
    },
  }
  return {
    host,
    writes,
    rawModes,
    get paused() {
      return paused
    },
    input(bytes: Uint8Array) {
      inputEvents.emit('data', bytes)
    },
    resize(columns: number, rows: number) {
      Object.assign(dimensions, { columns, rows })
      outputEvents.emit('resize')
    },
    get listeners() {
      return inputEvents.listenerCount('data') + outputEvents.listenerCount('resize')
    },
  }
}
