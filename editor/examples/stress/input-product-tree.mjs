import * as treeModule from '@singapore-editor/tree-sitter'
import { createError } from '@singapore-editor/core/logging/evlog'

export function createInputProductTree() {
  const ownedFactory = Reflect.get(treeModule, 'createTreeSitterWorkerOwner')
  const owned = typeof ownedFactory === 'function'
  const legacyConstructor = owned ? null : Reflect.get(treeModule, 'TreeSitterWorkerClient')
  if (!owned && typeof legacyConstructor !== 'function') {
    throw createError({
      message: 'The measured Tree-sitter product requires a worker owner',
      code: 'INPUT_PRODUCT_TREE_API',
      status: 422,
      why: 'The package exposes neither supported measurement construction API.',
      fix: 'Select a frozen package set with a supported Tree-sitter API.',
      internal: { ownedFactory: typeof ownedFactory, legacyConstructor: typeof legacyConstructor },
    })
  }
  const owner = owned ? ownedFactory() : Reflect.construct(legacyConstructor, [])
  const provider = treeModule.createTreeSitterSyntaxProvider(
    owned ? { workerOwner: owner } : { backend: owner },
  )
  return {
    owner,
    api: owned ? 'owned-operation' : 'legacy-session',
    registerLanguage: (contribution, options) => provider.registerLanguage(contribution, options),
    plugin: () => treeModule.createTreeSitterSyntaxPlugin(provider),
  }
}
