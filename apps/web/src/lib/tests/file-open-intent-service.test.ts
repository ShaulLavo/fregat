import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  createEditorBufferSession,
  createEditorTextBuffer,
  type EditorInitialPaintEvent,
  type EditorPreparedDocument,
} from '@singapor/core'
import type { FileResult } from '@/lib/file-system-types'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import {
  createFileOpenIntentServiceOwner,
  type FileOpenIntentService,
  type FileOpenIntentServiceOwner,
  type FileOpenIntentEventFactory,
  type FileOpenIntentPreparer,
  type FileOpenIntentLiveDocument,
  type FileOpenIntentRuntime,
  type FileOpenIntentStructuralRange,
} from '@/lib/file-open-intent/state/service'

describe('file open intent service', () => {
  it('prepares and claims one exact fetched revision once', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const preparedDocument = preparedDocumentLease()
    const prepare = vi.fn((buffer) => ({ buffer, preparedDocument }))
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer(prepare),
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')

    service.prepare(intent('/repo/a.ts'))
    expect(prepare).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
    const claim = service.claimReadyClean('/repo/a.ts')

    expect(claim).toMatchObject({
      file,
      fileVersion: file.version,
      kind: 'clean',
      path: file.path,
      preparedDocument,
    })
    expect(claim?.buffer.getSnapshot()).toBe(claim?.snapshot)
    expect(service.claimReadyClean('/repo/a.ts')).toBeNull()
  })

  it('enforces root boundaries including the filesystem root', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const prepare = vi.fn()
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer(prepare),
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')

    service.prepare(intent('/repo-other/a.ts'))
    await Promise.resolve()

    expect(prepare).not.toHaveBeenCalled()

    service.setRoot('/')
    service.prepare({ ...intent(file.path), rootPath: '/' })
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())
  })

  it('disposes stale live preparation but still claims the authoritative buffer', async () => {
    const queryClient = new QueryClient()
    const buffer = createEditorTextBuffer('alpha\n')
    const preparedDocument = preparedDocumentLease()
    let liveDocument: FileOpenIntentLiveDocument | null = {
      buffer,
      id: '/repo/a.ts',
      localRevision: 1,
      path: '/repo/a.ts',
    }
    const prepare = vi.fn((preparedBuffer) => ({
      buffer: preparedBuffer,
      preparedDocument,
    }))
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer(prepare),
      () => liveDocument,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')
    service.prepare(intent('/repo/a.ts'))
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))

    createEditorBufferSession(buffer).applyText('x')
    liveDocument = { ...liveDocument, localRevision: 2 }

    expect(service.claimLive('/repo/a.ts')).toMatchObject({
      buffer,
      documentId: '/repo/a.ts',
      kind: 'live',
      localRevision: 2,
      preparedDocument: null,
    })
    expect(preparedDocument.dispose).toHaveBeenCalledTimes(1)
  })

  it('preserves prepared work across a disconnect/reconnect microtask replay', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const preparedDocument = preparedDocumentLease()
    const prepare = vi.fn((buffer) => ({ buffer, preparedDocument }))
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer(prepare),
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')
    service.connect()
    service.prepare(intent(file.path))
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())

    service.scheduleDisconnect()
    service.connect()
    await Promise.resolve()

    expect(service.claimReadyClean(file.path)?.preparedDocument).toBe(preparedDocument)
    expect(preparedDocument.dispose).not.toHaveBeenCalled()
  })

  it('makes immediate owner disposal terminal', () => {
    const service = createTestFileOpenIntentOwner(
      new QueryClient(),
      testPreparer((buffer) => ({ buffer, preparedDocument: preparedDocumentLease() })),
      () => null,
      () => false,
      () => false,
      () => undefined,
    )

    service.disposeNow()

    expect(() => service.connect()).toThrow('disposed')
    expect(() => service.setRoot('/repo')).toThrow('disposed')
  })

  it('owns one subscription set across an idempotent connect and StrictMode replay', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const querySubscribe = vi.spyOn(queryClient.getQueryCache(), 'subscribe')
    const liveDocuments = listenerChannel<[]>()
    const mountedEditors = listenerChannel<[path: string, mounted: boolean]>()
    const runtime = trackingRuntime()
    const prepare = vi.fn((buffer: ReturnType<typeof createEditorTextBuffer>) => ({
      buffer,
      preparedDocument: preparedDocumentLease(),
    }))
    const owner = createFileOpenIntentServiceOwner({
      getLiveDocument: () => null,
      getRetainedScrollPosition: () => null,
      isActive: () => false,
      mountedEditors: {
        has: () => false,
        subscribe: mountedEditors.subscribe,
      },
      preparer: testPreparer(prepare),
      prefetchRelated: () => undefined,
      queryClient,
      runtime,
      subscribeLiveDocuments: liveDocuments.subscribe,
    })
    owner.setRoot('/repo')

    owner.connect()
    owner.connect()
    owner.service.prepare(intent(file.path))
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())
    expect(liveDocuments.active()).toBe(1)
    expect(mountedEditors.active()).toBe(1)
    expect(querySubscribe).toHaveBeenCalledOnce()
    expect(runtime.activeTimers()).toBe(1)
    expect(runtime.maxActiveTimers()).toBe(1)

    owner.scheduleDisconnect()
    owner.connect()
    await Promise.resolve()

    expect(liveDocuments.active()).toBe(1)
    expect(mountedEditors.active()).toBe(1)
    expect(querySubscribe).toHaveBeenCalledOnce()
    expect(runtime.activeTimers()).toBe(1)

    owner.scheduleDisconnect()
    await Promise.resolve()

    expect(liveDocuments.active()).toBe(0)
    expect(mountedEditors.active()).toBe(0)
    expect(runtime.activeTimers()).toBe(0)
  })

  it('proactively invalidates a live lease when its local snapshot identity advances', async () => {
    const buffer = createEditorTextBuffer('alpha\n')
    let liveDocument: FileOpenIntentLiveDocument = {
      buffer,
      id: '/repo/a.ts',
      localRevision: buffer.getRevision(),
      path: '/repo/a.ts',
    }
    const liveDocuments = listenerChannel<[]>()
    const preparedDocument = preparedDocumentLease()
    const prepare = vi.fn((preparedBuffer) => ({
      buffer: preparedBuffer,
      preparedDocument,
    }))
    const owner = createFileOpenIntentServiceOwner({
      getLiveDocument: () => liveDocument,
      getRetainedScrollPosition: () => null,
      isActive: () => false,
      mountedEditors: inertMountedEditors(),
      preparer: testPreparer(prepare),
      prefetchRelated: () => undefined,
      queryClient: new QueryClient(),
      subscribeLiveDocuments: liveDocuments.subscribe,
    })
    owner.setRoot('/repo')
    owner.connect()
    owner.service.prepare(intent(liveDocument.path))
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())

    createEditorBufferSession(buffer).applyText('changed')
    liveDocument = { ...liveDocument, localRevision: buffer.getRevision() }
    liveDocuments.emit()

    expect(preparedDocument.dispose).toHaveBeenCalledOnce()
    expect(owner.service.claimLive(liveDocument.path)).toMatchObject({
      localRevision: liveDocument.localRevision,
      preparedDocument: null,
    })
  })

  it('preserves a clean lease for fetch-status updates and invalidates version or data loss', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    const queryKey = fileSnapshotQueryOptions(file.path).queryKey
    queryClient.setQueryData(queryKey, file)
    const preparedDocument = preparedDocumentLease()
    const first = createConnectedOwner({ queryClient, preparedDocument })
    const owner = first.owner

    owner.service.prepare(intent(file.path))
    await vi.waitFor(() => expect(first.prepare).toHaveBeenCalledOnce())
    const refresh = deferred<FileResult>()
    const refreshPromise = queryClient.fetchQuery({
      ...fileSnapshotQueryOptions(file.path),
      queryFn: () => refresh.promise,
      staleTime: 0,
    })
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('fetching'),
    )
    expect(preparedDocument.dispose).not.toHaveBeenCalled()
    refresh.resolve(file)
    await refreshPromise
    expect(preparedDocument.dispose).not.toHaveBeenCalled()

    queryClient.setQueryData(queryKey, { ...file, version: 'v2' })
    expect(preparedDocument.dispose).toHaveBeenCalledOnce()
    expect(owner.service.claimReadyClean(file.path)).toBeNull()

    const removedDocument = preparedDocumentLease()
    const second = createConnectedOwner({ queryClient, preparedDocument: removedDocument })
    const secondOwner = second.owner
    secondOwner.service.prepare(intent(file.path))
    await vi.waitFor(() => expect(second.prepare).toHaveBeenCalledOnce())
    queryClient.getQueryCache().find({ exact: true, queryKey })?.setState({ data: undefined })
    expect(removedDocument.dispose).toHaveBeenCalledOnce()
  })

  it('does not retain a clean lease when its query revision changes during construction', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    const queryKey = fileSnapshotQueryOptions(file.path).queryKey
    queryClient.setQueryData(queryKey, file)
    const preparedDocument = preparedDocumentLease()
    const prepare = vi.fn((buffer: ReturnType<typeof createEditorTextBuffer>) => {
      queryClient.setQueryData(queryKey, { ...file, version: 'v2' })
      return { buffer, preparedDocument }
    })
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer(prepare),
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')

    service.prepare(intent(file.path))

    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(preparedDocument.dispose).toHaveBeenCalledOnce())
    expect(service.claimReadyClean(file.path)).toBeNull()
  })

  it('refreshes one queued structural stage from a far-down retained scroll seed', async () => {
    const path = '/repo/large.ts'
    const content = 'a'.repeat(800_000)
    const file = { ...fileResult(path), content, size: content.length }
    const queryClient = new QueryClient()
    queryClient.setQueryData(fileSnapshotQueryOptions(path).queryKey, file)
    const runtime = manualRuntime()
    const preparedDocument = preparedDocumentLease()
    const events = recordingEvents()
    const ranges: FileOpenIntentStructuralRange[] = []
    let scrollPosition = { left: 0, top: 120_000 }
    const highlighter = vi.fn(async () => undefined)
    const structural = vi.fn(async () => undefined)
    const preparer: FileOpenIntentPreparer = {
      environment: testEnvironment('ranges'),
      prepare: (buffer, _documentId, _path, _abortSignal, structuralRange) => {
        ranges.push(structuralRange)
        return rangePreparation(buffer, preparedDocument, structuralRange, highlighter, structural)
      },
      reconfigure: (
        _preparedDocument,
        buffer,
        _documentId,
        _path,
        _abortSignal,
        structuralRange,
      ) => {
        ranges.push(structuralRange)
        return rangePreparation(buffer, preparedDocument, structuralRange, highlighter, structural)
      },
    }
    const owner = createFileOpenIntentServiceOwner({
      createEvent: events.factory,
      getLiveDocument: () => null,
      getRetainedScrollPosition: () => scrollPosition,
      isActive: () => false,
      mountedEditors: inertMountedEditors(),
      preparer,
      prefetchRelated: () => undefined,
      queryClient,
      runtime,
      subscribeLiveDocuments: () => () => undefined,
    })
    owner.setRoot('/repo')
    owner.connect()

    owner.service.prepare(intent(path))
    runtime.startNext()
    await vi.waitFor(() => expect(runtime.queued()).toBe(1))
    expect(ranges[0]?.startIndex).toBeGreaterThan(500_000)
    const initialRange = { ...ranges[0]! }

    scrollPosition = { left: 0, top: 140_000 }
    owner.service.prepare(intent(path))
    expect(ranges).toHaveLength(2)
    const refreshedRange = { ...ranges[1]! }
    expect(refreshedRange.startIndex).toBeGreaterThan(initialRange.startIndex)

    owner.service.prepare(intent(path))
    expect(ranges).toHaveLength(2)
    owner.disposeNow()
    expect(events.emitted[0]).toMatchObject({
      preparation: { ranges: { structural: refreshedRange } },
    })
  })

  it('runs the most recent queued intent before older queued work', async () => {
    const queryClient = new QueryClient()
    const first = deferred<FileResult>()
    const paths = ['/repo/a.ts', '/repo/b.ts', '/repo/c.ts'] as const
    void queryClient.fetchQuery({
      ...fileSnapshotQueryOptions(paths[0]),
      queryFn: () => first.promise,
    })
    for (const path of paths.slice(1)) {
      queryClient.setQueryData(fileSnapshotQueryOptions(path).queryKey, fileResult(path))
    }
    const order: string[] = []
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer((buffer, _documentId, path) => {
        order.push(path)
        return { buffer, preparedDocument: preparedDocumentLease() }
      }),
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')

    service.prepare(intent(paths[0]))
    service.prepare(intent(paths[1]))
    service.prepare(intent(paths[2]))
    first.resolve(fileResult(paths[0]))
    await vi.waitFor(() => expect(order).toHaveLength(3))

    expect(order).toEqual([paths[0], paths[2], paths[1]])
  })

  it('evicts settled stage results when their retained bytes exceed the service budget', async () => {
    const queryClient = new QueryClient()
    const paths = Array.from({ length: 8 }, (_, index) => `/repo/${index}.ts`)
    for (const path of paths) {
      queryClient.setQueryData(fileSnapshotQueryOptions(path).queryKey, fileResult(path))
    }
    let settledStages = 0
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer((buffer) => {
        let estimatedBytes = 1
        const preparedDocument = preparedDocumentLease()
        Object.defineProperty(preparedDocument, 'estimatedBytes', {
          get: () => estimatedBytes,
        })
        return {
          buffer,
          preparedDocument,
          startStages: [
            async () => {
              estimatedBytes = 5 * 1024 * 1024
              settledStages += 1
            },
          ],
        }
      }),
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')

    for (const path of paths) service.prepare(intent(path))
    await vi.waitFor(() => expect(settledStages).toBe(paths.length))

    expect(service.claimReadyClean(paths[0]!)).toBeNull()
    expect(service.claimReadyClean(paths.at(-1)!)).toBeNull()
    expect(service.claimReadyClean(paths[1]!)).not.toBeNull()
  })

  it('lets activation claim document data before queued provider stages start', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const runtime = manualRuntime()
    const startHighlighter = vi.fn(async () => 'ready')
    const startStructural = vi.fn(async () => 'ready')
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer((buffer) => ({
        buffer,
        preparedDocument: preparedDocumentLease(),
        startStages: [startHighlighter, startStructural],
      })),
      () => null,
      () => false,
      () => false,
      () => undefined,
      runtime,
    )
    service.setRoot('/repo')

    service.prepare(intent(file.path))
    expect(runtime.queued()).toBe(1)
    runtime.startNext()
    await vi.waitFor(() => expect(runtime.queued()).toBe(1))

    expect(service.claimReadyClean(file.path)).not.toBeNull()
    runtime.startNext()
    await runtime.settled()

    expect(startHighlighter).not.toHaveBeenCalled()
    expect(startStructural).not.toHaveBeenCalled()
  })

  it('does not start a queued provider stage after service disposal', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    const runtime = manualRuntime()
    const preparedDocument = preparedDocumentLease()
    const startHighlighter = vi.fn(async () => 'ready')
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer((buffer) => ({
        buffer,
        preparedDocument,
        startStages: [startHighlighter],
      })),
      () => null,
      () => false,
      () => false,
      () => undefined,
      runtime,
    )
    service.setRoot('/repo')

    service.prepare(intent(file.path))
    runtime.startNext()
    await vi.waitFor(() => expect(runtime.queued()).toBe(1))
    service.disposeNow()
    runtime.startNext()
    await runtime.settled()

    expect(preparedDocument.dispose).toHaveBeenCalledOnce()
    expect(startHighlighter).not.toHaveBeenCalled()
  })

  it('relinquishes service cancellation after a prepared claim', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    const stage = deferred<string>()
    let preparationSignal: AbortSignal | null = null
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer((buffer, _documentId, _path, abortSignal) => {
        preparationSignal = abortSignal
        return {
          buffer,
          preparedDocument: preparedDocumentLease(),
          startStages: [() => stage.promise],
        }
      }),
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')

    service.prepare(intent(file.path))
    await vi.waitFor(() => expect(preparationSignal).not.toBeNull())
    expect(service.claimReadyClean(file.path)).not.toBeNull()

    service.setRoot(null)
    const claimedSignal = preparationSignal as AbortSignal | null
    if (!claimedSignal) throw new RangeError('missing preparation signal')
    expect(claimedSignal.aborted).toBe(false)
    stage.resolve('ready')
  })

  it('expires an abandoned prepared session without later service activity', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    const preparedDocument = preparedDocumentLease()
    const runtime = manualRuntime()
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer((buffer) => ({ buffer, preparedDocument })),
      () => null,
      () => false,
      () => false,
      () => undefined,
      runtime,
    )
    service.setRoot('/repo')

    service.prepare(intent(file.path))
    runtime.startNext()
    await runtime.settled()
    runtime.advanceBy(30_000)

    expect(preparedDocument.dispose).toHaveBeenCalledOnce()
    expect(service.claimReadyClean(file.path)).toBeNull()
  })

  it('expires a prepared session after thirty seconds without intent or stage activity', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    const preparedDocument = preparedDocumentLease()
    const runtime = manualRuntime()
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer((buffer) => ({ buffer, preparedDocument })),
      () => null,
      () => false,
      () => false,
      () => undefined,
      runtime,
    )
    service.setRoot('/repo')

    service.prepare(intent(file.path))
    runtime.startNext()
    await runtime.settled()
    runtime.advanceBy(2_000)
    service.prepare(intent(file.path))
    runtime.advanceBy(28_000)

    expect(preparedDocument.dispose).not.toHaveBeenCalled()
    runtime.advanceBy(2_000)
    expect(preparedDocument.dispose).toHaveBeenCalledOnce()
  })

  it('preserves unaffected prepared leases when the environment changes', async () => {
    const queryClient = new QueryClient()
    const typescript = fileResult('/repo/a.ts')
    const markdown = fileResult('/repo/b.md')
    queryClient.setQueryData(fileSnapshotQueryOptions(typescript.path).queryKey, typescript)
    queryClient.setQueryData(fileSnapshotQueryOptions(markdown.path).queryKey, markdown)
    const typescriptDocument = preparedDocumentLease()
    const oldMarkdownDocument = preparedDocumentLease()
    const newMarkdownDocument = preparedDocumentLease()
    const oldStage = vi.fn(async () => 'ready')
    const newStage = vi.fn(async () => 'ready')
    const prepareInitial = vi.fn((buffer, _documentId, path) => ({
      buffer,
      documentConfigurationTag: ['document', path],
      preparedDocument: path === typescript.path ? typescriptDocument : oldMarkdownDocument,
      stages:
        path === markdown.path
          ? [
              {
                configurationTag: ['markdown', 'old'],
                family: 'structural' as const,
                provider: oldStage,
                start: oldStage,
              },
            ]
          : [],
    }))
    const service = createTestFileOpenIntentOwner(
      queryClient,
      {
        environment: testEnvironment('old'),
        prepare: prepareInitial,
        reconfigure: (_preparedDocument, _buffer, _documentId, path) => ({
          documentConfigurationTag: ['document', path],
          stages:
            path === markdown.path
              ? [
                  {
                    configurationTag: ['markdown', 'old'],
                    family: 'structural' as const,
                    provider: oldStage,
                    start: oldStage,
                  },
                ]
              : [],
        }),
      },
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')
    service.prepare(intent(typescript.path))
    service.prepare(intent(markdown.path))
    await vi.waitFor(() => expect(prepareInitial).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(oldStage).toHaveBeenCalledOnce())

    const prepareNext = vi.fn((buffer, _documentId, path) => ({
      buffer,
      documentConfigurationTag: ['document', path],
      preparedDocument: path === markdown.path ? newMarkdownDocument : typescriptDocument,
      stages:
        path === markdown.path
          ? [
              {
                configurationTag: ['markdown', 'new'],
                family: 'structural' as const,
                provider: newStage,
                start: newStage,
              },
            ]
          : [],
    }))
    service.setEnvironment({
      environment: testEnvironment('new'),
      prepare: prepareNext,
      reconfigure: (_preparedDocument, _buffer, _documentId, path) => ({
        documentConfigurationTag: ['document', path],
        stages:
          path === markdown.path
            ? [
                {
                  configurationTag: ['markdown', 'new'],
                  family: 'structural' as const,
                  provider: newStage,
                  start: newStage,
                },
              ]
            : [],
      }),
    })
    await vi.waitFor(() => expect(prepareNext).toHaveBeenCalledOnce())

    expect(service.claimReadyClean(typescript.path)?.preparedDocument).toBe(typescriptDocument)
    expect(typescriptDocument.dispose).not.toHaveBeenCalled()
    expect(oldMarkdownDocument.dispose).toHaveBeenCalledOnce()
    expect(service.claimReadyClean(markdown.path)?.preparedDocument).toBe(newMarkdownDocument)
  })

  it('replaces only an unstarted family when the environment changes', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    const runtime = manualRuntime()
    const preparedDocument = preparedDocumentLease()
    const replacementDocument = preparedDocumentLease()
    const highlighterCompletion = deferred<string>()
    const startHighlighter = vi.fn(() => highlighterCompletion.promise)
    const startOldStructural = vi.fn(async () => 'old')
    const startNewStructural = vi.fn(async () => 'new')
    const highlighterStage = {
      configurationTag: ['shiki', 'same'] as const,
      family: 'highlighter' as const,
      provider: startHighlighter,
      start: startHighlighter,
    }
    const oldStructuralStage = {
      configurationTag: ['tree-sitter', 'old'] as const,
      family: 'structural' as const,
      provider: startOldStructural,
      start: startOldStructural,
    }
    const newStructuralStage = {
      configurationTag: ['tree-sitter', 'new'] as const,
      family: 'structural' as const,
      provider: startNewStructural,
      start: startNewStructural,
    }
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const initialPrepare = vi.fn((buffer) => ({
      buffer,
      documentConfigurationTag: ['document', 'same'] as const,
      preparedDocument,
      stages: [highlighterStage, oldStructuralStage],
    }))
    const service = createTestFileOpenIntentOwner(
      queryClient,
      {
        environment: testEnvironment('old'),
        prepare: initialPrepare,
        reconfigure: () => ({
          documentConfigurationTag: ['document', 'same'],
          stages: [highlighterStage, oldStructuralStage],
        }),
      },
      () => null,
      () => false,
      () => false,
      () => undefined,
      runtime,
    )
    service.setRoot('/repo')

    service.prepare(intent(file.path))
    runtime.startNext()
    await vi.waitFor(() => expect(runtime.queued()).toBe(1))
    runtime.startNext()
    await vi.waitFor(() => expect(startHighlighter).toHaveBeenCalledOnce())

    const replacementPrepare = vi.fn((buffer) => ({
      buffer,
      documentConfigurationTag: ['document', 'same'] as const,
      preparedDocument: replacementDocument,
      stages: [highlighterStage, newStructuralStage],
    }))
    service.setEnvironment({
      environment: testEnvironment('new'),
      prepare: replacementPrepare,
      reconfigure: () => ({
        documentConfigurationTag: ['document', 'same'],
        stages: [highlighterStage, newStructuralStage],
      }),
    })
    highlighterCompletion.resolve('ready')
    await vi.waitFor(() => expect(runtime.queued()).toBe(1))
    runtime.startNext()
    await runtime.settled()

    expect(replacementPrepare).not.toHaveBeenCalled()
    expect(preparedDocument.dispose).not.toHaveBeenCalled()
    expect(startOldStructural).not.toHaveBeenCalled()
    expect(startNewStructural).toHaveBeenCalledOnce()
    expect(service.claimReadyClean(file.path)?.preparedDocument).toBe(preparedDocument)
  })

  it('compares environment fields without delimiter collisions', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    const preparedDocument = preparedDocumentLease()
    const prepare = vi.fn((buffer) => ({
      buffer,
      documentConfigurationTag: [],
      preparedDocument,
      stages: [],
    }))
    const reconfigure = vi.fn(() => ({ documentConfigurationTag: [], stages: [] }))
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const service = createTestFileOpenIntentOwner(
      queryClient,
      {
        environment: {
          configurationTag: ['a\u0000b', 'c'],
          highlighterProvider: null,
          structuralProvider: null,
        },
        prepare,
        reconfigure,
      },
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')
    service.prepare(intent(file.path))
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())

    service.setEnvironment({
      environment: {
        configurationTag: ['a', 'b\u0000c'],
        highlighterProvider: null,
        structuralProvider: null,
      },
      prepare: () => {
        throw new RangeError('unexpected rebuild')
      },
      reconfigure,
    })

    expect(reconfigure).toHaveBeenCalledOnce()
  })

  it('emits one lifecycle-wide event after dedupe and promotion', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    const runtime = manualRuntime()
    const events = recordingEvents()
    const lsp = deferred<void>()
    const startHighlighter = vi.fn(async () => 'ready')
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer((buffer) => ({
        buffer,
        preparedDocument: preparedDocumentLease(),
        startStages: [startHighlighter],
      })),
      () => null,
      () => false,
      () => false,
      () => lsp.promise,
      runtime,
      events.factory,
    )
    service.setRoot('/repo')

    service.prepare(intent(file.path))
    service.prepare({
      knownSize: file.size,
      path: file.path,
      rootPath: '/repo',
      source: 'file-tree',
    })
    runtime.startNext()
    await vi.waitFor(() => expect(runtime.queued()).toBe(1))
    runtime.startNext()
    await runtime.settled()

    expect(events.emitted).toEqual([])
    expect(service.claimReadyClean(file.path)).not.toBeNull()
    expect(events.emitted).toEqual([])
    service.recordInitialPaint(file.path, {
      documentGeneration: 1,
      documentId: file.path,
      phase: 'text',
      textVersion: 1,
    })
    expect(events.emitted).toEqual([])
    service.recordInitialPaint(file.path, {
      documentGeneration: 1,
      documentId: file.path,
      phase: 'highlight-settled',
      status: 'painted',
      textVersion: 1,
    })
    expect(events.emitted).toEqual([])
    lsp.resolve(undefined)
    await vi.waitFor(() => expect(events.emitted).toHaveLength(1))
    expect(events.emitted[0]).toMatchObject({
      action: 'editor.file_open_intent',
      area: 'editor',
      dedupeCount: 1,
      preparationEnvironment: {
        configurationTag: ['test'],
        generation: 0,
        providers: { highlighter: false, structural: false },
      },
      fileSize: file.size,
      hasTab: true,
      intentSource: 'tab',
      intentSources: ['tab', 'file-tree'],
      knownSize: file.size,
      outcome: 'promoted',
      pathClassification: 'descendant',
      preparation: {
        documentConfigurationTag: [],
        estimatedBytes: 1,
        providerConfiguration: {
          highlighter: { configurationTag: ['test-stage', 0], generation: 0 },
        },
        ranges: { highlighter: null },
        status: 'ready-clean',
      },
      postActivation: {
        bufferBuilds: 0,
        diagnosticsObserved: false,
        fileReads: 0,
        highlighterSessionCreations: 0,
        highlightPaintMs: 0,
        lineIndexScans: 0,
        structuralSessionCreations: 0,
        textPaintMs: 0,
        workerOpenRequests: 0,
        workerParseRequests: 0,
        workerQueryRequests: 0,
        workerRefreshRequests: 0,
      },
      promotion: {
        kind: 'clean',
        paintOutcome: 'painted',
        stages: { highlighter: 'settled', structural: 'absent' },
      },
      query: { cacheHit: true, joined: false, status: 'success' },
      rootPath: '/repo',
      sourceState: 'clean',
      stages: {
        buffer: { durationMs: 0 },
        highlighter: { durationMs: 0, status: 'ready' },
        line: { durationMs: 0, scope: 'document-data' },
        lsp: { durationMs: 0, status: 'ready' },
      },
    })
  })

  it('attributes promotion paint only to the claimed document and its first text paint', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    const liveDocument: FileOpenIntentLiveDocument = {
      buffer: createEditorTextBuffer(file.content),
      id: 'document-a',
      localRevision: 1,
      path: file.path,
    }
    const runtime = manualRuntime()
    const events = recordingEvents()
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer((buffer) => ({
        buffer,
        preparedDocument: preparedDocumentLease(),
      })),
      () => liveDocument,
      () => false,
      () => false,
      () => undefined,
      runtime,
      events.factory,
    )
    service.setRoot('/repo')
    service.prepare(intent(file.path))
    runtime.startNext()
    await runtime.settled()
    expect(service.claimLive(file.path)?.documentId).toBe(liveDocument.id)

    const textPaint = {
      documentGeneration: 7,
      documentId: liveDocument.id,
      phase: 'text',
      textVersion: 3,
    } satisfies EditorInitialPaintEvent
    const highlightPaint = {
      ...textPaint,
      phase: 'highlight-settled',
      status: 'painted',
    } satisfies EditorInitialPaintEvent

    service.recordInitialPaint(file.path, { ...textPaint, documentId: file.path })
    service.recordInitialPaint(file.path, highlightPaint)
    expect(events.emitted).toEqual([])

    service.recordInitialPaint(file.path, textPaint)
    service.recordInitialPaint(file.path, { ...highlightPaint, documentId: file.path })
    expect(events.emitted).toEqual([])
    service.recordInitialPaint(file.path, { ...highlightPaint, documentGeneration: 8 })
    expect(events.emitted).toEqual([])
    service.recordInitialPaint(file.path, { ...highlightPaint, textVersion: 4 })
    expect(events.emitted).toEqual([])

    service.recordInitialPaint(file.path, highlightPaint)
    expect(events.emitted).toHaveLength(1)
    expect(events.emitted[0]).toMatchObject({
      outcome: 'promoted',
      promotion: { paintOutcome: 'painted' },
    })
  })

  it('does not admit an old completion after root to null to root', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    const pending = deferred<FileResult>()
    void queryClient.fetchQuery({
      ...fileSnapshotQueryOptions(file.path),
      queryFn: () => pending.promise,
    })
    const prepare = vi.fn((buffer) => ({
      buffer,
      preparedDocument: preparedDocumentLease(),
    }))
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer(prepare),
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')
    service.prepare(intent(file.path))

    service.setRoot(null)
    service.setRoot('/repo')
    pending.resolve(file)
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(fileSnapshotQueryOptions(file.path).queryKey)).toEqual(file),
    )

    expect(prepare).not.toHaveBeenCalled()
    expect(service.claimReadyClean(file.path)).toBeNull()
  })

  it('treats an equivalent root replay as a no-op', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const preparedDocument = preparedDocumentLease()
    const prepare = vi.fn((buffer) => ({ buffer, preparedDocument }))
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer(prepare),
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')
    service.prepare(intent(file.path))
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())

    service.setRoot('/repo/./')

    expect(service.claimReadyClean(file.path)?.preparedDocument).toBe(preparedDocument)
    expect(preparedDocument.dispose).not.toHaveBeenCalled()
  })

  it('does no query or preparation work for an actually mounted path', async () => {
    const queryClient = new QueryClient()
    const prepare = vi.fn()
    const prefetchRelated = vi.fn()
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer(prepare),
      () => null,
      () => false,
      () => true,
      prefetchRelated,
    )
    service.setRoot('/repo')

    service.prepare(intent('/repo/a.ts'))
    await Promise.resolve()

    expect(prefetchRelated).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('does no intent work for the active file', async () => {
    const queryClient = new QueryClient()
    const prepare = vi.fn()
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer(prepare),
      () => null,
      (path) => path === '/repo/a.ts',
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')

    service.prepare(intent('/repo/a.ts'))
    await Promise.resolve()

    expect(prepare).not.toHaveBeenCalled()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('scopes, quarantines, drains, and releases benchmark intent work', async () => {
    const queryClient = new QueryClient()
    const file = fileResult('/repo/a.ts')
    queryClient.setQueryData(fileSnapshotQueryOptions(file.path).queryKey, file)
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer((buffer) => ({ buffer, preparedDocument: preparedDocumentLease() })),
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')
    service.connect()
    const sample = service.beginBenchmarkSample({ path: file.path, rootPath: '/repo' })

    service.prepare(intent(file.path))
    await vi.waitFor(() => expect(service.claimReadyClean(file.path)).not.toBeNull())
    sample.quarantine()

    await expect(sample.quiesce()).resolves.toEqual({
      evictions: 0,
      nonTargetIntents: 0,
      preparedClaims: 1,
      promotedBytes: 1,
      highlighterRuntimeSessionIds: [],
      structuralRuntimeSessionIds: [],
      transferredHighlighterRuntimeSessionIds: [],
      transferredStructuralRuntimeSessionIds: [],
      targetIntents: 1,
      wastedIntents: 0,
    })
    sample.release()
    expect(() => sample.quarantine()).toThrow('already quarantined')
    expect(() => sample.quiesce()).toThrow('already released')
  })

  it('reports every runtime session created inside a benchmark scope', async () => {
    const queryClient = new QueryClient()
    const target = fileResult('/repo/a.ts')
    const nonTarget = fileResult('/repo/b.ts')
    queryClient.setQueryData(fileSnapshotQueryOptions(target.path).queryKey, target)
    queryClient.setQueryData(fileSnapshotQueryOptions(nonTarget.path).queryKey, nonTarget)
    const documents = new Map([
      [target.path, preparedDocumentLease({ highlighter: ['target-h'], structural: ['target-s'] })],
      [
        nonTarget.path,
        preparedDocumentLease({ highlighter: ['other-h'], structural: ['other-s'] }),
      ],
    ])
    const service = createTestFileOpenIntentOwner(
      queryClient,
      testPreparer((buffer, _documentId, path) => ({
        buffer,
        preparedDocument: documents.get(path)!,
      })),
      () => null,
      () => false,
      () => false,
      () => undefined,
    )
    service.setRoot('/repo')
    service.connect()
    const sample = service.beginBenchmarkSample({ path: target.path, rootPath: '/repo' })

    service.prepare(intent(target.path))
    service.prepare(intent(nonTarget.path))
    await vi.waitFor(() => expect(service.claimReadyClean(target.path)).not.toBeNull())
    await vi.waitFor(() => expect(service.claimReadyClean(nonTarget.path)).not.toBeNull())
    sample.quarantine()

    await expect(sample.quiesce()).resolves.toMatchObject({
      highlighterRuntimeSessionIds: ['target-h', 'other-h'],
      structuralRuntimeSessionIds: ['target-s', 'other-s'],
    })
  })
})

function createTestFileOpenIntentOwner(
  queryClient: QueryClient,
  preparer: FileOpenIntentPreparer,
  getLiveDocument: (path: string) => FileOpenIntentLiveDocument | null,
  isActive: (path: string) => boolean,
  isMounted: (path: string) => boolean,
  prefetchRelated: (rootPath: string, path: string) => Promise<unknown> | void,
  runtime?: FileOpenIntentRuntime,
  createEvent?: FileOpenIntentEventFactory,
): FileOpenIntentServiceOwner & FileOpenIntentService {
  const owner = createFileOpenIntentServiceOwner({
    createEvent,
    getLiveDocument,
    getRetainedScrollPosition: () => null,
    isActive,
    mountedEditors: {
      has: isMounted,
      subscribe: () => () => undefined,
    },
    preparer,
    prefetchRelated,
    queryClient,
    runtime,
    subscribeLiveDocuments: () => () => undefined,
  })
  owner.connect()
  return Object.assign(owner, owner.service)
}

function createConnectedOwner({
  preparedDocument,
  queryClient,
}: {
  readonly preparedDocument: EditorPreparedDocument
  readonly queryClient: QueryClient
}) {
  const prepare = vi.fn((buffer: ReturnType<typeof createEditorTextBuffer>) => ({
    buffer,
    preparedDocument,
  }))
  const owner = createFileOpenIntentServiceOwner({
    getLiveDocument: () => null,
    getRetainedScrollPosition: () => null,
    isActive: () => false,
    mountedEditors: inertMountedEditors(),
    preparer: testPreparer(prepare),
    prefetchRelated: () => undefined,
    queryClient,
    subscribeLiveDocuments: () => () => undefined,
  })
  owner.setRoot('/repo')
  owner.connect()
  return { owner, prepare }
}

function inertMountedEditors() {
  return {
    has: () => false,
    subscribe: () => () => undefined,
  }
}

function listenerChannel<TArgs extends unknown[]>() {
  const listeners = new Set<(...args: TArgs) => void>()
  return {
    active: () => listeners.size,
    emit: (...args: TArgs) => {
      for (const listener of listeners) listener(...args)
    },
    subscribe: vi.fn((listener: (...args: TArgs) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
}

function rangePreparation(
  buffer: ReturnType<typeof createEditorTextBuffer>,
  preparedDocument: EditorPreparedDocument,
  structuralRange: FileOpenIntentStructuralRange,
  highlighter: () => Promise<unknown>,
  structural: () => Promise<unknown>,
) {
  return {
    buffer,
    documentConfigurationTag: [] as const,
    preparedDocument,
    stages: [
      {
        configurationTag: ['highlighter'] as const,
        family: 'highlighter' as const,
        provider: highlighter,
        range: 'full' as const,
        start: highlighter,
      },
      {
        configurationTag: ['structural'] as const,
        family: 'structural' as const,
        provider: structural,
        range: structuralRange,
        start: structural,
      },
    ],
  }
}

function fileResult(path: string): FileResult {
  return {
    content: 'alpha\n',
    mtimeMs: 1,
    path,
    size: 6,
    version: 'v1',
  }
}

function intent(path: string) {
  return { path, rootPath: '/repo', source: 'tab' as const, tabId: 'test-tab' }
}

function testPreparer(
  prepare: (
    buffer: ReturnType<typeof createEditorTextBuffer>,
    documentId: string,
    path: string,
    abortSignal: AbortSignal,
    structuralRange: FileOpenIntentStructuralRange,
  ) => {
    readonly buffer: ReturnType<typeof createEditorTextBuffer>
    readonly preparedDocument: EditorPreparedDocument
    readonly startStages?: readonly (() => Promise<unknown> | null)[]
  },
): FileOpenIntentPreparer {
  const startsByDocument = new WeakMap<
    EditorPreparedDocument,
    readonly (() => Promise<unknown> | null)[]
  >()
  const configuration = (
    starts: readonly (() => Promise<unknown> | null)[],
    structuralRange: FileOpenIntentStructuralRange,
  ) => ({
    documentConfigurationTag: [] as const,
    stages: starts.map((start, index) => ({
      configurationTag: ['test-stage', index] as const,
      family: index === 0 ? ('highlighter' as const) : ('structural' as const),
      provider: start,
      ...(index === 0 ? {} : { range: structuralRange }),
      start,
    })),
  })
  return {
    environment: testEnvironment('test'),
    prepare: (...args) => {
      const preparation = prepare(...args)
      const starts = preparation.startStages ?? []
      startsByDocument.set(preparation.preparedDocument, starts)
      return { ...preparation, ...configuration(starts, args[4]) }
    },
    reconfigure: (preparedDocument, _buffer, _documentId, _path, _abortSignal, structuralRange) =>
      configuration(startsByDocument.get(preparedDocument) ?? [], structuralRange),
  }
}

function testEnvironment(value: string) {
  return {
    configurationTag: [value],
    highlighterProvider: null,
    structuralProvider: null,
  }
}

function recordingEvents(): {
  readonly emitted: readonly Record<string, unknown>[]
  readonly factory: FileOpenIntentEventFactory
} {
  const emitted: Record<string, unknown>[] = []
  return {
    emitted,
    factory: (base) => {
      const context: Record<string, unknown> = structuredClone(base)
      let ended = false
      return {
        count: (path) => numberAtPath(context, path),
        end: (next = {}) => {
          if (ended) return
          ended = true
          Object.assign(context, next)
          emitted.push(structuredClone(context))
        },
        error: (error) => {
          mergeEventContext(context, { error: String(error) })
        },
        getContext: () => context,
        increment: (path, by = 1) =>
          setNumberAtPath(context, path, numberAtPath(context, path) + by),
        set: (next) => mergeEventContext(context, next),
        warn: (message) => mergeEventContext(context, { warning: message }),
      }
    },
  }
}

function mergeEventContext(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    if (Array.isArray(current) && Array.isArray(value)) {
      target[key] = [...current, ...value]
      continue
    }
    if (isRecord(current) && isRecord(value)) {
      mergeEventContext(current, value)
      continue
    }

    target[key] = value
  }
}

function numberAtPath(context: Record<string, unknown>, path: string): number {
  let current: unknown = context
  for (const key of path.split('.')) {
    if (!isRecord(current)) return 0
    current = current[key]
  }
  return typeof current === 'number' ? current : 0
}

function setNumberAtPath(context: Record<string, unknown>, path: string, value: number): void {
  const keys = path.split('.')
  let current = context
  for (const key of keys.slice(0, -1)) {
    const next = current[key]
    if (isRecord(next)) {
      current = next
      continue
    }

    const created: Record<string, unknown> = {}
    current[key] = created
    current = created
  }
  current[keys.at(-1)!] = value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function preparedDocumentLease(
  runtimeSessionIds = { highlighter: [] as string[], structural: [] as string[] },
): EditorPreparedDocument {
  return {
    dispose: vi.fn(),
    estimatedBytes: 1,
    runtimeSessionIds: () => runtimeSessionIds,
    startStage: vi.fn(() => null),
    take: vi.fn(() => null),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function trackingRuntime(): FileOpenIntentRuntime & {
  activeTimers(): number
  maxActiveTimers(): number
} {
  let activeTimers = 0
  let maxActiveTimers = 0
  return {
    activeTimers: () => activeTimers,
    maxActiveTimers: () => maxActiveTimers,
    now: () => Date.now(),
    schedule: (task) => Promise.resolve().then(task),
    scheduleTimer: () => {
      activeTimers += 1
      maxActiveTimers = Math.max(maxActiveTimers, activeTimers)
      let active = true
      return () => {
        if (!active) return
        active = false
        activeTimers -= 1
      }
    },
  }
}

function manualRuntime(): FileOpenIntentRuntime & {
  advanceBy(durationMs: number): void
  queued(): number
  startNext(): void
  settled(): Promise<void>
} {
  let now = Date.now()
  const tasks: Array<() => void> = []
  const timers = new Map<number, { readonly at: number; readonly task: () => void }>()
  let nextTimerId = 1
  const operations = new Set<Promise<unknown>>()
  return {
    advanceBy: (durationMs) => {
      now += durationMs
      for (const [id, timer] of timers) {
        if (timer.at > now) continue

        timers.delete(id)
        timer.task()
      }
    },
    now: () => now,
    queued: () => tasks.length,
    schedule: <T>(task: () => T | Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        tasks.push(() => {
          const operation = Promise.resolve().then(task)
          operations.add(operation)
          void operation.finally(() => operations.delete(operation))
          operation.then(resolve, reject)
        })
      }),
    settled: async () => {
      while (operations.size > 0) await Promise.allSettled(operations)
    },
    scheduleTimer: (task, delayMs) => {
      const id = nextTimerId
      nextTimerId += 1
      timers.set(id, { at: now + delayMs, task })
      return () => timers.delete(id)
    },
    startNext: () => tasks.shift()?.(),
  }
}
