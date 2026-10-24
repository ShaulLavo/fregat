import { EditorTokenStore } from '../src/syntax/tokenStore'
import { expect, it, vi } from 'vitest'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  acquireDocumentMutationLease,
  rotateDocumentSyncSegment,
  releaseDocumentMutationLease,
} from '../src/documentSession'
import { createEditorDocumentAnalysis } from '../src/editor/documentAnalysis'
import {
  defineDocumentOperation,
  createEditorHighlighterOperation,
} from '../src/editor/operationDefinitions'
import type {
  DocumentProjectionEndpoint,
  DocumentProjectionUpdate,
} from '../src/editor/documentDelivery'
import type { EditorViewContributionContext, EditorPlugin } from '../src/plugins'
import { createVisibleEditor } from './factories/visibleEditor'

it('reports a retained background failure before running an explicit highlighter retry', async () => {
  const buffer = createEditorTextBuffer('failure')
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'failure' })
  const failure = new TypeError('Controlled provider failure')
  const analyze = vi.fn(async () => {
    throw failure
  })
  const operation = createEditorHighlighterOperation(() => ({ analyze, dispose: () => {} }))
  const lease = analysis.borrowHighlighter({ provider: { operation }, languageId: 'fixture' })!
  try {
    await vi.waitFor(() => expect(lease.read().kind).toBe('failed'))
    expect(analyze).toHaveBeenCalledTimes(1)
    await expect(lease.refresh(buffer.getTextSnapshot())).rejects.toBe(failure)
    expect(analyze).toHaveBeenCalledTimes(1)
    await expect(lease.refresh(buffer.getTextSnapshot())).rejects.toBe(failure)
    expect(analyze).toHaveBeenCalledTimes(2)
  } finally {
    lease.dispose()
    analysis.dispose()
  }
})

it.each(['latest', 'pinned'] as const)(
  'rejects a cached result whose configuration changes before %s acceptance',
  async (kind) => {
    const buffer = createEditorTextBuffer('same')
    const analysis = createEditorDocumentAnalysis({
      buffer,
      documentId: 'configuration-acceptance',
    })
    let configuration = 'red'
    const operation = defineDocumentOperation(
      () => ({
        configurationKey: () => configuration,
        analyze: async () => configuration,
        dispose: () => {},
      }),
      () => true,
    )
    const audience = analysis.contributions.createAudience()
    const owner = analysis.contributions.pin()!
    const demand = kind === 'latest' ? { kind, audience } : { kind, owner }
    const lease = analysis.contributions.retain(operation, null)!
    const accepted: string[] = []
    try {
      expect(await analysis.contributions.request(operation, null, demand).settled).toMatchObject({
        kind: 'completed',
        result: 'red',
      })
      const cached = analysis.contributions.request(operation, null, {
        ...demand,
        accept: (result) => accepted.push(result),
      })
      configuration = 'green'
      expect(await cached.settled).toEqual({ kind: 'superseded' })
      expect(accepted).toEqual([])
      expect(await analysis.contributions.request(operation, null, demand).settled).toMatchObject({
        kind: 'completed',
        result: 'green',
      })
    } finally {
      lease.dispose()
      owner.dispose()
      audience.dispose()
      analysis.dispose()
    }
  },
)

it('recomputes the same revision after configuration changes and rejects a changed configuration in flight', async () => {
  const buffer = createEditorTextBuffer('unchanged')
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'configuration' })
  let configuration = 1
  let complete = () => {}
  let started = () => {}
  const held = new Promise<void>((resolve) => {
    started = resolve
  })
  const seen: number[] = []
  const operation = defineDocumentOperation(
    () => ({
      configurationKey: () => configuration,
      analyze: async () => {
        const captured = configuration
        seen.push(captured)
        if (captured !== 3) return captured
        started()
        await new Promise<void>((resolve) => {
          complete = resolve
        })
        return captured
      },
      dispose: () => complete(),
    }),
    () => true,
  )
  const lease = analysis.contributions.retain(operation, null)!
  try {
    expect(await lease.request()).toBe(1)
    expect(await lease.request()).toBe(1)
    configuration = 2
    expect(await lease.request()).toBe(2)
    configuration = 3
    const obsolete = expect(lease.request()).rejects.toMatchObject({ name: 'AbortError' })
    await held
    configuration = 4
    complete()
    await obsolete
    expect(await lease.request()).toBe(4)
    expect(seen).toEqual([1, 2, 3, 4])
    expect(buffer.getRevision()).toBe(0)
  } finally {
    lease.dispose()
    analysis.dispose()
  }
})

