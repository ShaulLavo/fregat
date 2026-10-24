import type { DocumentSessionChange } from '../documentSession'
import type { DocumentTextSnapshot } from '../documentTextSnapshot'
import type { EditorDisposable } from '../editor/disposables'
import type { EditorTheme } from '../theme'
import type { EditorSyntaxLanguageId } from './session'
import type { EditorTokenStore } from './tokenStore'
import type { DocumentRead } from '../editor/documentDelivery'
import type { EditorHighlighterOperation } from '../document/operations'

export type EditorHighlightResult = {
  readonly tokens: EditorTokenStore
  readonly theme?: EditorTheme | null
}

export type EditorHighlighterSessionOptions = {
  readonly languageId: EditorSyntaxLanguageId | null
}

export type EditorHighlighterSession = EditorDisposable & {
  onDidChangeTheme?(listener: () => void): (() => void) | void
  refresh(textSnapshot: DocumentTextSnapshot): Promise<EditorHighlightResult>
  applyChange(change: DocumentSessionChange): Promise<EditorHighlightResult>
}

export type EditorHighlighterProvider = {
  loadTheme?(): Promise<EditorTheme | null | undefined>
  readonly operation: EditorHighlighterOperation
}

export type EditorHighlighterRuntime = Omit<EditorHighlighterSession, 'refresh' | 'applyChange'> & {
  analyze(read: DocumentRead, signal: AbortSignal): Promise<EditorHighlightResult>
  /** Stable until inputs affecting the result change. */
  configurationKey?(): unknown
}
