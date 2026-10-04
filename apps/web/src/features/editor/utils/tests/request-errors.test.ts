import {
  LspClient,
  LspRequestCancelledError,
  LspResponseError,
  REQUEST_CANCELLED,
} from '@singapore-editor/lsp'
import { afterEach, vi } from 'vitest'

import { reportRequestError } from '@/features/editor/utils/request-errors'
import { log } from '@/lib/client-logging'
import { expect, test } from '../../../../../test/fixtures'

afterEach(() => vi.restoreAllMocks())

test('keeps a locally aborted completion in debug diagnostics', () => {
  const debugged = vi.spyOn(log, 'debug')
  const failed = vi.spyOn(log, 'error')
  const error = new LspRequestCancelledError()

  reportRequestError({ error, method: 'textDocument/completion', serverId: 'typescript' })

  expect(debugged).toHaveBeenCalledWith({
    action: 'lsp.request_cancelled',
    area: 'lsp',
    error,
    method: 'textDocument/completion',
    serverId: 'typescript',
  })
  expect(failed).not.toHaveBeenCalled()
})

test.each([-32001, REQUEST_CANCELLED])('preserves server response error %s', (code) => {
  const debugged = vi.spyOn(log, 'debug')
  const failed = vi.spyOn(log, 'error')
  const error = new LspResponseError({ code, message: 'Server rejected the request' })

  reportRequestError({ error, method: 'textDocument/completion', serverId: 'typescript' })

  expect(failed).toHaveBeenCalledWith({
    action: 'lsp.request_failed',
    area: 'lsp',
    error,
    method: 'textDocument/completion',
    serverId: 'typescript',
  })
  expect(debugged).not.toHaveBeenCalled()
})

test('keeps a disconnected transport failure actionable', async () => {
  const debugged = vi.spyOn(log, 'debug')
  const failed = vi.spyOn(log, 'error')
  const client = new LspClient({ rootUri: 'file:///repo' })
  const error = await Promise.resolve()
    .then(() => client.request('textDocument/completion', {}))
    .then(
      () => undefined,
      (error: unknown) => error,
    )

  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ name: 'Error', message: 'LSP client is not connected' })
  reportRequestError({ error, method: 'textDocument/completion', serverId: 'typescript' })

  expect(failed).toHaveBeenCalledWith({
    action: 'lsp.request_failed',
    area: 'lsp',
    error,
    method: 'textDocument/completion',
    serverId: 'typescript',
  })
  expect(debugged).not.toHaveBeenCalled()
})
