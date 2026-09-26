export type FocusArea =
  | 'chat'
  | 'command-palette'
  | 'dialog'
  | 'editor'
  | 'file-tree'
  | 'git'
  | 'global'
  | 'logs'
  | 'problems'
  | 'search'
  | 'settings'
  | 'terminal'
export type FocusLayout = 'chat' | 'workbench'

export type FocusTargetId =
  | { readonly kind: 'app-shell' }
  | { readonly kind: 'chat-composer'; readonly key: string }
  | { readonly kind: 'command-palette' }
  | { readonly kind: 'editor-group-dialog' }
  | {
      readonly kind: 'editor'
      readonly key: string
      readonly side?: 'new' | 'old' | 'stacked'
      readonly surface:
        | 'diff'
        | 'document'
        | 'search-result'
        | 'settings'
        | 'history'
        | 'placeholder'
      readonly tabId?: string
    }
  | { readonly kind: 'file-tree'; readonly rootPath: string }
  | { readonly kind: 'git'; readonly rootPath: string }
  | { readonly kind: 'logs' }
  | { readonly kind: 'problems' }
  | { readonly kind: 'turn-changes'; readonly key: string }
  | {
      readonly kind: 'search'
      readonly rootPath: string
      readonly surface: 'editor' | 'sidebar'
    }
  | { readonly kind: 'theme-studio' }
  | { readonly kind: 'settings-dialog' }
  | { readonly kind: 'settings-page'; readonly tabId: string }
  | {
      readonly kind: 'terminal'
      readonly rootPath: string
      readonly sessionId: string
    }
  | { readonly dialogTarget: object; readonly kind: 'unsaved-dialog' }
  | { readonly kind: 'tui-widget'; readonly key: string }

export type FocusIntent =
  | 'focus'
  | 'open-search'
  | 'reveal-active'
  | 'create-file'
  | 'create-folder'

export type FocusTransitionOutcome =
  | { readonly status: 'acknowledged'; readonly targetId: FocusTargetId }
  | {
      readonly reason: 'destination-invalid' | 'refused' | 'unregistered'
      readonly status: 'rejected'
    }
  | { readonly by: FocusRequestToken; readonly status: 'superseded' }

export type FocusTransitionTicket = {
  readonly completion: Promise<FocusTransitionOutcome>
  readonly token: FocusRequestToken
}

function sameEditorTarget(left: Extract<FocusTargetId, { kind: 'editor' }>, right: FocusTargetId) {
  if (right.kind !== 'editor') return false

  return (
    left.key === right.key &&
    left.side === right.side &&
    left.surface === right.surface &&
    left.tabId === right.tabId
  )
}

export function focusTargetIdsEqual(left: FocusTargetId, right: FocusTargetId): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'editor') return sameEditorTarget(left, right)
  if (left.kind === 'turn-changes') return right.kind === left.kind && left.key === right.key
  if (left.kind === 'tui-widget') return right.kind === left.kind && left.key === right.key
  if (left.kind === 'chat-composer') return right.kind === left.kind && left.key === right.key
  if (left.kind === 'file-tree') {
    return right.kind === left.kind && left.rootPath === right.rootPath
  }
  if (left.kind === 'git') return right.kind === left.kind && left.rootPath === right.rootPath
  if (left.kind === 'search') {
    return (
      right.kind === left.kind && left.rootPath === right.rootPath && left.surface === right.surface
    )
  }
  if (left.kind === 'settings-page') return right.kind === left.kind && left.tabId === right.tabId
  if (left.kind === 'terminal') {
    return (
      right.kind === left.kind &&
      left.rootPath === right.rootPath &&
      left.sessionId === right.sessionId
    )
  }
  if (left.kind === 'unsaved-dialog') {
    return right.kind === left.kind && left.dialogTarget === right.dialogTarget
  }

  return true
}

const requestBrand: unique symbol = Symbol('FocusRequest')
const targetBrand: unique symbol = Symbol('FocusTarget')
export type FocusRequestToken = { readonly [requestBrand]: true }
export type FocusTargetToken = { readonly [targetBrand]: true }
export function createFocusRequestToken(): FocusRequestToken {
  return Object.freeze({ [requestBrand]: true as const })
}
export function createFocusTargetToken(): FocusTargetToken {
  return Object.freeze({ [targetBrand]: true as const })
}

export type FocusResolution<Target> =
  | { readonly status: 'none' | 'ambiguous' }
  | { readonly status: 'resolved'; readonly registration: Target }

export function resolveFocusTarget<Target extends { readonly token: Token }, Token>(options: {
  readonly targets: readonly Target[]
  readonly compatible: (target: Target) => boolean
  readonly event?: FocusResolution<Target>
  readonly origin?: Token | null
  readonly owner?: Token | null
  readonly last?: Token | null
  readonly exact?: (target: Target) => boolean
}): Target | null {
  if (options.event?.status === 'ambiguous') return null
  if (options.event?.status === 'resolved') return options.event.registration
  const targets = options.targets.filter(options.compatible)
  const origin = targets.find((target) => target.token === options.origin)
  if (origin) return origin
  const owner = targets.find((target) => target.token === options.owner)
  if (owner) return owner
  if (options.exact) {
    const exact = targets.filter(options.exact)
    if (exact.length > 1) return null
    if (exact.length === 1) return exact[0]
  }
  const last = targets.find((target) => target.token === options.last)
  if (last) return last
  return targets.length === 1 ? targets[0] : null
}
