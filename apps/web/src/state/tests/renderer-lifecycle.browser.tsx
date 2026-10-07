import { commands } from 'vitest/browser'
import { expect, test } from '../../../test/fixtures'

declare module 'vitest/browser' {
  interface BrowserCommands {
    rendererLifecycleControl: () => Promise<{
      oldRootDisposed: boolean
      newDocumentHealthy: boolean
    }>
  }
}

test('a stock optimizer reload disposes the old renderer before late HMR renders', async () => {
  const result = await commands.rendererLifecycleControl()
  expect(result).toEqual({ oldRootDisposed: true, newDocumentHealthy: true })
}, 30_000)
