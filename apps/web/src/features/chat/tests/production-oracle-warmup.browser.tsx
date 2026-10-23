import { createMarkdownSession } from '@workspace/markdown/utils/session'
import { vi } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { recordMarkdownInputReceipt } from '../../../../test/markdown-input-receipt'
import { createProductionMarkdownProbe } from '../../../../test/factories/markdown-production'

test('production oracle warmup does not wait for undecoded link chrome', async ({
  onTestFinished,
}) => {
  const host = document.createElement('main')
  document.body.append(host)
  const probe = createProductionMarkdownProbe({ factory: createMarkdownSession, host })
  const image = Promise.withResolvers<void>()
  const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockReturnValue(image.promise)
  let pending: Promise<unknown> | null = null
  onTestFinished(async () => {
    image.resolve()
    await pending
    await probe.dispose()
    host.remove()
    decode.mockRestore()
  })
  await probe.run('Known **ready** message.', [])
  let complete = false
  pending = probe.run('[External link](https://example.test/docs)', []).then(() => {
    complete = true
  })
  await expect.poll(() => complete).toBe(true)
  expect(host.querySelector('[data-chat-link-favicon]')).not.toBeNull()
  expect(decode).not.toHaveBeenCalled()
})

test('production oracle warmup still waits for message image decoding', async ({
  annotate,
  onTestFinished,
}) => {
  const host = document.createElement('main')
  document.body.append(host)
  const probe = createProductionMarkdownProbe({ factory: createMarkdownSession, host })
  const image = Promise.withResolvers<void>()
  const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockReturnValue(image.promise)
  let pending: Promise<unknown> | null = null
  onTestFinished(async () => {
    image.resolve()
    await pending
    await probe.dispose()
    host.remove()
    decode.mockRestore()
  })
  let complete = false
  const source = `![Answer](${location.origin}/icons/fregat-favicon.svg)`
  await recordMarkdownInputReceipt({ annotate, site: 'production-warmup/image', source })
  pending = probe.run(source, []).then(() => {
    complete = true
  })
  await expect.poll(() => decode.mock.calls.length).toBe(1)
  expect(complete).toBe(false)
  expect(host.querySelector('img[alt="Answer"]')).not.toBeNull()
  image.resolve()
  await pending
  expect(complete).toBe(true)
})