it('cancels an obsolete computation before starting newest work on the same entry', async () => {
  const buffer = createEditorTextBuffer('old')
  const view = createEditorBufferSession(buffer)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'cancel-work' })
  let started = () => {}
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  let cancelled = 0
  let completeOld = () => {}
  const reads: string[] = []
  const operation = defineDocumentOperation(
    () => ({
      analyze: async (read, signal) => {
        const text = read.text.readRange(0, read.text.length)
        reads.push(text)
        if (text !== 'old') return text
        started()
        return new Promise<string>((resolve, reject) => {
          completeOld = () => resolve(text)
          signal.addEventListener(
            'abort',
            () => {
              cancelled++
              reject(new DOMException('Cancelled work', 'AbortError'))
            },
            { once: true },
          )
        })
      },
      dispose: () => completeOld(),
    }),
    () => true,
  )
  const lease = analysis.contributions.retain(operation, null)!
  const old = lease.request()
  const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
  try {
    await firstStarted
    view.applyEdits([{ from: 0, to: 3, text: 'new' }])
    expect(await lease.request()).toBe('new')
    await rejected
    expect(reads).toEqual(['old', 'new'])
    expect(cancelled).toBe(1)
  } finally {
    lease.dispose()
    analysis.dispose()
  }
})

it('keeps ordered retained lanes current without requests and retires peers independently', async () => {
  const buffer = createEditorTextBuffer('ordered')
  const view = createEditorBufferSession(buffer)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'ordered' })
  const seen = new Map<string, unknown>()
  const disposed: string[] = []
  const operation = defineDocumentOperation(
    (_context, input: string) => ({
      analyze: async (read) => {
        seen.set(input, read.revision.point)
        return read.revision.point
      },
      dispose: () => {
        disposed.push(input)
      },
    }),
    (left, right) => left === right,
    { scheduling: 'ordered' },
  )
  const first = analysis.contributions.retain(operation, 'first')!
  const peer = analysis.contributions.retain(operation, 'peer')!
  try {
    await vi.waitFor(() =>
      expect([...seen.values()]).toEqual([
        buffer.getDocumentSyncPoint(),
        buffer.getDocumentSyncPoint(),
      ]),
    )
    view.applyText('!')
    await vi.waitFor(() =>
      expect([...seen.values()]).toEqual([
        buffer.getDocumentSyncPoint(),
        buffer.getDocumentSyncPoint(),
      ]),
    )
    const outgoing = seen.get('first')
    first.dispose()
    view.applyText('?')
    await vi.waitFor(() => expect(seen.get('peer')).toBe(buffer.getDocumentSyncPoint()))
    expect(seen.get('first')).toBe(outgoing)
    expect(disposed).toEqual(['first'])
    peer.dispose()
    expect(disposed).toEqual(['first', 'peer'])
  } finally {
    first.dispose()
    peer.dispose()
    analysis.dispose()
  }
})

it('binds projected source to canonical acknowledged base reads and retires the final view interest', async () => {
  const buffer = createEditorTextBuffer('one\ntwo\nthree')
  const view = createEditorBufferSession(buffer)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'projection' })
  const updates: DocumentProjectionUpdate[] = []
  let registrations = 0
  let released = 0
  const connection = {
    generation: 1,
    nextRegistration: () => ++registrations,
    admit: async (update: DocumentProjectionUpdate) => {
      updates.push(update)
      return {
        kind: 'applied' as const,
        identity: update.identity,
        base: update.base,
        target: update.target,
      }
    },
    release: () => {
      released++
    },
  }
  const endpoint: DocumentProjectionEndpoint = { connect: async () => connection }
  let disposed = 0
  const operation = defineDocumentOperation(
    (_context, _input: string) => ({
      analyze: async (read) => {
        const receipt = await _context.source.prepareProjection(endpoint, read)
        return receipt?.target.revision ?? -1
      },
      dispose: () => {
        disposed++
      },
    }),
    (left, right) => left === right,
  )
  const first = analysis.contributions.retain(operation, 'view')!
  const peer = analysis.contributions.retain(operation, 'view')!
  expect(first.runtimeSessionId).toBe(peer.runtimeSessionId)
  expect(await first.request()).toBe(0)
  expect(updates[0].baseRead).toBeNull()
  const before = updates[0].read
  view.applyText('!')
  expect(await peer.request()).toBe(1)
  expect(updates[1].baseRead).toBe(before)
  expect(updates[1].baseRead?.text.readRange(0, before.text.length)).toBe('one\ntwo\nthree')
  expect(updates[1].changes?.edits?.length).toBeGreaterThan(0)
  first.dispose()
  expect(disposed).toBe(0)
  peer.dispose()
  expect(disposed).toBe(1)
  expect(released).toBe(1)
  const reopened = analysis.contributions.retain(operation, 'view')!
  expect(reopened.runtimeSessionId).not.toBe(first.runtimeSessionId)
  await reopened.request()
  expect(updates[2].baseRead).toBeNull()
  reopened.dispose()
  expect(disposed).toBe(2)
  analysis.dispose()
})

