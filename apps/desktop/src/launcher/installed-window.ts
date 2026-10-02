import { launchChromium } from './chromium'

export async function launchInstalledWindow<T>(options: {
  browser: Parameters<typeof launchChromium>[0]
  native: () => Promise<T>
  onUnsupported: (error: unknown) => void
}) {
  try {
    return await launchChromium(options.browser)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (
      code !== 'desktop.launcher.PWA_UNSUPPORTED' &&
      code !== 'desktop.launcher.VERSION_UNSUPPORTED'
    )
      throw error
    options.onUnsupported(error)
    return options.native()
  }
}
