import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { swiftShaderArgs } from '../../ghostty-webgpu/scripts/swiftshader-launch.mjs'
import { openLiveBrowser } from './live-browser.mjs'

vi.mock('node:fs', () => ({ existsSync: () => true }))
vi.mock('playwright', () => ({ chromium: { executablePath: () => 'chromium/chrome' } }))

test.each(['linux', 'darwin', 'win32'] as const)(
  'uses the browser platform and a complete compositor on %s',
  async (platform) => {
    const page = {}
    const context = { newPage: vi.fn().mockResolvedValue(page) }
    const browser = { newContext: vi.fn().mockResolvedValue(context) }
    const chromium = { launch: vi.fn().mockResolvedValue(browser) }
    expect(await openLiveBrowser(chromium, platform)).toEqual({ browser, page })
    expect(chromium.launch).toHaveBeenCalledOnce()
    const { env, ...options } = chromium.launch.mock.calls[0]![0]
    expect(options).toEqual(
      platform === 'linux'
        ? { headless: true, args: ['--enable-unsafe-webgpu'].concat(swiftShaderArgs) }
        : { headless: true },
    )
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
