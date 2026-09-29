/** What a copied payload carried beyond its text, kept so a paste can hand it back per cursor. */
export type ClipboardMetadata = {
  /** The text each selection contributed, in document order. */
  readonly perSelection: readonly string[]
  /** The copy came from carets that selected nothing, so its text is whole lines. */
  readonly pasteOnNewLine: boolean
}

const CLIPBOARD_METADATA_TYPE = 'application/x-editor-clipboard'

/**
 * The last copy this process wrote, keyed by the exact text that went out with it.
 *
 * A private data type only survives where nothing sanitises the clipboard, and plenty of real
 * routes do — another application, an OS clipboard history, a browser that drops types it does not
 * recognise. Matching on the text is what still identifies the payload once only the text is left.
 */
let lastCopied: { readonly text: string; readonly metadata: ClipboardMetadata } | null = null

export function writeClipboardPayload(
  data: DataTransfer,
  text: string,
  metadata: ClipboardMetadata,
): void {
  data.setData('text/plain', text)
  data.setData(CLIPBOARD_METADATA_TYPE, JSON.stringify(metadata))
  lastCopied = { text, metadata }
}

export function readClipboardMetadata(
  data: DataTransfer | null,
  text: string,
): ClipboardMetadata | null {
  const encoded = data?.getData(CLIPBOARD_METADATA_TYPE) ?? ''
  const carried = encoded.length === 0 ? null : parseClipboardMetadata(encoded)
  if (carried) return carried
  if (lastCopied?.text === text) return lastCopied.metadata

  return null
}

/** Anything at all can be sitting under that data type, so nothing about its shape is assumed. */
function parseClipboardMetadata(encoded: string): ClipboardMetadata | null {
  const parsed = parseJson(encoded)
  if (typeof parsed !== 'object' || parsed === null) return null

  const { perSelection, pasteOnNewLine } = parsed as Partial<ClipboardMetadata>
  if (!Array.isArray(perSelection)) return null
  if (!perSelection.every((entry) => typeof entry === 'string')) return null

  return { perSelection, pasteOnNewLine: pasteOnNewLine === true }
}

function parseJson(encoded: string): unknown {
  try {
    return JSON.parse(encoded)
  } catch {
    return null
  }
}
