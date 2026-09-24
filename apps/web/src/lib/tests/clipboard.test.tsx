import { afterEach, beforeEach, vi } from 'vitest'
import { toast } from 'sonner'

import { log } from '@/lib/client-logging'
import { copyTextToClipboard, writeClipboardText } from '@/lib/clipboard'
import { expect, test } from '../../../test/fixtures'
import { stubClipboard, type ClipboardStub } from '../../../test/factories/clipboard'

let clipboard: ClipboardStub

beforeEach(() => {
  clipboard = stubClipboard()
  vi.spyOn(toast, 'success').mockImplementation(() => 'toast')
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
})

afterEach(() => {
  clipboard.restore()
  vi.restoreAllMocks()
})

test('writes through writeText when the browser offers it', async () => {
  await expect(writeClipboardText('alpha')).resolves.toBe('writeText')

  expect(clipboard.written).toEqual([{ method: 'writeText', text: 'alpha' }])
})

test('falls back to a ClipboardItem write when writeText is refused', async () => {
  clipboard.refuse('writeText')

  await expect(writeClipboardText('alpha')).resolves.toBe('write')

  expect(clipboard.written).toEqual([{ method: 'write', text: 'alpha' }])
})

test('falls back to execCommand when the async clipboard is missing', async () => {
  clipboard.remove('writeText')
  clipboard.remove('write')

  await expect(writeClipboardText('alpha')).resolves.toBe('execCommand')

  expect(clipboard.written).toEqual([{ method: 'execCommand', text: 'alpha' }])
})

test('the execCommand fallback gives focus back and leaves no textarea behind', async () => {
  clipboard.remove('writeText')
  clipboard.remove('write')
  const input = document.createElement('input')
  document.body.append(input)
  input.focus()

  await writeClipboardText('alpha')

  expect(document.activeElement).toBe(input)
  expect(document.querySelector('textarea')).toBeNull()
  input.remove()
})

test('fails only after every method refused, naming each without the text', async () => {
  clipboard.refuse('writeText')
  clipboard.refuse('write')
  clipboard.refuse('execCommand')

  const error = await writeClipboardText('secret payload').catch((caught: unknown) => caught)

  expect(error).toMatchObject({
    internal: {
      attempts: [
        { error: 'NotAllowedError', method: 'writeText' },
        { error: 'NotAllowedError', method: 'write' },
        { error: 'NotAllowedError', method: 'execCommand' },
      ],
    },
  })
  expect(JSON.stringify(error)).not.toContain('secret payload')
})

test('a menu copy toasts success once', async () => {
  await expect(copyTextToClipboard('/tmp/a.ts', 'path')).resolves.toBe(true)

  expect(toast.success).toHaveBeenCalledTimes(1)
  expect(toast.success).toHaveBeenCalledWith('Copied path')
  expect(toast.error).not.toHaveBeenCalled()
})

test('a refused menu copy reports one error and no success', async () => {
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
  clipboard.refuse('writeText')
  clipboard.refuse('write')
  clipboard.refuse('execCommand')

  await expect(copyTextToClipboard('/tmp/a.ts', 'path')).resolves.toBe(false)

  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledTimes(1)
  expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe('Could not copy path')
  expect(warn).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(warn.mock.calls[0])).not.toContain('/tmp/a.ts')
})
