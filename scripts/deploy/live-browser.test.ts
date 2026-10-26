import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { openLiveBrowser } from './live-browser.mjs'

vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }))

test.each(['linux', 'darwin', 'win32'] as const)(
  'uses the browser platform and a complete compositor on %s',
  async (platform) => {
    const page = {}
    const context = { newPage: vi.fn().mockResolvedValue(page) }
    const browser = { newContext: vi.fn().mockResolvedValue(context) }
    const chromium = {
      executablePath: () => 'chromium/chrome',
      launch: vi.fn().mockResolvedValue(browser),
    }
    expect(await openLiveBrowser(chromium, platform)).toEqual({ browser, page })
    expect(chromium.launch).toHaveBeenCalledOnce()
    const { env, ...options } = chromium.launch.mock.calls[0]![0]
    expect(options).toEqual({
      ...(platform === 'linux'
        ? {
            headless: true,
            args: [
              '--enable-unsafe-webgpu',
              '--use-angle=vulkan',
              '--enable-features=Vulkan,VulkanFromANGLE',
              '--use-webgpu-adapter=swiftshader',
            ],
          }
        : { headless: true }),
      handleSIGINT: false,
      handleSIGTERM: false,
    })
    if (platform === 'linux') {
      expect(env?.VK_ICD_FILENAMES).toBe(join('chromium', 'vk_swiftshader_icd.json'))
      expect(env?.VK_DRIVER_FILES).toBe(env?.VK_ICD_FILENAMES)
    }
    expect(browser.newContext).toHaveBeenCalledExactlyOnceWith({
      viewport: { width: 1440, height: 1000 },
    })
    expect(context.newPage).toHaveBeenCalledExactlyOnceWith()
  },
)

test.each(['newContext', 'newPage'])('closes an acquired browser when %s fails', async (stage) => {
  const failure = new DOMException('Browser setup failed', 'OperationError')
  const context = { newPage: vi.fn().mockRejectedValue(failure) }
  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    newContext: vi
      .fn()
      .mockImplementation(() =>
        stage === 'newContext' ? Promise.reject(failure) : Promise.resolve(context),
      ),
  }
  const chromium = {
    executablePath: () => 'chromium/chrome',
    launch: vi.fn().mockResolvedValue(browser),
  }
  await expect(openLiveBrowser(chromium, 'darwin')).rejects.toBe(failure)
  expect(browser.close).toHaveBeenCalledOnce()
})

test('requires the software Vulkan driver before launching Chromium', async () => {
  vi.mocked(existsSync).mockReturnValueOnce(false)
  const chromium = { executablePath: () => 'missing/chrome', launch: vi.fn() }
  await expect(openLiveBrowser(chromium, 'linux')).rejects.toMatchObject({
    code: 'scripts.live-browser.SWIFTSHADER_MISSING',
  })
  expect(chromium.launch).not.toHaveBeenCalled()
})
