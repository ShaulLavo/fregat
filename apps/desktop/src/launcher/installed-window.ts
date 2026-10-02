import { launchChromium } from './chromium'

export async function launchInstalledWindow<T>(options: {
  browser: Parameters<typeof launchChromium>[0]
  native: () => Promise<T>
  onUnsupported: (error: unknown) => void
}) {
  try {
    return await launchChromium(options.browser)
  } catch (error) {
    if ((error as { code?: string }).code !== 'desktop.launcher.PWA_UNSUPPORTED') throw error
    options.onUnsupported(error)
    return options.native()
  }
}