it('provides the current receiver to simple and shared views and rebinds on document replacement', () => {
  const contexts: EditorViewContributionContext[] = []
  const observed: unknown[] = []
  const plugin: EditorPlugin = {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (view) => {
          contexts.push(view)
          return {
            update: () => {
              observed.push(view.getDocumentContributions())
            },
            dispose: () => {},
          }
        },
      }),
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createVisibleEditor(host, { defaultText: 'simple', plugins: [plugin] })
  const context = contexts[0]
  const simple = context.getDocumentContributions()
  expect(simple).not.toBeNull()
  editor.setText('replacement')
  expect(context.getDocumentContributions()).not.toBe(simple)
  expect(observed).toContain(context.getDocumentContributions())
  const buffer = createEditorTextBuffer('shared')
  const shared = createEditorDocumentAnalysis({ buffer, documentId: 'shared' })
  editor.attachSession(createEditorBufferSession(buffer), { analysis: shared })
  expect(context.getDocumentContributions()).toBe(shared.contributions)
  editor.clear()
  expect(context.getDocumentContributions()).toBeNull()
  editor.dispose()
  shared.dispose()
  host.remove()
})

it('keeps static sources canonical through programmatic updates, no-ops and replacement', async () => {
  const contexts: EditorViewContributionContext[] = []
  const plugin: EditorPlugin = {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (view) => {
          contexts.push(view)
          return { update: () => {}, dispose: () => {} }
        },
      }),
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createVisibleEditor(host, {
    defaultText: 'old😀\r\nline',
    documentMode: 'static',
    plugins: [plugin],
  })
  const session = editor.getBufferSession()!
  const buffer = session.buffer
  expect(editor.getSelections()[0]).toMatchObject({
    anchorOffset: 10,
    headOffset: 10,
    affinity: 'after',
  })
  const old = buffer.getTextSnapshot()
  const point = buffer.getDocumentSyncPoint()
  const changes: ReturnType<typeof buffer.getDocumentSyncPoint>[] = []
  const unsubscribe = buffer.subscribe((event) => {
    expect(event.change.canUndo).toBe(false)
    expect(event.change.canRedo).toBe(false)
    expect(event.change.isDirty).toBe(false)
    expect(event.change.logicalRevisionCount).toBe(1)
    changes.push(event.syncPointAfter)
  })
  const operation = defineDocumentOperation(
    (context) => ({
      analyze: async (read) => ({
        read,
        delta: context.source.changesBetween(context.initialRead.revision, read.revision),
      }),
      dispose: () => {},
    }),
    () => true,
  )
  const receiver = contexts[0].getDocumentContributions()!
  const lease = receiver.retain(operation, null)!
  const initial = await lease.request()
  expect(initial.read.text.readRange(0, initial.read.text.length)).toBe('old😀\nline')
  editor.edit({ from: 0, to: 3, text: 'blocked' })
  session.applyText('blocked')
  session.indentSelection('  ')
  session.outdentSelection(2)
  session.backspace()
  session.deleteSelection()
  session.undo()
  session.redo()
  expect(buffer.getDocumentSyncPoint()).toBe(point)
  editor.syncText('new😀\r\nline', { documentMode: 'static' })
  expect(changes).toHaveLength(1)
  const current = await lease.request()
  expect(current.read.revision.point.revision).toBe(point.revision + 1)
  expect(current.delta?.logicalRevisionCount).toBe(1)
  expect(current.read.text.readRange(0, current.read.text.length)).toBe('new😀\nline')
  expect(old.readRange(0, old.length)).toBe('old😀\nline')
  expect(session.isDirty()).toBe(false)
  expect(session.canUndo()).toBe(false)
  expect(session.canRedo()).toBe(false)
  expect(buffer.getHistoryGraph().nodes).toHaveLength(1)
  editor.syncText('new😀\r\nline', { documentMode: 'static' })
  expect(changes).toHaveLength(1)
  expect(buffer.getDocumentSyncPoint()).toBe(current.read.revision.point)
  editor.setText('replacement', { documentMode: 'static' })
  expect(contexts[0].getDocumentContributions()).not.toBe(receiver)
  expect(lease.read().kind).toBe('failed')
  lease.dispose()
  unsubscribe()
  editor.dispose()
  host.remove()
})

