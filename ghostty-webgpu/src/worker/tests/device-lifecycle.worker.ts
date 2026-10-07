import '../../../dist/worker/entry.js'
import type { WorkerInitialize, WorkerMessage, WorkerRequest } from '../protocol.js'
import { observeDevice, type DeviceLifecycleCounts } from './device-lifecycle.js'

export type DeviceLifecycleObservation =
  | { readonly type: 'acquired'; readonly device: number }
  | { readonly type: 'waiting'; readonly device: number }
  | { readonly type: 'destroyed'; readonly device: number }
  | { readonly type: 'interrupted' }
  | {
      readonly type: 'completed' | 'inspected'
      readonly devices: readonly DeviceLifecycleCounts[]
    }

const channel = new BroadcastChannel('packaged-worker-device-lifecycle')
const mode = new URL(globalThis.location.href).searchParams.get('lifecycle')
const devices: DeviceLifecycleCounts[] = []
const losses: (() => void)[] = []
const fence = Promise.withResolvers<void>()
const acquisition = Promise.withResolvers<void>()
const requestDevice = GPUAdapter.prototype.requestDevice
GPUAdapter.prototype.requestDevice = async function (descriptor) {
  const device = await requestDevice.call(this, descriptor)
  const identity = devices.length
  losses.push(device.destroy.bind(device))
  if (mode === 'rejected' || mode === 'rejected-held')
    device.queue.onSubmittedWorkDone = () =>
      Promise.reject(new DOMException('Fixture queue fence rejected', 'OperationError'))
  const wait = device.queue.onSubmittedWorkDone.bind(device.queue)
  if (mode === 'held' || mode === 'rejected-held' || (mode === 'retired-held' && identity === 0))
    device.queue.onSubmittedWorkDone = () => {
      channel.postMessage({ type: 'waiting', device: identity })
      return wait()
        .finally(() => fence.promise)
        .then(() => undefined)
    }
  const counts = observeDevice(device, identity)
  const destroy = device.destroy.bind(device)
  device.destroy = () => {
    destroy()
    channel.postMessage({ type: 'destroyed', device: identity })
  }
  devices.push(counts)
  channel.postMessage({ type: 'acquired', device: counts.device })
  if (mode === 'initial-held' || (mode === 'replacement-held' && identity === 1))
    await acquisition.promise
  return device
}

if (mode === 'setup-failed')
  GPUCanvasContext.prototype.configure = () => {
    throw new DOMException('Fixture canvas configuration failed', 'OperationError')
  }

channel.onmessage = ({ data }: MessageEvent<'release' | 'lose' | 'inspect' | 'acquire'>) => {
  if (data === 'acquire') acquisition.resolve()
  if (data === 'release') fence.resolve()
  if (data === 'lose') losses.at(-1)?.()
  if (data === 'inspect') channel.postMessage({ type: 'inspected', devices })
}

const scope = globalThis as unknown as {
  onmessage(event: MessageEvent<WorkerInitialize>): void
}
const initialize = scope.onmessage
scope.onmessage = (event) => {
  const port = event.data.port
  let opening: number | undefined
  let disposing: number | undefined
  port.addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
    if (data.command === 'open') opening = data.id
    if (data.command === 'dispose') disposing = data.id
    if (mode === 'initial-held' && data.generation !== event.data.generation)
      queueMicrotask(() => channel.postMessage({ type: 'interrupted' }))
  })
  const send = port.postMessage.bind(port)
  port.postMessage = (message: WorkerMessage) => {
    if (
      message.type === 'fatal' ||
      (message.type === 'reply' &&
        (message.id === disposing || (message.id === opening && !!message.failure)))
    )
      channel.postMessage({ type: 'completed', devices })
    send(message)
  }
  initialize(event)
}
