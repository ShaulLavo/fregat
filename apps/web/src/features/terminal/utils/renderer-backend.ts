import type { GhosttyWebGpuTerminalDiagnostics } from 'ghostty-webgpu'

export type TerminalRendererBackend = GhosttyWebGpuTerminalDiagnostics['rendererBackend']

const BACKEND_NAMES = {
  canvas2d: 'Canvas',
  webgl2: 'WebGL2',
  webgpu: 'WebGPU',
} as const satisfies Record<NonNullable<TerminalRendererBackend>, string>

/** `undefined` until ghostty installs a renderer, which happens inside `open`. */
export function rendererBackendLabel(backend: TerminalRendererBackend) {
  if (!backend) return 'Renderer: starting'

  return `Renderer: ${BACKEND_NAMES[backend]}`
}