it('retains projected resources without reading hidden edits and wakes the newest canonical source on demand', async () => {
  const buffer = createEditorTextBuffer('first')
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'hidden' })
  let reads = 0
  const operation = defineDocumentOperation(
    () => ({
      analyze: async (read) => {
        reads++
        return read.text.readRange(0, read.text.length)
      },
      dispose: () => {},
    }),
    () => true,
  )
  const retained = analysis.contributions.retain(operation, null)!
  expect(reads).toBe(0)
  expect(await retained.request()).toBe('first')
  for (let edit = 0; edit < 10; edit++) createEditorBufferSession(buffer).applyText('!')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(reads).toBe(1)
  expect(await retained.request()).toBe('first!!!!!!!!!!')
  expect(reads).toBe(2)
  retained.dispose()
  analysis.dispose()
})

it.each(['ready', 'in-flight'] as const)(
  'rejects an old %s source across a same-revision segment rotation',
  async (phase) => {
    const buffer = createEditorTextBuffer('stable')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'segment' })
    let finish = () => {}
    let start = () => {}
    const started = new Promise<void>((resolve) => {
      start = resolve
    })
    let runs = 0
    const operation = defineDocumentOperation(
      () => ({
        analyze: async (read) => {
          runs++
          if (phase === 'in-flight' && runs === 1) {
            start()
            await new Promise<void>((resolve) => {
              finish = resolve
            })
          }
          return read.revision.point
        },
        dispose: () => {},
      }),
      () => true,
    )
    const retained = analysis.contributions.retain(operation, null)!
    const initial = retained.request()
    const old = buffer.getDocumentSyncPoint()
    if (phase === 'ready') expect(await initial).toBe(old)
    else await started
    const acquired = acquireDocumentMutationLease(
      buffer,
      buffer.getRevision(),
      buffer.getSnapshot(),
      'rotation',
    )
    expect(acquired.status).toBe('acquired')
    if (acquired.status !== 'acquired') return
    expect(rotateDocumentSyncSegment(buffer, old, acquired.lease).status).toBe('rotated')
    const current = buffer.getDocumentSyncPoint()
    expect(current.revision).toBe(old.revision)
    expect(current.segment).not.toBe(old.segment)
    if (phase === 'in-flight') {
      const rejection = expect(initial).rejects.toMatchObject({ name: 'AbortError' })
      finish()
      await rejection
    }
    expect(retained.read().kind).toBe('pending')
    expect(await retained.request()).toBe(current)
    expect(runs).toBe(2)
    releaseDocumentMutationLease(buffer, acquired.lease)
    retained.dispose()
    analysis.dispose()
  },
)

