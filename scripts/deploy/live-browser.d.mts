import type { Browser, BrowserType, Page } from 'playwright'

export function openLiveBrowser(
  chromium: Pick<BrowserType, 'launch'>,
  platform?: NodeJS.Platform,
  signal?: AbortSignal,
): Promise<{ browser: Browser; page: Page }>
