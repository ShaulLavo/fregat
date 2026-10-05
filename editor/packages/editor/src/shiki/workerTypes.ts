import type { EditorTheme } from '../theme'
import type {
  DocumentWorkerPoint,
  DocumentWorkerReadReference,
  DocumentWorkerSourceCommand,
  DocumentWorkerSourceResult,
} from '../document/workerReader'
import type { TextEdit } from '../tokens'
import type { PackedEditorTokenPatch, PackedEditorTokens } from '../syntax/packedTokens'
import type { EditorShikiThemeSettingLike } from './theme'

export type ShikiWorkerThemeRegistration = {
  readonly name: string
  readonly bg?: string
  readonly fg?: string
  readonly colors?: Readonly<Record<string, string | undefined>>
  readonly tokenColors?: readonly EditorShikiThemeSettingLike[]
  readonly settings?: readonly EditorShikiThemeSettingLike[]
}

export type ShikiWorkerLanguageRegistration = {
  readonly name: string
  readonly scopeName: string
  readonly aliases?: readonly string[]
  readonly patterns?: readonly unknown[]
  readonly repository?: Readonly<Record<string, unknown>>
}

export type ShikiWorkerDocumentOptions = {
  readonly documentId: string
  readonly runtimeSessionId: string
  readonly lang: string
  readonly theme: string
  readonly languageRegistrations: readonly ShikiWorkerLanguageRegistration[]
  readonly themeRegistration: ShikiWorkerThemeRegistration
  readonly themeRegistrations: readonly ShikiWorkerThemeRegistration[]
  /** Longest line, in UTF-16 units, that is tokenized; longer lines stay plain. */
  readonly maxLineLength: number
}

export type ShikiWorkerOpenRequest = ShikiWorkerDocumentOptions & {
  readonly type: 'open'
  readonly source: DocumentWorkerReadReference
}

// The worker already holds an edited document's grammar and theme; an edit names them and nothing
// more, so a keystroke clones no registrations.
export type ShikiWorkerEditRequest = {
  readonly type: 'edit'
  readonly source: DocumentWorkerReadReference
  readonly previousPoint: DocumentWorkerPoint
  readonly documentId: string
  readonly runtimeSessionId: string
  readonly lang: string
  readonly theme: string
  readonly edits: readonly TextEdit[]
}

export type ShikiWorkerRecolorRequest = {
  readonly type: 'recolor'
  readonly runtimeSessionId: string
  readonly theme: string
  readonly themeRegistration: ShikiWorkerThemeRegistration
}

type ShikiWorkerDisposeDocumentRequest = {
  readonly type: 'disposeDocument'
  readonly runtimeSessionId: string
}

type ShikiWorkerRuntimeBarrierRequest = {
  readonly type: 'runtimeBarrier'
  readonly runtimeSessionId: string
}

type ShikiWorkerIdleFenceRequest = {
  readonly type: 'idleFence'
  readonly includeRetention?: true
}

type ShikiWorkerDisposeRequest = {
  readonly type: 'dispose'
}

export type ShikiWorkerThemeRequest = {
  readonly type: 'theme'
  readonly theme: string
  readonly themeRegistration: ShikiWorkerThemeRegistration
  readonly themeRegistrations: readonly ShikiWorkerThemeRegistration[]
}

export type ShikiWorkerPreloadRequest = {
  readonly type: 'preload'
  readonly languageRegistrations: readonly ShikiWorkerLanguageRegistration[]
  readonly themeRegistrations: readonly ShikiWorkerThemeRegistration[]
}

export type ShikiWorkerRequestPayload =
  | { readonly type: 'source'; readonly command: DocumentWorkerSourceCommand }
  | ShikiWorkerOpenRequest
  | ShikiWorkerEditRequest
  | ShikiWorkerRecolorRequest
  | ShikiWorkerDisposeDocumentRequest
  | ShikiWorkerRuntimeBarrierRequest
  | ShikiWorkerIdleFenceRequest
  | ShikiWorkerDisposeRequest
  | ShikiWorkerPreloadRequest
  | ShikiWorkerThemeRequest

export type ShikiWorkerRetentionSnapshot = {
  readonly source: {
    readonly documents: number
    readonly reads: number
    readonly pins: number
    readonly sourceUnits: number
  }
  readonly documentCount: number
  readonly tokenizerCount: number
  /** Session identifiers retained after document disposal. */
  readonly retiredRuntimeCount: number
  readonly retiredRuntimeLimit: number
  readonly lineCount: number
  readonly tokenCount: number
  readonly documents: readonly {
    readonly documentId: string
    readonly runtimeSessionId: string
    /** UTF-16 units in the tokenizer's current code, not allocated string bytes. */
    readonly sourceUnits: number
    readonly lineCount: number
    readonly tokenCount: number
  }[]
  readonly shared: {
    /** Includes failed highlighter promises retained by the worker. */
    readonly highlighterEntries: number
    readonly highlighterCount: number
    readonly highlighters: readonly {
      /** Loaded names may include grammar aliases. */
      readonly languageNames: readonly string[]
      readonly themeNames: readonly string[]
    }[]
  }
  readonly unmeasuredBytes: readonly (
    | 'javascript-objects'
    | 'source-strings'
    | 'tokenizer-states'
    | 'grammars-and-themes'
    | 'worker-heap'
    | 'wasm-committed'
    | 'wasm-allocator-live'
  )[]
}

// An edit answers with the re-tokenized lines only; the client splices them into the full
// packed tokens it kept from the last open, so a keystroke never ships the whole document back.
export type ShikiWorkerTransportResult = {
  readonly source?: DocumentWorkerSourceResult
  readonly documentId?: string
  readonly tokensPacked?: PackedEditorTokens
  readonly patchesPacked?: readonly PackedEditorTokenPatch[]
  readonly theme?: EditorTheme
  /** Lines of the tokenized text left plain by the tokenization limit. */
  readonly untokenizedLines?: number
  /** Worker-owned facts at an idle fence. */
  readonly retention?: ShikiWorkerRetentionSnapshot
}

export type ShikiWorkerRequest = {
  readonly id: number
  readonly payload: ShikiWorkerRequestPayload
}

export type ShikiWorkerResponse =
  | {
      readonly id: number
      readonly ok: true
      readonly result?: ShikiWorkerTransportResult
    }
  | {
      readonly id: number
      readonly ok: false
      readonly error: string
    }