it('keeps independent pinned owners exact after head advances and settles invalid owner, audience and cancellation', async () => {
  const buffer = createEditorTextBuffer('old')
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'tasks' })
  const owner = analysis.contributions.pin()!
  const peerOwner = analysis.contributions.pin()!
  const initialSources: string[] = []
  const operation = defineDocumentOperation(
    (context) => {
      initialSources.push(context.initialRead.text.readRange(0, context.initialRead.text.length))
      return {
        analyze: async (read) => read.text.readRange(0, read.text.length),
        dispose: () => {},
      }
    },
    () => true,
  )
  createEditorBufferSession(buffer).applyEdits([{ from: 0, to: 3, text: 'new' }])
  const [first, peer] = await Promise.all([
    analysis.contributions.request(operation, null, { kind: 'pinned', owner }).settled,
    analysis.contributions.request(operation, null, { kind: 'pinned', owner: peerOwner }).settled,
  ])
  expect(first).toMatchObject({ kind: 'completed', result: 'old', revision: owner.revision })
  expect(peer).toMatchObject({ kind: 'completed', result: 'old', revision: peerOwner.revision })
  expect(initialSources).toEqual(['old', 'old'])
  const audience = analysis.contributions.createAudience()
  expect(
    await analysis.contributions.request(operation, null, { kind: 'latest', audience }).settled,
  ).toMatchObject({ kind: 'completed', result: 'new' })
  const other = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('foreign'),
    documentId: 'foreign',
  })
  expect(
    await other.contributions.request(operation, null, { kind: 'pinned', owner }).settled,
  ).toEqual({ kind: 'unavailable' })
  expect(
    await other.contributions.request(operation, null, { kind: 'latest', audience }).settled,
  ).toEqual({ kind: 'unavailable' })
  const cancelled = analysis.contributions.request(operation, null, { kind: 'latest', audience })
  cancelled.cancel()
  expect(await cancelled.settled).toEqual({ kind: 'cancelled' })
  const disposed = analysis.contributions.request(operation, null, { kind: 'latest', audience })
  audience.dispose()
  expect(await disposed.settled).toEqual({ kind: 'disposed' })
  owner.dispose()
  peerOwner.dispose()
  analysis.dispose()
  other.dispose()
})

it.each(['source', 'configuration'] as const)(
  'rejects stale latest %s before accepting a result',
  async (change) => {
    const buffer = createEditorTextBuffer('old')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'stale' })
    const audience = analysis.contributions.createAudience()
    let finish = () => {}
    let start = () => {}
    const started = new Promise<void>((resolve) => {
      start = resolve
    })
    const operation = defineDocumentOperation(
      (_context, input: string) => ({
        analyze: async (read) => {
          if (input === 'old') {
            start()
            await new Promise<void>((resolve) => {
              finish = resolve
            })
          }
          return read.revision.point
        },
        dispose: () => {},
      }),
      (left, right) => left === right,
    )
    let accepts = 0
    const old = analysis.contributions.request(operation, 'old', {
      kind: 'latest',
      audience,
      configurationTag: ['old'],
      accept: () => {
        accepts++
      },
    })
    await started
    if (change === 'source') {
      const acquired = acquireDocumentMutationLease(
        buffer,
        buffer.getRevision(),
        buffer.getSnapshot(),
        'stale',
      )
      if (acquired.status !== 'acquired') throw new TypeError('Expected mutation lease')
      rotateDocumentSyncSegment(buffer, buffer.getDocumentSyncPoint(), acquired.lease)
      releaseDocumentMutationLease(buffer, acquired.lease)
    } else {
      expect(
        await analysis.contributions.request(operation, 'new', {
          kind: 'latest',
          audience,
          configurationTag: ['new'],
        }).settled,
      ).toMatchObject({ kind: 'completed' })
    }
    finish()
    expect(await old.settled).toEqual({ kind: 'superseded' })
    expect(accepts).toBe(0)
    audience.dispose()
    analysis.dispose()
  },
)

it('coalesces same-read work for two independent latest audiences', async () => {
  const analysis = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('shared'),
    documentId: 'peer-audiences',
  })
  const first = analysis.contributions.createAudience()
  const second = analysis.contributions.createAudience()
  let runs = 0
  const operation = defineDocumentOperation(
    () => ({
      analyze: async (read) => {
        runs++
        return read.text.readRange(0, read.text.length)
      },
      dispose: () => {},
    }),
    () => true,
  )
  const outcomes = await Promise.all([
    analysis.contributions.request(operation, null, { kind: 'latest', audience: first }).settled,
    analysis.contributions.request(operation, null, { kind: 'latest', audience: second }).settled,
  ])
  expect(outcomes.map((outcome) => outcome.kind)).toEqual(['completed', 'completed'])
  expect(runs).toBe(1)
  first.dispose()
  second.dispose()
  analysis.dispose()
})

