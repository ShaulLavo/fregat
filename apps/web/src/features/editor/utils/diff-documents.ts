import { fileUriForPath as fileUri } from '@/lib/file-uri'
import type { DiffFile } from '@singapore-editor/diff'
import { fnv1a32 } from '@workspace/client-core/address/path-hash'

import type { DiffLanguageDocument } from '@/features/editor/state/diff-language-session'
import { languageIdForFilePath } from '@/features/editor/utils/file-path'
import { lspLanguageIdForPath } from '@/features/editor/utils/lsp-language-id'

/**
 * The two documents a diff opens, and the names it opens them under.
 *
 * The new side takes the file's REAL uri wherever that is safe, because it is the same text the
 * file has and a language server that knows it by its real name resolves its imports, applies the
 * project's `paths`, and reports the same diagnostics an editor would. That is what VS Code gets by
 * handing the modified side the very `ITextModel` the editor holds.
 *
 * "Wherever that is safe" is one condition: our proxy forwards a joining client's text to the
 * backend when it DIFFERS from the shared copy, so opening the real uri with text that is not what
 * an editor already holds would repoint that editor's document. A diff of a historical commit, or
 * of a file with unsaved edits, is exactly that case — and it falls back to a phantom name.
 *
 * The old side is always a phantom: its text exists in git and nowhere on disk, so there is no real
 * uri it could honestly claim.
 *
 * A phantom is a SIBLING — same directory, same extension — rather than another scheme, and that is
 * the whole trick. `tsconfig` includes `src` as a wildcard directory, so an in-memory file beside
 * its original joins the same configured project and resolves `./relative` and `@/aliased` imports
 * identically. A `git:`-style scheme, which is what VS Code gives its original side, lands outside
 * every project and is why language features there have always been thin.
 */
export function diffLanguageDocuments({
  documentPath,
  file,
  newSideIsWorkingTree,
  ownedText,
}: {
  /** Absolute path of the new-side file, or null when it is not in the workspace. */
  readonly documentPath: string | null
  readonly file: DiffFile
  /** Whether the new side is the file on disk. Only then may it claim the file's real uri. */
  readonly newSideIsWorkingTree: boolean
  /** What an editor currently holds for that path, or null when none does. */
  readonly ownedText: string | null
}): readonly DiffLanguageDocument[] {
  // A patch-built diff carries only the hunks git chose to print, so neither side is a file.
  if (file.isPartial) return []
  if (!documentPath) return []

  // A file whose language we cannot name is not one a server was going to answer about, and a
  // `didOpen` carrying `languageId: null` fails the proxy's validator — it is then forwarded raw
  // and UNTRACKED, so the matching `didClose` is swallowed and the backend keeps the document
  // forever. Refusing here is the difference between no feature and a leak.
  const grammarId = languageIdForFilePath(documentPath)
  if (!grammarId) return []

  const languageId = lspLanguageIdForPath(documentPath) ?? grammarId

  const newText = file.newLines.join('\n')
  const oldText = file.oldLines.join('\n')

  const realUri = fileUri(documentPath)
  const newUri = newSideUri(documentPath, newText, newSideIsWorkingTree, ownedText)

  return [
    ...documentFor('new', newUri, languageId, newText, newUri === realUri),
    ...documentFor('old', phantomUri(documentPath, 'old', oldText), languageId, oldText, false),
  ]
}

/** A side with no lines is a file that does not exist on that side — added, or deleted. */
function documentFor(
  side: DiffLanguageDocument['side'],
  uri: string,
  languageId: string,
  text: string,
  sharesRealUri: boolean,
): readonly DiffLanguageDocument[] {
  if (text.length === 0) return []

  return [{ languageId, sharesRealUri, side, text, uri }]
}

/**
 * The real uri when this text is what the file already is, and a phantom when it is not.
 *
 * Two conditions, and both are load-bearing. The diff has to be OF the working tree — a staged
 * diff's new side is the index blob and a checkpoint's is a historical commit, neither of which is
 * what the file says now. And no editor may be holding different text, because our proxy forwards a
 * joining client's text to the backend when it differs, which would repoint that editor's document
 * for every client under the root.
 */
function newSideUri(
  documentPath: string,
  newText: string,
  newSideIsWorkingTree: boolean,
  ownedText: string | null,
): string {
  if (!newSideIsWorkingTree) return phantomUri(documentPath, 'new', newText)
  if (ownedText === null || ownedText === newText) return fileUri(documentPath)

  return phantomUri(documentPath, 'new', newText)
}

/**
 * A name no real file has, beside the file it stands for.
 *
 * Keyed by content so two panes of the same split diff — and a diff reopened on the same commit —
 * name the same text the same way, which lets the proxy's owner set do its job instead of opening a
 * second copy per pane.
 */
function phantomUri(documentPath: string, side: string, text: string): string {
  const slash = documentPath.lastIndexOf('/')
  const directory = documentPath.slice(0, slash + 1)
  const name = documentPath.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const extension = dot <= 0 ? '' : name.slice(dot)

  return fileUri(`${directory}${stem}.__diff-${side}-${textKey(text)}__${extension}`)
}

/** FNV-1a. Not a checksum — just enough to keep two different texts from sharing a name. */
function textKey(text: string): string {
  return (fnv1a32(text) >>> 0).toString(36)
}
