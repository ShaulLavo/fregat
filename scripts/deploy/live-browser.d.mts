import type { Browser, BrowserType, Page } from 'playwright'

export function openLiveBrowser(
  chromium: Pick<BrowserType, 'launch'>,
  platform?: NodeJS.Platform,
): Promise<{ browser: Browser; page: Page }>
