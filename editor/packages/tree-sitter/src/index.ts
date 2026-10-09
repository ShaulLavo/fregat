export { createTreeSitterInputEdits } from './treeSitter/edits'
export {
  createTreeSitterReviewSyntax,
  type TreeSitterReviewSyntax,
  type TreeSitterReviewUnit,
} from './mergeReview'
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
  TreeSitterMergeUnit,
  TreeSitterMergeUnitResult,
  TreeSitterProjectedMergeUnitsResult,
  TreeSitterSyntaxRange,
  TreeSitterPoint,
  TreeSitterWorkerRetentionSnapshot,
} from './treeSitter/types'
export {
  canUseTreeSitterWorker,
  createTreeSitterWorkerOwner,
  TreeSitterWorkerOwner,
  type TreeSitterWorkerCacheSnapshot,
  type TreeSitterWorkerLifecycleState,
  type TreeSitterWorkerOwnerSnapshot,
  type TreeSitterMergeUnitPayload,
  type TreeSitterProjectedMergeUnitsPayload,
} from './treeSitter/workerClient'
export {
  expandTreeSitterSelection,
  selectTreeSitterToken,
  shrinkTreeSitterSelection,
  type TreeSitterSelectionCommandOptions,
  type TreeSitterSelectionCommandResult,
  type TreeSitterSelectionExpansionState,
} from './structuralSelection'
import type { EditorSyntaxProvider } from '@singapore-editor/core/syntax'
import { defineStructuralOperation } from '@singapore-editor/core/internal/document-worker'
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
import {
  createTreeSitterWorkerOwner,
  treeSitterBackendForOwner,
  type TreeSitterBackend,
  type TreeSitterWorkerOwner,
} from './treeSitter/workerClient'

export type TreeSitterSyntaxProviderOptions = {
  readonly workerOwner?: TreeSitterWorkerOwner
  /**
   * Languages to compile ahead of their first document, read each time a document's first parse
   * answers, so the host's set can change (a workspace switch) and paint is never delayed. Each is
   * compiled once with its injection closure; unknown ids and load failures are skipped.
   */
  readonly warmLanguages?: () => readonly TreeSitterLanguageId[]
}

export type TreeSitterSyntaxProvider = EditorSyntaxProvider &
  TreeSitterLanguageResolver & {
    registerLanguage(
      contribution: TreeSitterLanguageContribution,
      options?: TreeSitterLanguageRegistrationOptions,
    ): TreeSitterLanguageDisposable
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
  const owner = options.workerOwner ?? createTreeSitterWorkerOwner()
  const backend = treeSitterBackendForOwner(owner)
  let warmedKey: string | null = null
  const warm = () => {
    const languageIds = options.warmLanguages?.() ?? []
    const key = languageIds.join('\n')
    if (languageIds.length === 0 || key === warmedKey) return
    warmedKey = key
    void warmTreeSitterLanguages(registry, backend, languageIds)
  }

  return {
    operation: defineStructuralOperation((sessionOptions) => {
      if (!sessionOptions.languageId) return null
      return new TreeSitterSyntaxSession({
        ...sessionOptions,
        languageId: sessionOptions.languageId,
        languageResolver: registry,
        backend,
        onFirstParse: warm,
      })
    }),
    registerLanguage: (contribution, registrationOptions) => {
      const registration = registry.registerLanguage(contribution, registrationOptions)
      warmedKey = null
      return {
        dispose: () => {
          registration.dispose()
          warmedKey = null
        },
      }
    },
    resolveTreeSitterLanguage: (languageId) => registry.resolveTreeSitterLanguage(languageId),
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
    mergeUnitQuerySource: contribution.mergeUnitQuerySource,
    wasmUrl: contribution.wasmUrl,
  }
}

const sortedItems = (items: readonly string[] | undefined): readonly string[] =>
  (items ?? []).toSorted()
