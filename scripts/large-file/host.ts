import { availableParallelism, hostname, totalmem } from 'node:os'
import type { Page } from 'playwright'

export type HostLabel = {
  readonly name: string
  readonly arch: string
  readonly cpus: number
  readonly memoryBytes: number
}

export type RenderingPath = {
  readonly renderer: string
  readonly path: 'software' | 'gpu' | 'unavailable'
}

export function hostLabel(): HostLabel {
  return {
    name: hostname(),
    arch: process.arch,
    cpus: availableParallelism(),
    memoryBytes: totalmem(),
  }
}

/** The page's WebGL renderer: SwiftShader or llvmpipe means frames were rasterized on the CPU. */
export async function renderingPath(page: Page): Promise<RenderingPath> {
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return null
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
  })
  if (renderer === null) return { renderer: 'no WebGL context', path: 'unavailable' }
  const software = /swiftshader|llvmpipe|softpipe|software/i.test(renderer)
  return { renderer, path: software ? 'software' : 'gpu' }
}
