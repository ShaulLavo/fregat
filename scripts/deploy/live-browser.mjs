import {
  swiftShaderArgs,
  swiftShaderEnv,
} from '../../ghostty-webgpu/scripts/swiftshader-launch.mjs'

export async function openLiveBrowser(chromium, platform = process.platform, signal) {
  const options =
    platform === 'linux'
      ? {
          headless: true,
          args: ['--enable-unsafe-webgpu'].concat(swiftShaderArgs),
          env: swiftShaderEnv(),
        }
      : { headless: true }
  const browser = await chromium.launch(options)
  const abort = () => {
    void browser.close().catch(() => {})
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    signal?.throwIfAborted()
    // Retain the request context after page closure so terminal cleanup can finish.
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    signal?.throwIfAborted()
    return { browser, page }
  } catch (error) {
    await browser.close()
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}
