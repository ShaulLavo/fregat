import { browserAvailable } from './browser-launch'

export const chromiumUnavailable = !(await browserAvailable('chromium'))
if (chromiumUnavailable)
  console.info('Browser fixture tests require an installed Playwright Chromium.')
