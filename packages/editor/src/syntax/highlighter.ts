import type { PieceTableSnapshot } from '@singapore-editor/textbuffer'
import type { DocumentSessionChange } from '../documentSession'
import type { DocumentTextSnapshot } from '../documentTextSnapshot'
import type { EditorDisposable } from '../editor/disposables'
import type { EditorTheme } from '../theme'
import type { EditorSyntaxLanguageId } from './session'
import type { EditorTokenStore } from './tokenStore'

export type EditorHighlightResult = {
  readonly tokens: EditorTokenStore
  readonly theme?: EditorTheme | null
}

// A highlighter is a protocol adapter: it owns the full immutable source and decides when a
// transport needs the whole text.
export type EditorHighlighterSessionOptions = {
  readonly documentId: string
  readonly runtimeSessionId?: string
  readonly languageId: EditorSyntaxLanguageId | null
  readonly textSnapshot: DocumentTextSnapshot
  readonly snapshot: PieceTableSnapshot
}

export type EditorHighlighterSession = EditorDisposable & {
  onDidChangeTheme?(listener: () => void): (() => void) | void
  refresh(textSnapshot: DocumentTextSnapshot): Promise<EditorHighlightResult>
  applyChange(change: DocumentSessionChange): Promise<EditorHighlightResult>
}

export type EditorHighlighterProvider = {
  loadTheme?(): Promise<EditorTheme | null | undefined>
  createSession(options: EditorHighlighterSessionOptions): EditorHighlighterSession | null
}
