import type { PreparedDocumentWorkerRead } from '@singapore-editor/core/internal/document-worker'
import { createTreeSitterEditPayload } from '../../src/session'
import type {
  TreeSitterWorkerClient,
  TreeSitterParsePayload,
  TreeSitterEditPayload,
  TreeSitterEditOnlyPayload,
} from '../../src/treeSitter/workerClient'
import { createTreeSource } from './source'
import type { TreeSitterParseAckResult, TreeSitterParseResult } from '../../src/treeSitter/types'

const documents = new Map<
  TreeSitterWorkerClient,
  Map<string, ReturnType<typeof createTreeSource>>
>()
export function disposeTreeTransportDocuments() {
  for (const entries of documents.values()) for (const entry of entries.values()) entry.dispose()
  documents.clear()
}
function document(client: TreeSitterWorkerClient, runtime: string, id: string, text: string) {
  let entries = documents.get(client)
  if (!entries) {
    entries = new Map()
    documents.set(client, entries)
  }
  let entry = entries.get(runtime)
  if (!entry) {
    entry = createTreeSource(client.sourceEndpoint, text, id)
    entries.set(runtime, entry)
  }
  return entry
}
type ParseOptions = Omit<TreeSitterParsePayload, 'source' | 'resultMode'> & {
  readonly text: string
}
export function parseTreeDocument(
  client: TreeSitterWorkerClient,
  options: ParseOptions & { readonly resultMode: 'parseOnly' },
): Promise<TreeSitterParseAckResult | undefined>
export function parseTreeDocument(
  client: TreeSitterWorkerClient,
  options: ParseOptions & { readonly resultMode?: 'full' },
): Promise<TreeSitterParseResult | undefined>
export async function parseTreeDocument(
  client: TreeSitterWorkerClient,
  options: ParseOptions & { readonly resultMode?: 'full' | 'parseOnly' },
) {
  const entry = document(client, options.runtimeSessionId, options.documentId, options.text)
  const current = entry.buffer.getTextSnapshot()
  if (current.readRange(0, current.length) !== options.text)
    entry.edit([{ from: 0, to: current.length, text: options.text }])
  const prepared = await entry.prepare()
  const payload = { ...options, source: prepared.reference }
  try {
    return options.resultMode === 'parseOnly'
      ? await client.parse({ ...payload, resultMode: 'parseOnly' })
      : await client.parse({ ...payload, resultMode: 'full' })
  } finally {
    await prepared.dispose()
  }
}
type EditOptions = Omit<
  TreeSitterEditPayload,
  'source' | 'inputEdits' | 'resultMode' | 'includeHighlights'
> & { readonly includeHighlights?: boolean }
type EditHandle<Payload> = {
  readonly payload: Payload
  readonly prepared: PreparedDocumentWorkerRead
}
export function prepareTreeEdit(
  client: TreeSitterWorkerClient,
  options: EditOptions & { readonly resultMode: 'parseOnly' },
): Promise<EditHandle<TreeSitterEditOnlyPayload> | null>
export function prepareTreeEdit(
  client: TreeSitterWorkerClient,
  options: EditOptions & { readonly resultMode?: 'full' },
): Promise<EditHandle<TreeSitterEditPayload> | null>
export async function prepareTreeEdit(
  client: TreeSitterWorkerClient,
  options: EditOptions & { readonly resultMode?: 'full' | 'parseOnly' },
) {
  const entry = documents.get(client)?.get(options.runtimeSessionId)
  if (!entry)
    throw new TypeError('The transport fixture must admit its canonical document before editing')
  const previousRead = entry.buffer.getTextSnapshot()
  entry.edit(options.edits)
  const prepared = await entry.prepare()
  const base = { ...options, previousRead, source: prepared.reference }
  const payload =
    options.resultMode === 'parseOnly'
      ? createTreeSitterEditPayload({ ...base, resultMode: 'parseOnly' })
      : createTreeSitterEditPayload({ ...base, resultMode: 'full' })
  if (!payload) {
    await prepared.dispose()
    return null
  }
  return { payload, prepared }
}
export function editTreeDocument(
  client: TreeSitterWorkerClient,
  request: EditHandle<TreeSitterEditOnlyPayload>,
): Promise<TreeSitterParseAckResult | undefined>
export function editTreeDocument(
  client: TreeSitterWorkerClient,
  request: EditHandle<TreeSitterEditPayload>,
): Promise<TreeSitterParseResult | undefined>
export async function editTreeDocument(
  client: TreeSitterWorkerClient,
  request: EditHandle<TreeSitterEditPayload | TreeSitterEditOnlyPayload>,
) {
  try {
    return await client.edit(request.payload)
  } finally {
    await request.prepared.dispose()
  }
}
export function retireTreeDocument(client: TreeSitterWorkerClient, runtime: string): void {
  client.disposeDocument(runtime)
  const entries = documents.get(client)
  entries?.get(runtime)?.dispose()
  entries?.delete(runtime)
  if (entries?.size === 0) documents.delete(client)
}

export async function admitTreeSource(
  client: TreeSitterWorkerClient,
  runtime: string,
  id: string,
  text: string,
): Promise<void> {
  await (await document(client, runtime, id, text).prepare()).dispose()
}
