import type { LspClientWorkspace, LspWorkspaceFactory } from './types'

let defaultWorkspaceFactory: LspWorkspaceFactory | null = null

export function createDefaultLspWorkspace(): LspClientWorkspace {
  if (defaultWorkspaceFactory) return defaultWorkspaceFactory()
  throw new Error('Default LSP workspace factory was not registered')
}

export function registerDefaultLspWorkspaceFactory(factory: LspWorkspaceFactory): void {
  defaultWorkspaceFactory = factory
}