it('rejects inherited audience and owner handles without changing the issued lifetime', async () => {
  const analysis = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('issued'),
    documentId: 'authority',
  })
  const audience = analysis.contributions.createAudience()
  const owner = analysis.contributions.pin()!
  const inheritedAudience: typeof audience = Object.create(audience)
  const inheritedOwner: typeof owner = Object.create(owner)
  const operation = defineDocumentOperation(
    () => ({ analyze: async () => 'issued', dispose: () => {} }),
    () => true,
  )
  expect(
    await analysis.contributions.request(operation, null, {
      kind: 'latest',
      audience: inheritedAudience,
    }).settled,
  ).toEqual({ kind: 'unavailable' })
  expect(
    await analysis.contributions.request(operation, null, { kind: 'pinned', owner: inheritedOwner })
      .settled,
  ).toEqual({ kind: 'unavailable' })
  inheritedAudience.dispose()
  inheritedOwner.dispose()
  expect(
    await analysis.contributions.request(operation, null, { kind: 'latest', audience }).settled,
  ).toMatchObject({ kind: 'completed', result: 'issued' })
  owner.dispose()
  audience.dispose()
  analysis.dispose()
})

it('settles a synchronous operation initializer failure and leaves its audience reusable', async () => {
  const analysis = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('source'),
    documentId: 'initializer',
  })
  const audience = analysis.contributions.createAudience()
  const broken = defineDocumentOperation(
    () => {
      throw new TypeError('Controlled initializer failure')
    },
    () => true,
  )
  const task = analysis.contributions.request(broken, null, { kind: 'latest', audience })
  expect(await task.settled).toMatchObject({
    kind: 'failed',
    failure: { code: 'DOCUMENT_CONTRIBUTION_FAILED' },
  })
  expect(analysis.inspectRetention().entries).toEqual([])
  const working = defineDocumentOperation(
    () => ({ analyze: async () => 'ready', dispose: () => {} }),
    () => true,
  )
  expect(
    await analysis.contributions.request(working, null, { kind: 'latest', audience }).settled,
  ).toMatchObject({ kind: 'completed', result: 'ready' })
  audience.dispose()
  analysis.dispose()
})

it('keeps a queued pinned request independent of a later source publication', async () => {
  const buffer = createEditorTextBuffer('old')
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'queued-pin' })
  const owner = analysis.contributions.pin()!
  const operation = defineDocumentOperation(
    () => ({
      analyze: async (read) => read.text.readRange(0, read.text.length),
      dispose: () => {},
    }),
    () => true,
  )
  const task = analysis.contributions.request(operation, null, { kind: 'pinned', owner })
  createEditorBufferSession(buffer).applyEdits([{ from: 0, to: 3, text: 'new' }])
  expect(await task.settled).toMatchObject({
    kind: 'completed',
    result: 'old',
    revision: owner.revision,
  })
  owner.dispose()
  analysis.dispose()
})

it('rejects an old highlighter configuration before acceptance and reuses its green refresh', async () => {
  const analysis = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer('color'),
    documentId: 'theme',
  })
  const audience = analysis.contributions.createAudience()
  let color = 'red'
  let finish = () => {}
  let start = () => {}
  const started = new Promise<void>((resolve) => {
    start = resolve
  })
  const listeners = new Set<() => void>()
  const operation = createEditorHighlighterOperation(() => ({
    analyze: async () => {
      const captured = color
      if (captured === 'red') {
        start()
        await new Promise<void>((resolve) => {
          finish = resolve
        })
      }
      return {
        tokens: EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: captured } }]),
      }
    },
    onDidChangeTheme: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: () => {},
  }))
  const accepted: string[] = []
  const first = analysis.contributions.request(
    operation,
    { languageId: 'typescript' },
    {
      kind: 'latest',
      audience,
      accept: (result) => {
        accepted.push(result.tokens.toTokens()[0]!.style.color!)
      },
    },
  )
  await started
  color = 'green'
  for (const listener of listeners) listener()
  finish()
  expect(await first.settled).toEqual({ kind: 'superseded' })
  expect(accepted).toEqual([])
  expect(
    await analysis.contributions.request(
      operation,
      { languageId: 'typescript' },
      {
        kind: 'latest',
        audience,
        accept: (result) => {
          accepted.push(result.tokens.toTokens()[0]!.style.color!)
        },
      },
    ).settled,
  ).toMatchObject({ kind: 'completed' })
  expect(accepted).toEqual(['green'])
  audience.dispose()
  analysis.dispose()
  expect(listeners.size).toBe(0)
})
