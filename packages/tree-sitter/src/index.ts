export {
  TreeSitterLanguageRegistry,
  createTreeSitterLanguageRegistry,
  isTreeSitterLanguageId,
  resolveTreeSitterLanguageAlias,
  resolveTreeSitterLanguageContribution,
  type TreeSitterLanguageAssets,
  type TreeSitterLanguageContribution,
  type TreeSitterLanguageDescriptor,
  type TreeSitterLanguageDisposable,
  type TreeSitterLanguageId,
  type TreeSitterLanguageRegistrationOptions,
  type TreeSitterLanguageResolver,
} from './treeSitter/registry'
export type {
  BracketInfo,
  FoldRange,
  TreeSitterCapture,
  TreeSitterError,
  TreeSitterInjectionInfo,
  TreeSitterParseResult,
  TreeSitterPoint,
} from './treeSitter/types'
export {
  canUseTreeSitterWorker,
  createTreeSitterWorkerBackend,
  TreeSitterWorkerClient,
  type TreeSitterBackend,
  type TreeSitterEditPayload,
  type TreeSitterParsePayload,
  type TreeSitterSelectionPayload,
  type TreeSitterWorkerCacheSnapshot,
  type TreeSitterWorkerLifecycleState,
  type TreeSitterWorkerOwnerSnapshot,
} from './treeSitter/workerClient'
export {
  createTreeSitterSourceDescriptor,
  readTreeSitterInputRange,
  readTreeSitterPieceTableInput,
  resolveTreeSitterSourceDescriptor,
  type TreeSitterSourceCache,
  type TreeSitterSourceDescriptor,
} from './treeSitter/source'
export type { TreeSitterSourceChunkRetentionSnapshot } from './treeSitter/sourceChunkRetention'
export {
  TreeSitterSyntaxSession,
  createTextDiffEdit,
  createTreeSitterEditPayload,
  type TreeSitterSyntaxSessionOptions,
} from './session'
export {
  expandTreeSitterSelection,
  selectTreeSitterToken,
  shrinkTreeSitterSelection,
  type TreeSitterSelectionCommandOptions,
  type TreeSitterSelectionCommandResult,
  type TreeSitterSelectionExpansionState,
} from './structuralSelection'
import type { EditorSyntaxProvider } from '@singapore-editor/core/syntax'
import type {
  EditorDisposable,
  EditorPlugin,
  EditorPluginContext,
} from '@singapore-editor/core/extensions'
import type {
  TreeSitterLanguageAssets,
  TreeSitterLanguageContribution,
  TreeSitterLanguageDescriptor,
  TreeSitterLanguageDisposable,
  TreeSitterLanguageId,
  TreeSitterLanguageRegistrationOptions,
  TreeSitterLanguageResolver,
} from './treeSitter/registry'
import { TreeSitterLanguageRegistry, resolveTreeSitterLanguageClosure } from './treeSitter/registry'
import { TreeSitterSyntaxSession } from './session'
import { treeSitterSelectionRanges } from './structuralSelection'
import { createTreeSitterWorkerBackend, type TreeSitterBackend } from './treeSitter/workerClient'

export type TreeSitterSyntaxProviderOptions = {
  readonly backend?: TreeSitterBackend
}

export type TreeSitterSyntaxProvider = EditorSyntaxProvider &
  TreeSitterLanguageResolver & {
    registerLanguage(
      contribution: TreeSitterLanguageContribution,
      options?: TreeSitterLanguageRegistrationOptions,
    ): TreeSitterLanguageDisposable
    /**
     * Starts the worker and compiles each language with its injection closure, so the first
     * document of a warmed language pays none of it. Never rejects: unknown ids and load or
     * worker failures are skipped, and the language's first document reports them.
     */
    warmLanguages(languageIds: readonly TreeSitterLanguageId[]): Promise<void>
  }

export type TreeSitterLanguagePluginOptions = TreeSitterLanguageRegistrationOptions & {
  readonly name?: string
}

export type TreeSitterSyntaxPluginOptions = {
  readonly name?: string
}

type TreeSitterProviderRegistration = {
  readonly provider: TreeSitterSyntaxProvider
  readonly contextReferences: WeakMap<EditorPluginContext, TreeSitterContextReference>
  readonly languageReferences: Map<string, TreeSitterLanguageReference>
}

type TreeSitterContextReference = {
  contributions: readonly EditorDisposable[]
  references: number
}

type TreeSitterLanguageReference = {
  disposable: TreeSitterLanguageDisposable
  references: number
}

const DEFAULT_TREE_SITTER_PROVIDER_KEY = Symbol.for(
  '@singapore-editor/tree-sitter/default-provider',
)

export const createTreeSitterSyntaxProvider = (
  options: TreeSitterSyntaxProviderOptions = {},
): TreeSitterSyntaxProvider => {
  const registry = new TreeSitterLanguageRegistry()
  const backend = options.backend ?? createTreeSitterWorkerBackend()

  return {
    createSession: (sessionOptions) => {
      if (!sessionOptions.languageId) return null
      return new TreeSitterSyntaxSession({
        ...sessionOptions,
        languageId: sessionOptions.languageId,
        languageResolver: registry,
        backend,
      })
    },
    registerLanguage: (contribution, registrationOptions) =>
      registry.registerLanguage(contribution, registrationOptions),
    resolveTreeSitterLanguage: (languageId) => registry.resolveTreeSitterLanguage(languageId),
    warmLanguages: (languageIds) => warmTreeSitterLanguages(registry, backend, languageIds),
  }
}

