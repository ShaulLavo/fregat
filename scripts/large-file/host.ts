import { availableParallelism, hostname, totalmem } from 'node:os'
import type { Browser } from 'playwright'

export type HostLabel = {
  readonly name: string
  readonly arch: string
  readonly cpus: number
  readonly memoryBytes: number
}

export type RenderingPath = {
  /** Chromium's GPU feature status for page rasterization and compositing, as in chrome://gpu. */
  readonly rasterization: string
  readonly compositing: string
  readonly glRenderer: string
  readonly path: 'software' | 'gpu' | 'unknown'
}

export function hostLabel(): HostLabel {
  return {
    name: hostname(),
    arch: process.arch,
    cpus: availableParallelism(),
    memoryBytes: totalmem(),
  }
}

/** Raster status decides the label: WebGL can be software while the page rasterizes on the GPU. */
export function rasterPath(rasterization: string): RenderingPath['path'] {
  if (rasterization.includes('software')) return 'software'
  if (rasterization.startsWith('enabled')) return 'gpu'
  return 'unknown'
}

export async function renderingPath(browser: Browser): Promise<RenderingPath> {
  const session = await browser.newBrowserCDPSession()
  try {
    const { gpu } = await session.send('SystemInfo.getInfo')
    const status: Record<string, string | undefined> = gpu.featureStatus ?? {}
    const rasterization = status.rasterization ?? 'unreported'
    return {
      rasterization,
      compositing: status.gpu_compositing ?? 'unreported',
      glRenderer: String(gpu.auxAttributes?.glRenderer ?? 'unreported'),
      path: rasterPath(rasterization),
    }
  } finally {
    await session.detach()
  }
}
