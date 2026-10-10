import {
  swiftShaderArgs,
  swiftShaderEnv,
} from '../../ghostty-webgpu/scripts/swiftshader-launch.mjs'

export async function openLiveBrowser(chromium, platform = process.platform) {
  const options =
    platform === 'linux'
      ? {
          headless: true,
          args: ['--enable-unsafe-webgpu'].concat(swiftShaderArgs),
          env: swiftShaderEnv(),
        }
      : { headless: true }
  const browser = await chromium.launch(options)
  // Retain the request context after page closure so terminal cleanup can finish.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  return { browser, page }
}