const warmTreeSitterLanguages = async (
  resolver: TreeSitterLanguageResolver,
  backend: TreeSitterBackend,
  languageIds: readonly TreeSitterLanguageId[],
): Promise<void> => {
  if (!backend.warmLanguages) return

  const closures = await Promise.allSettled(
    languageIds.map((languageId) => resolveTreeSitterLanguageClosure(resolver, languageId)),
  )
  const descriptors = new Map<TreeSitterLanguageId, TreeSitterLanguageDescriptor>()
  for (const closure of closures) {
    if (closure.status === 'rejected') continue
    for (const descriptor of closure.value) {
      if (!descriptors.has(descriptor.id)) descriptors.set(descriptor.id, descriptor)
    }
  }
  // Best effort: a worker that cannot start fails the first document too, which reports it.
  await backend.warmLanguages([...descriptors.values()]).catch(() => undefined)
}

export const createTreeSitterLanguagePlugin = (
  contributions: readonly TreeSitterLanguageContribution[],
  options: TreeSitterLanguagePluginOptions = {},
): EditorPlugin => ({
  name: options.name ?? 'tree-sitter-languages',
  activate(context) {
    const registration = defaultProviderRegistration()
    return [
      retainSyntaxProvider(context, registration),
      ...contributions.map((contribution) => retainLanguage(registration, contribution)),
    ]
  },
})

/** Registers an already-configured provider with an editor without constructing another backend. */
export const createTreeSitterSyntaxPlugin = (
  provider: TreeSitterSyntaxProvider,
  options: TreeSitterSyntaxPluginOptions = {},
): EditorPlugin => ({
  name: options.name ?? 'tree-sitter-syntax',
  activate: (context) => contributeToEditor(context, provider),
})

const defaultProviderRegistration = (): TreeSitterProviderRegistration => {
  const state = globalThis as Record<PropertyKey, unknown>
  const existing = state[DEFAULT_TREE_SITTER_PROVIDER_KEY] as
    | TreeSitterProviderRegistration
    | undefined
  if (existing) return existing

  const registration = {
    provider: createTreeSitterSyntaxProvider(),
    contextReferences: new WeakMap<EditorPluginContext, TreeSitterContextReference>(),
    languageReferences: new Map<string, TreeSitterLanguageReference>(),
  }
  state[DEFAULT_TREE_SITTER_PROVIDER_KEY] = registration
  return registration
}

const retainSyntaxProvider = (
  context: EditorPluginContext,
  registration: TreeSitterProviderRegistration,
): EditorDisposable => {
  const existing = registration.contextReferences.get(context)
  if (existing) {
    existing.references += 1
    return { dispose: () => releaseSyntaxProvider(context, registration) }
  }

  registration.contextReferences.set(context, {
    contributions: contributeToEditor(context, registration.provider),
    references: 1,
  })
  return {
    dispose: () => releaseSyntaxProvider(context, registration),
  }
}

const contributeToEditor = (
  context: EditorPluginContext,
  provider: TreeSitterSyntaxProvider,
): readonly EditorDisposable[] => {
  return [
    context.registerSyntaxProvider(provider),
    context.registerSelectionRangeProvider((selection) =>
      treeSitterSelectionRanges(selection.folds),
    ),
  ]
}

const retainLanguage = (
  registration: TreeSitterProviderRegistration,
  contribution: TreeSitterLanguageContribution,
): EditorDisposable => {
  const key = languageRegistrationKey(contribution)
  const existing = registration.languageReferences.get(key)
  if (existing) {
    existing.references += 1
    return { dispose: () => releaseLanguage(registration, key) }
  }

  registration.languageReferences.set(key, {
    disposable: registration.provider.registerLanguage(contribution, { replace: true }),
    references: 1,
  })
  return { dispose: () => releaseLanguage(registration, key) }
}

const releaseSyntaxProvider = (
  context: EditorPluginContext,
  registration: TreeSitterProviderRegistration,
): void => {
  const reference = registration.contextReferences.get(context)
  if (!reference) return

  reference.references -= 1
  if (reference.references > 0) return

  for (const contribution of reference.contributions.toReversed()) contribution.dispose()
  registration.contextReferences.delete(context)
}

const releaseLanguage = (registration: TreeSitterProviderRegistration, key: string): void => {
  const reference = registration.languageReferences.get(key)
  if (!reference) return

  reference.references -= 1
  if (reference.references > 0) return

  reference.disposable.dispose()
  registration.languageReferences.delete(key)
}

const languageRegistrationKey = (contribution: TreeSitterLanguageContribution): string =>
  JSON.stringify({
    aliases: sortedItems(contribution.aliases),
    assets: inlineAssetSignature(contribution),
    extensions: sortedItems(contribution.extensions),
    id: contribution.id,
    loader: lazyLoaderSignature(contribution),
  })

const lazyLoaderSignature = (contribution: TreeSitterLanguageContribution): string | null => {
  if (!('load' in contribution)) return null

  return contribution.load?.toString() ?? null
}

const inlineAssetSignature = (
  contribution: TreeSitterLanguageContribution,
): TreeSitterLanguageAssets | null => {
  if ('load' in contribution) return null

  return {
    foldQuerySource: contribution.foldQuerySource,
    highlightQuerySource: contribution.highlightQuerySource,
    injectionQuerySource: contribution.injectionQuerySource,
    wasmUrl: contribution.wasmUrl,
  }
}

const sortedItems = (items: readonly string[] | undefined): readonly string[] =>
  (items ?? []).toSorted()
