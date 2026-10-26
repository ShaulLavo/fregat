import type { TextEdit } from '@singapore-editor/core/document'
import type {
  DocumentWorkerPoint,
  DocumentWorkerReadReference,
  DocumentWorkerSourceCommand,
  DocumentWorkerSourceResult,
} from '@singapore-editor/core/internal/document-worker'
import type {
  ShikiWorkerLanguageRegistration,
  ShikiWorkerThemeRegistration,
} from '@singapore-editor/core/shiki'
import type { TreeSitterWorkerOwner } from '@singapore-editor/tree-sitter'

// The owners expose these payload-bearing methods through symbol keys in their public declarations.
type TreeSitterBackend = ReturnType<
  Extract<
    TreeSitterWorkerOwner[keyof TreeSitterWorkerOwner],
    () => { parse: (...args: never[]) => unknown }
  >
>
type TreeSitterParsePayload = Parameters<TreeSitterBackend['parse']>[0]
type TreeSitterEditPayload = Parameters<TreeSitterBackend['edit']>[0]
type TreeSitterRangePayload = Parameters<NonNullable<TreeSitterBackend['queryRange']>>[0]
type TreeSitterResult =
  | Awaited<ReturnType<TreeSitterBackend['parse']>>
  | Awaited<ReturnType<NonNullable<TreeSitterBackend['queryRange']>>>
type ShikiOpenPayload = {
  readonly type: 'open'
  readonly source: DocumentWorkerReadReference
  readonly documentId: string
  readonly runtimeSessionId: string
  readonly lang: string
  readonly theme: string
  readonly languageRegistrations: readonly ShikiWorkerLanguageRegistration[]
  readonly themeRegistration: ShikiWorkerThemeRegistration
  readonly themeRegistrations: readonly ShikiWorkerThemeRegistration[]
  readonly maxLineLength: number
}

type ShikiEditPayload = {
  readonly type: 'edit'
  readonly source: DocumentWorkerReadReference
  readonly previousPoint: DocumentWorkerPoint
  readonly documentId: string
  readonly runtimeSessionId: string
  readonly lang: string
  readonly theme: string
  readonly edits: readonly TextEdit[]
}

type ShikiThemePayload = {
  readonly type: 'theme'
  readonly theme: string
  readonly themeRegistration: ShikiWorkerThemeRegistration
  readonly themeRegistrations: readonly ShikiWorkerThemeRegistration[]
}

type SourcePayload = {
  readonly type: 'source'
  readonly command: DocumentWorkerSourceCommand
}

type DisposeDocumentPayload = {
  readonly type: 'disposeDocument'
  readonly runtimeSessionId: string
}

type TreeSitterWirePayload<Payload, Type extends string> = Payload & {
  readonly type: Type
  readonly generation: number
  readonly cancellationBuffer?: SharedArrayBuffer
}

export type TreeSitterFixturePayload =
  | SourcePayload
  | DisposeDocumentPayload
  | TreeSitterWirePayload<TreeSitterParsePayload, 'parse'>
  | TreeSitterWirePayload<TreeSitterEditPayload, 'edit'>
  | TreeSitterWirePayload<TreeSitterRangePayload, 'queryRange'>

export type TreeSitterFixtureResponse =
  | {
      readonly id: number
      readonly ok: true
      readonly result?: DocumentWorkerSourceResult | TreeSitterResult
    }
  | { readonly id: number; readonly ok: false; readonly error: string }

export type SyntaxWorkerRequest = {
  readonly id: number
  readonly payload:
    | TreeSitterFixturePayload
    | ShikiOpenPayload
    | ShikiEditPayload
    | ShikiThemePayload
}
