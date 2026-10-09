export interface RendererPlatform {
  readonly platform: string
  readonly userAgent: string
  readonly userAgentData?: { readonly platform: string }
}

export type GpuBackend = 'webgpu' | 'webgl'

export function automaticGpuBackends(
  navigator: RendererPlatform = globalThis.navigator,
): readonly [GpuBackend, GpuBackend] {
  const platform = navigator.userAgentData?.platform ?? navigator.platform
  const desktopLinux =
    /^Linux(?:\s|$)/.test(platform) && !/\b(?:Android|CrOS)\b/.test(navigator.userAgent)
  return desktopLinux ? ['webgl', 'webgpu'] : ['webgpu', 'webgl']
}
