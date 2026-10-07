import '../../../dist/worker/entry.js'

export interface DeviceLifecycleCounts {
  readonly device: number
  waits: number
  destroys: number
}
export type DeviceLifecycleObservation =
  | { readonly type: 'acquired'; readonly device: number }
  | { readonly type: 'closed'; readonly devices: readonly DeviceLifecycleCounts[] }

const channel = new BroadcastChannel('packaged-worker-device-lifecycle')
const devices: DeviceLifecycleCounts[] = []
const requestDevice = GPUAdapter.prototype.requestDevice
GPUAdapter.prototype.requestDevice = async function (descriptor) {
  const device = await requestDevice.call(this, descriptor)
  const counts = { device: devices.length, waits: 0, destroys: 0 }
  devices.push(counts)
  channel.postMessage({ type: 'acquired', device: counts.device })
  const wait = device.queue.onSubmittedWorkDone.bind(device.queue)
  device.queue.onSubmittedWorkDone = () => {
    counts.waits += 1
    return wait()
  }
  const destroy = device.destroy.bind(device)
  device.destroy = () => {
    counts.destroys += 1
    destroy()
  }
  return device
}

const close = globalThis.close.bind(globalThis)
globalThis.close = () => {
  channel.postMessage({ type: 'closed', devices })
  close()
}
