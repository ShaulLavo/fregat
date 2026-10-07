import '../../../dist/worker/entry.js'
import { observeDevice, type DeviceLifecycleCounts } from './device-lifecycle.js'

export type DeviceLifecycleObservation =
  | { readonly type: 'acquired'; readonly device: number }
  | { readonly type: 'waiting' }
  | { readonly type: 'closed'; readonly devices: readonly DeviceLifecycleCounts[] }

const channel = new BroadcastChannel('packaged-worker-device-lifecycle')
const mode = new URL(globalThis.location.href).searchParams.get('lifecycle')
const devices: DeviceLifecycleCounts[] = []
const losses: (() => void)[] = []
const fence = Promise.withResolvers<void>()
const requestDevice = GPUAdapter.prototype.requestDevice
GPUAdapter.prototype.requestDevice = async function (descriptor) {
  const device = await requestDevice.call(this, descriptor)
  losses.push(device.destroy.bind(device))
  const wait = device.queue.onSubmittedWorkDone.bind(device.queue)
  if (mode === 'held')
    device.queue.onSubmittedWorkDone = () => {
      channel.postMessage({ type: 'waiting' })
      return Promise.all([wait(), fence.promise]).then(() => undefined)
    }
  if (mode === 'rejected')
    device.queue.onSubmittedWorkDone = () =>
      Promise.reject(new DOMException('Fixture queue fence rejected', 'OperationError'))
  const counts = observeDevice(device, devices.length)
  devices.push(counts)
  channel.postMessage({ type: 'acquired', device: counts.device })
  return device
}

if (mode === 'setup-failed')
  GPUCanvasContext.prototype.configure = () => {
    throw new DOMException('Fixture canvas configuration failed', 'OperationError')
  }

channel.onmessage = ({ data }: MessageEvent<'release' | 'lose'>) => {
  if (data === 'release') fence.resolve()
  if (data === 'lose') losses.at(-1)?.()
}

const close = globalThis.close.bind(globalThis)
globalThis.close = () => {
  channel.postMessage({ type: 'closed', devices })
  close()
}
