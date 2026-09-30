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
>

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
    ['ab', 'ab', 'ab'],
    ...contexts.map(() => ['ab', 'ab', 'ab', 1, 1]),
    ['abc', 'abc', 'abc'],
    ...contexts.map(() => ['abc', 'abc', 'abc', 2, 2]),
  ])
  expect(editor.getTextSnapshot()).toBe(buffer.getTextSnapshot())
})
