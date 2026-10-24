import { expect, test, vi } from 'vitest'
import {
  createShikiWorkerOwner,
  createShikiHighlighterProvider,
} from '@singapore-editor/core/shiki'
import { retainHighlighter } from './fixtures/document'
import { createHighlightingService } from '../src/index'

function busyWorker() {
  const worker = new Worker(new URL('./fixtures/busy.worker.ts', import.meta.url), {
    type: 'module',
  })
  const started = new Promise<void>((resolve) => {
    worker.addEventListener('message', ({ data }) => {
      if (data.busy) resolve()
    })
  })
  return { worker, started }
}

test('normal browser-worker requests answer before idempotent owner disposal', async () => {
  const { worker } = busyWorker()
  const terminate = vi.spyOn(worker, 'terminate')
  const owner = createShikiWorkerOwner({ workerFactory: () => worker })
  try {
    await expect(
      owner.loadTheme({
        theme: 'fixture',
        registrations: {
          languageRegistrations: [],
          themeRegistration: { name: 'fixture' },
          themeRegistrations: [],
        },
      }),
    ).resolves.toEqual({ backgroundColor: 'ready' })
    const disposal = owner.dispose()
    expect(owner.dispose()).toBe(disposal)
    await disposal
    expect(terminate).toHaveBeenCalledOnce()
    expect(owner.inspect()).toMatchObject({ lifecycle: 'disposed', pendingRequests: 0 })
  } finally {
    worker.terminate()
  }
})

test('owner terminates a synchronously busy browser worker and settles its request and idle fence', async () => {
  const { worker, started } = busyWorker()
  const terminate = vi.spyOn(worker, 'terminate')
  const owner = createShikiWorkerOwner({ workerFactory: () => worker })
  const retained = retainHighlighter(
    createShikiHighlighterProvider({
      workerOwner: owner,
      theme: 'fixture',
      resolveTheme: async () => ({ name: 'fixture' }),
      resolveLanguage: async () => [
        { name: 'typescript', scopeName: 'source.typescript', patterns: [] },
      ],
    }),
    'const a = 1',
  )
  try {
    const result = retained.session
      .refresh(retained.buffer.getTextSnapshot())
      .catch((error: unknown) => error)
    await started
    const idle = owner.awaitIdleFence()
    const disposal = owner.dispose()
    expect(terminate).toHaveBeenCalledOnce()
    await disposal
    expect(await result).toMatchObject({ name: 'AbortError' })
    await idle
    expect(owner.inspect()).toMatchObject({ lifecycle: 'disposed', pendingRequests: 0 })
  } finally {
    retained.dispose()
    worker.terminate()
  }
})

test('service disposal settles callers and idle while its browser worker cannot answer', async () => {
  const { worker, started } = busyWorker()
  const terminate = vi.spyOn(worker, 'terminate')
  const service = createHighlightingService({ shikiWorker: () => worker })
  try {
    const result = service
      .highlight('const a = 1', {
        language: 'typescript',
        theme: { format: 'vscode', definition: { name: 'fixture', colors: {}, tokenColors: [] } },
      })
      .catch((error: unknown) => error)
    await started
    const idle = service.awaitIdle()
    const disposal = service.dispose()
    expect(service.dispose()).toBe(disposal)
    expect(await result).toMatchObject({ code: 'disposed' })
    await vi.waitFor(() => expect(terminate).toHaveBeenCalledOnce())
    await disposal
    await idle
    expect(service.inspect()).toMatchObject({ disposed: true, pendingHighlights: 0, shiki: null })
  } finally {
    worker.terminate()
  }
})
