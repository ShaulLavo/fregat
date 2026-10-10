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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  return { browser, page }
}
