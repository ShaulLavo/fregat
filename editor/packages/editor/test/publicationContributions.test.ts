import { afterEach, expect, test } from 'vitest'
import {
  acquireDocumentMutationLease,
  createEditorBufferSession,
  createEditorTextBuffer,
  releaseDocumentMutationLease,
  rotateDocumentSyncSegment,
} from '../src/documentSession'
import { Editor } from '../src/editor'
import type { EditorEditContributionContext, EditorPluginContext } from '../src/public/extensions'

type DocumentContext = Pick<
  EditorEditContributionContext,
  | 'getTextSnapshot'
  | 'materializeFullText'
  | 'getDocumentSyncPoint'
  | 'changesSinceDocumentSyncPoint'
> &
  Partial<Pick<EditorEditContributionContext, 'getCurrentDocumentSnapshot'>>

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
})

function contributionPlugin(contexts: DocumentContext[]) {
  const provider = {
    createContribution(context: DocumentContext) {
      contexts.push(context)
      return { dispose() {} }
    },
  }
  return {
    activate(context: EditorPluginContext) {
      context.registerEditContribution(provider)
      context.registerDecorationContribution(provider)
      if (
        'registerEditorFeatureContribution' in context &&
        typeof context.registerEditorFeatureContribution === 'function'
      )
        context.registerEditorFeatureContribution(provider)
    },
  }
}

test('mounted public contributions expose the live segment after eventless rotation', () => {
  const contexts: DocumentContext[] = []
  const buffer = createEditorTextBuffer('a')
  const session = createEditorBufferSession(buffer)
  const editor = new Editor(document.createElement('div'), {
    plugins: [contributionPlugin(contexts)],
  })
  editors.push(editor)
  editor.attachSession(session)
  session.applyText('b')
  const point = buffer.getDocumentSyncPoint()
  const acquired = acquireDocumentMutationLease(
    buffer,
    buffer.getRevision(),
    buffer.getSnapshot(),
    'rotation-proof',
  )
  if (acquired.status !== 'acquired') throw new TypeError('Expected an acquired mutation lease')
  expect(rotateDocumentSyncSegment(buffer, point, acquired.lease).status).toBe('rotated')
  releaseDocumentMutationLease(buffer, acquired.lease)

  expect(contexts).toHaveLength(3)
  for (const context of contexts) {
    const current = context.getDocumentSyncPoint()
    expect(current.segment).toBe(buffer.getDocumentSyncPoint().segment)
    expect(current).toEqual(buffer.getDocumentSyncPoint())
    expect(context.changesSinceDocumentSyncPoint(current, null)?.syncPointAfter).toEqual(current)
  }
})

test('mounted public source reads and bounded cursors share each nested publication', () => {
  const contexts: DocumentContext[] = []
  const observed: unknown[] = []
  const currentSources: unknown[] = []
  const buffer = createEditorTextBuffer('a')
  const session = createEditorBufferSession(buffer)
  const initial = buffer.getDocumentSyncPoint()
  buffer.subscribe((event) => {
    if (event.revisionAfter === 1) session.applyText('c')
  })
  const editor = new Editor(document.createElement('div'), {
    plugins: [contributionPlugin(contexts)],
    onChange(_state, change) {
      if (change?.kind !== 'edit') return
      const text = change.textSnapshot.materializeFullText()
      observed.push([
        text,
        editor.materializeFullText(),
        editor.getTextSnapshot().materializeFullText(),
      ])
      for (const context of contexts) {
        const point = context.getDocumentSyncPoint()
        const source = context.getTextSnapshot()
        const current = context.getCurrentDocumentSnapshot?.()
        if (current)
          currentSources.push([
            current.textSnapshot.readRange(0, current.textSnapshot.length),
            current.documentSyncPoint.revision,
          ])
        const changes = context.changesSinceDocumentSyncPoint(initial, null)
        observed.push([
          text,
          source?.readRange(0, source.length),
          context.materializeFullText(),
          point.revision,
          changes?.syncPointAfter.revision,
        ])
      }
    },
  })
  editors.push(editor)
  editor.attachSession(session)
  session.applyText('b')

  expect(contexts).toHaveLength(3)
  expect(observed).toEqual([
    ['ab', 'abc', 'abc'],
    ...contexts.map(() => ['ab', 'ab', 'ab', 1, 1]),
    ['abc', 'abc', 'abc'],
    ...contexts.map(() => ['abc', 'abc', 'abc', 2, 2]),
  ])
  expect(currentSources).toEqual(Array.from({ length: 4 }, () => ['abc', 2]))
  expect(editor.getTextSnapshot()).toBe(buffer.getTextSnapshot())
})

test.each(['plain', 'shared'])(
  'command acquisitions retain their source/point pair on the %s path',
  (path) => {
    const contexts: DocumentContext[] = []
    const editor = new Editor(document.createElement('div'), {
      defaultText: 'a',
      plugins: [contributionPlugin(contexts)],
    })
    editors.push(editor)
    if (path === 'shared')
      editor.attachSession(createEditorBufferSession(createEditorTextBuffer('a')))
    editor.edit({ from: 1, to: 1, text: 'b' })
    const acquired = contexts.flatMap((context) => {
      const current = context.getCurrentDocumentSnapshot?.()
      return current ? [current] : []
    })
    expect(acquired).toHaveLength(2)
    for (const current of acquired) {
      expect(current.textSnapshot.readRange(0, current.textSnapshot.length)).toBe('ab')
      expect(current.documentSyncPoint).toEqual(contexts[0]?.getDocumentSyncPoint())
    }
    const points = acquired.map((current) => current.documentSyncPoint)
    editor.edit({ from: 2, to: 2, text: 'c' })
    for (const [index, current] of acquired.entries()) {
      expect(current.textSnapshot.readRange(0, current.textSnapshot.length)).toBe('ab')
      expect(current.documentSyncPoint).toBe(points[index])
      expect(contexts[0]?.getDocumentSyncPoint().revision).toBe(
        current.documentSyncPoint.revision + 1,
      )
    }
    expect(editor.materializeFullText()).toBe('abc')
  },
)
