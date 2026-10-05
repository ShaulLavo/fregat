import {
  type EditorStructuralOperationContext,
  type EditorHighlighterOperationContext,
} from '../document/operations'
import type { EditorSyntaxSessionOptions, EditorSyntaxRuntime } from '../syntax/session'
import type {
  EditorHighlighterSessionOptions,
  EditorHighlighterRuntime,
} from '../syntax/highlighter'
import type { DocumentContributionSource, DocumentRead } from './documentDelivery'
import { DocumentOperation, type BoundOperationContext } from './contributionOperation'
import { AnalysisEntry, HighlighterEntry, StructuralEntry } from './documentAnalysis'
import { createEditorRuntimeSessionId, type EditorSyntaxResult } from '../syntax/session'
import type { EditorHighlightResult } from '../syntax/highlighter'
import { sameThemeCohort, type ThemeCohort } from '../syntax/providerTheme'

type HighlighterInput = EditorHighlighterSessionOptions & { readonly themeCohort?: ThemeCohort }

export type DocumentOperationContext = {
  readonly documentId: string
  readonly runtimeSessionId: string
  readonly source: DocumentContributionSource
  readonly initialRead: DocumentRead
}
export type StructuralOperationContext = DocumentOperationContext & EditorSyntaxSessionOptions
export type HighlighterOperationContext = DocumentOperationContext & EditorHighlighterSessionOptions

export class StructuralDefinition extends DocumentOperation<
  EditorSyntaxSessionOptions,
  EditorSyntaxResult,
  StructuralEntry
> {
  readonly kind = 'structural'
  protected override get cacheInactive(): boolean {
    return true
  }
  constructor(
    private readonly openRuntime: (
      context: StructuralOperationContext,
    ) => EditorSyntaxRuntime | null,
  ) {
    super()
  }
  protected create(
    context: BoundOperationContext,
    input: EditorSyntaxSessionOptions,
  ): StructuralEntry | null {
    const { host, sourceScope, initialRead, runtimeSessionId } = context
    const runtime = this.openRuntime({
      ...input,
      documentId: host.documentId,
      source: sourceScope.source,
      initialRead,
      runtimeSessionId,
    })
    return runtime
      ? new StructuralEntry(
          host.buffer,
          runtime,
          host.delivery,
          sourceScope,
          host.scheduler,
          runtimeSessionId,
          host.retention,
          context.scheduling,
        )
      : null
  }
  protected createRuntimeSessionId(): string {
    return createEditorRuntimeSessionId()
  }
  protected matches(left: EditorSyntaxSessionOptions, right: EditorSyntaxSessionOptions): boolean {
    return (
      left.languageId === right.languageId &&
      (left.includeCaptures ?? true) === (right.includeCaptures ?? true) &&
      (left.includeHighlights ?? true) === (right.includeHighlights ?? true) &&
      (left.syntaxMode ?? 'full') === (right.syntaxMode ?? 'full')
    )
  }
}

export class HighlighterDefinition extends DocumentOperation<
  HighlighterInput,
  EditorHighlightResult,
  HighlighterEntry
> {
  readonly kind = 'highlighter'
  protected override get cacheInactive(): boolean {
    return true
  }
  constructor(
    private readonly openRuntime: (
      context: HighlighterOperationContext,
    ) => EditorHighlighterRuntime | null,
  ) {
    super()
  }
  protected create(
    context: BoundOperationContext,
    input: HighlighterInput,
  ): HighlighterEntry | null {
    const { host, sourceScope, initialRead, runtimeSessionId } = context
    const runtime = this.openRuntime({
      ...input,
      documentId: host.documentId,
      source: sourceScope.source,
      initialRead,
      runtimeSessionId,
    })
    if (!runtime) return null
    const entry = new HighlighterEntry(
      host.buffer,
      runtime,
      host.delivery,
      sourceScope,
      host.scheduler,
      runtimeSessionId,
      host.retention,
      context.scheduling,
      input.themeCohort,
    )
    return entry
  }
  protected createRuntimeSessionId(): string {
    return createEditorRuntimeSessionId()
  }
  protected matches(left: HighlighterInput, right: HighlighterInput): boolean {
    return (
      left.languageId === right.languageId &&
      sameThemeCohort(left.themeCohort ?? [], right.themeCohort ?? [])
    )
  }
}

export function defineStructuralOperation(
  create: (context: StructuralOperationContext) => EditorSyntaxRuntime | null,
): StructuralDefinition {
  return new StructuralDefinition(create)
}
export function defineHighlighterOperation(
  create: (context: HighlighterOperationContext) => EditorHighlighterRuntime | null,
): HighlighterDefinition {
  return new HighlighterDefinition(create)
}

export function createEditorStructuralOperation(
  create: (context: EditorStructuralOperationContext) => EditorSyntaxRuntime | null,
): StructuralDefinition {
  return defineStructuralOperation((context) =>
    create({ ...context, source: readSource(context.source) }),
  )
}

export function createEditorHighlighterOperation(
  create: (context: EditorHighlighterOperationContext) => EditorHighlighterRuntime | null,
): HighlighterDefinition {
  return defineHighlighterOperation((context) =>
    create({ ...context, source: readSource(context.source) }),
  )
}

function readSource(
  source: DocumentContributionSource,
): EditorStructuralOperationContext['source'] {
  return {
    read: (revision) => source.read(revision),
    changesBetween: (base, target, scope) => source.changesBetween(base, target, scope),
  }
}

export type DocumentOperationRuntime<Result> = {
  analyze(read: DocumentRead, signal: AbortSignal): Promise<Result>
  /** Stable until inputs affecting the result change. */
  configurationKey?(): unknown
  dispose(): void
}

class GenericDefinition<Input, Result> extends DocumentOperation<
  Input,
  Result,
  AnalysisEntry<Result>
> {
  constructor(
    private readonly openRuntime: (
      context: DocumentOperationContext,
      input: Input,
    ) => DocumentOperationRuntime<Result> | null,
    private readonly compatible: (left: Input, right: Input) => boolean,
    private readonly scheduling: 'requested' | 'ordered',
  ) {
    super()
  }
  protected create(context: BoundOperationContext, input: Input): AnalysisEntry<Result> | null {
    const { host, sourceScope, initialRead, runtimeSessionId } = context
    const runtime = this.openRuntime(
      { documentId: host.documentId, runtimeSessionId, initialRead, source: sourceScope.source },
      input,
    )
    return runtime
      ? new AnalysisEntry(
          host.buffer,
          runtime,
          host.delivery,
          sourceScope,
          host.scheduler,
          runtimeSessionId,
          host.retention,
          context.scheduling === 'pinned' ? 'pinned' : this.scheduling,
        )
      : null
  }
  protected createRuntimeSessionId(): string {
    return createEditorRuntimeSessionId()
  }
  protected matches(left: Input, right: Input): boolean {
    return this.compatible(left, right)
  }
}

export function defineDocumentOperation<Input, Result>(
  create: (
    context: DocumentOperationContext,
    input: Input,
  ) => DocumentOperationRuntime<Result> | null,
  compatible: (left: Input, right: Input) => boolean,
  options: { readonly scheduling: 'requested' | 'ordered' } = { scheduling: 'requested' },
): DocumentOperation<Input, Result, AnalysisEntry<Result>> {
  return new GenericDefinition(create, compatible, options.scheduling)
}
