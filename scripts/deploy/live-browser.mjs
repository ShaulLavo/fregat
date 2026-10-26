import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createError, defineErrorCatalog } from 'evlog'

const browserErrors = defineErrorCatalog('scripts.live-browser', {
  SWIFTSHADER_MISSING: {
    status: 500,
    message: "Chromium's SwiftShader Vulkan driver is missing.",
    why: 'The live check needs a Vulkan device for its WebGPU canvas and compositor.',
    fix: 'Run `bunx playwright install chromium` to install the browser and its driver.',
  },
})

function softwareBrowserOptions(chromium) {
  const driver = join(dirname(chromium.executablePath()), 'vk_swiftshader_icd.json')
  if (!existsSync(driver))
    throw createError({
      ...browserErrors.SWIFTSHADER_MISSING,
      internal: { driverAvailable: false },
    })
  // Dawn and ANGLE must share a Vulkan device to present the WebGPU canvas.
  const args = [
    '--enable-unsafe-webgpu',
    '--use-angle=vulkan',
    '--enable-features=Vulkan,VulkanFromANGLE',
    '--use-webgpu-adapter=swiftshader',
  ]
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  )
  return {
    headless: true,
    args,
    env: { ...env, VK_ICD_FILENAMES: driver, VK_DRIVER_FILES: driver },
  }
}

export async function openLiveBrowser(chromium, platform = process.platform, signal) {
  const options = platform === 'linux' ? softwareBrowserOptions(chromium) : { headless: true }
  // Playwright's SIGINT handler exits before the check can clean up its backend and PTYs.
  const browser = await chromium.launch({ ...options, handleSIGINT: false, handleSIGTERM: false })
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
