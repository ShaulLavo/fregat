import { createEditorTextBuffer, createEditorBufferSession } from '../../src/documentSession'
import type { TextEdit } from '../../src/tokens'
import { DocumentDelivery } from '../../src/editor/documentDelivery'
import { completeDocumentCleanup } from '../../src/editor/documentCleanup'
import {
  createShikiDocumentOperation,
  type ShikiWorkerOwner,
  type ShikiHighlighterSessionOptions,
} from '../../src/shiki/workerClient'

type FixtureOptions = Omit<
  ShikiHighlighterSessionOptions,
  'source' | 'initialRead' | 'runtimeSessionId'
> & {
  readonly text: string
  readonly runtimeSessionId?: string
}

let nextRuntime = 0

export function createHighlighterDocument(owner: ShikiWorkerOwner, options: FixtureOptions) {
  const buffer = createEditorTextBuffer(options.text)
  const view = createEditorBufferSession(buffer)
  const delivery = new DocumentDelivery(buffer, options.documentId)
  const unsubscribe = buffer.subscribe((event) => delivery.accept(event))
  const scope = delivery.createScope()
  const runtime = createShikiDocumentOperation(owner, {
    ...options,
    runtimeSessionId: options.runtimeSessionId ?? `fixture-${++nextRuntime}`,
    source: scope.source,
    initialRead: delivery.current()!,
  })
  if (!runtime) throw new TypeError('The configured worker must create its highlighter runtime')
  const run = () => runtime.analyze(delivery.current()!, new AbortController().signal)
  return {
    buffer,
    view,
    delivery,
    runtime,
    run,
    edit: (edits: readonly TextEdit[]) => {
      view.applyEdits(edits)
      return run()
    },
    undo: () => {
      view.undo()
      return run()
    },
    dispose: () =>
      completeDocumentCleanup([
        () => runtime.dispose(),
        () => scope.dispose(),
        unsubscribe,
        () => delivery.dispose(),
      ]),
  }
}
