import { DocumentWorkerReader } from '@singapore-editor/core/internal/document-worker'
import type { TreeSitterLanguageDescriptor } from '../../src/treeSitter/registry'
import type {
  TreeSitterWorkerRequest,
  TreeSitterWorkerResponse,
  TreeSitterWorkerResult,
} from '../../src/treeSitter/types'

export class RecordingWorker extends EventTarget implements Worker {
  readonly reader = new DocumentWorkerReader()
  readonly messages: TreeSitterWorkerRequest[] = []
  private readonly languages = new Map<string, TreeSitterLanguageDescriptor>()
  onmessage: Worker['onmessage'] = null
  onerror: Worker['onerror'] = null
  onmessageerror: Worker['onmessageerror'] = null
  constructor(
    private readonly warm: (
      languages: readonly TreeSitterLanguageDescriptor[],
    ) => Promise<void> = async () => {},
  ) {
    super()
  }
  postMessage(request: TreeSitterWorkerRequest): void {
    this.messages.push(request)
    void this.respond(request)
  }
  private async respond(request: TreeSitterWorkerRequest) {
    let response: TreeSitterWorkerResponse
    try {
      response = { id: request.id, ok: true, result: await this.execute(request) }
    } catch (error) {
      response = { id: request.id, ok: false, error: String(error) }
    }
    this.onmessage?.call(this, new MessageEvent('message', { data: response }))
  }
  private async execute({ payload }: TreeSitterWorkerRequest): Promise<TreeSitterWorkerResult> {
    if (payload.type === 'source') return this.reader.apply(payload.command)
    if (payload.type === 'registerLanguages') {
      for (const language of payload.languages) this.languages.set(language.id, language)
      return
    }
    if (payload.type === 'warmLanguages') {
      await this.warm(
        payload.languageIds.flatMap((id) => {
          const language = this.languages.get(id)
          return language ? [language] : []
        }),
      )
      return
    }
    if (payload.type !== 'parse') return
    const result = {
      status: 'parsed' as const,
      documentId: payload.documentId,
      languageId: payload.languageId,
      snapshotVersion: payload.snapshotVersion,
      changedRanges: [],
      timings: [],
    }
    if (payload.resultMode === 'parseOnly') return result
    return { ...result, captures: [], brackets: [], errors: [], folds: [], injections: [] }
  }
  terminate() {
    this.reader.dispose()
  }
}
