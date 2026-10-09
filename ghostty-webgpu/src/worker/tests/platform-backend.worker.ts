import { rendererPlatforms } from '../../render/tests/platforms.js'
import { TerminalWorkerRuntime } from '../../../dist/worker/runtime.js'
import type { WorkerInitialize } from '../protocol.js'

const parameters = new URL(import.meta.url).searchParams
const platform = rendererPlatforms.find((value) => value.name === parameters.get('platform'))!
const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu)
navigator.gpu.requestAdapter = async (options) => {
  const adapter = await requestAdapter(options)
  if (!adapter) return null
  return {
    isFallbackAdapter: false,
    info: { description: 'Test hardware adapter' },
    requestDevice: adapter.requestDevice.bind(adapter),
  } as unknown as GPUAdapter
}

if (parameters.has('unavailableWebGl')) {
  const getContext = OffscreenCanvas.prototype.getContext
  OffscreenCanvas.prototype.getContext = function (
    this: OffscreenCanvas,
    contextId: string,
    attributes?: unknown,
  ) {
    if (contextId === 'webgl2') return null
    return Reflect.apply(getContext, this, [contextId, attributes])
  } as typeof getContext
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerInitialize>) => void) | null
}
scope.onmessage = ({ data }) => {
  scope.onmessage = null
  void new TerminalWorkerRuntime(data, platform.navigator).start()
}
