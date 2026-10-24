import {
  createEditorTextBuffer,
  createEditorBufferSession,
  type TextEdit,
} from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import {
  defineDocumentOperation,
  type DocumentContributionSource,
  type DocumentSourceEndpoint,
} from '@singapore-editor/core/internal/document-worker'

const disposers = new Set<() => void>()
export function disposeTreeSources() {
  for (const dispose of disposers) dispose()
  disposers.clear()
}
export function createTreeSource(
  endpoint: DocumentSourceEndpoint,
  text: string,
  documentId = 'doc.ts',
) {
  const buffer = createEditorTextBuffer(text)
  const view = createEditorBufferSession(buffer)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId })
  const sources: DocumentContributionSource[] = []
  const operation = defineDocumentOperation(
    (context) => {
      sources.push(context.source)
      return { analyze: async () => null, dispose: () => {} }
    },
    () => true,
  )
  const lease = analysis.contributions.retain(operation, null)
  const source = sources[0]
  if (!lease || !source) throw new TypeError('A canonical source scope must be retained')
  const prepare = async () => {
    const pin = analysis.contributions.pin()
    if (!pin) throw new TypeError('The source fixture must be live')
    const read = source.read(pin.revision)
    pin.dispose()
    if (!read) throw new TypeError('The current issued read must be available')
    const prepared = await source.prepareReader(endpoint, read)
    if (!prepared) throw new TypeError('The actual worker must admit the canonical source')
    return prepared
  }
  const dispose = () => {
    lease.dispose()
    analysis.dispose()
    disposers.delete(dispose)
  }
  disposers.add(dispose)
  return {
    buffer,
    view,
    prepare,
    edit: (edits: readonly TextEdit[]) => view.applyEdits(edits),
    dispose,
  }
}
