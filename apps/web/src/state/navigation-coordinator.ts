import {
  viewForAddress,
  addressForView,
  type WorkspaceView,
  type WorkspaceAddressOwner,
} from '@/features/address/utils/view'
import { defaultLogsFilterState } from '@/features/logs/utils/filter-params'
import type { Address } from '@workspace/client-core/address/grammar'
import { formatAddress } from '@workspace/client-core/address/grammar'
import { parseWorkspaceToken } from '@workspace/client-core/address/workspace'
import { applyAddressView } from '@/features/address/state/apply-view'
import { writeAddressCache } from '@/features/address/state/storage'
import { addressEnvironments } from '@/features/address/utils/environments'
import { addressHrefFromBrowser } from '@/features/address/utils/browser-url'
import {
  intentForAddress,
  parseAddressIntent,
  resolveIntentEnvironment,
  type AddressIntent,
} from '@/features/address/utils/intent'
import {
  addressForHistoryTraversal,
  type NavigationHistoryTarget,
} from '@/features/address/utils/history'
import {
  buildAddressLocation,
  navigateAddress,
  hasAvailableRoute,
} from '@/features/address/utils/route-options'
import { budgetAddress } from '@/features/address/utils/snapshot'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { errorMessage } from '@/lib/error-message'
import { log } from '@/lib/client-logging'
import type { ApplicationRuntime } from '@/state/application-runtime'
import type { WorktreeId } from '@workspace/contracts'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import type { ApplicationRouter } from '@/state/router'
import { captureAddress } from '@/state/navigation-capture'

export type NavigationResult =
  | { readonly status: 'applied' }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'superseded' }

export type NavigationStatus =
  | { readonly status: 'pending'; readonly href: string }
  | { readonly status: 'applied'; readonly href: string }
  | { readonly status: 'unavailable'; readonly href: string; readonly reason: string }

type ApplicationReason = 'boot' | 'traverse' | 'navigate'
type HistoryWriteMode = 'immediate' | 'continuous'
type PendingHistory = { readonly owner: ApplicationRuntime; readonly identity: string }
type AddressReconciliation = {
  readonly owner: EditorWorkspaceStoreApi
  readonly transform: (address: Address, rootPath: string | null) => Address
}
type OperationPayload =
  | { readonly kind: 'incoming'; readonly address: Address }
  | {
      readonly kind: 'command'
      readonly view: WorkspaceView
      readonly owner: WorkspaceAddressOwner
      readonly passthrough: Address['passthrough']
    }
type Operation = {
  readonly generation: number
  readonly abort: AbortController
  readonly reason: ApplicationReason
  readonly historyWriteMode: HistoryWriteMode
  readonly settle: (result: NavigationResult) => void
  readonly result: Promise<NavigationResult>
  href: string | null
  complete: OperationPayload | null
  beforeApply?: () => void
  draftWorktreeId?: WorktreeId
  preserveTransient: boolean
  applying: boolean
  historyIdentity: string | null
  writing: boolean
  reconciliations: AddressReconciliation[]
}

export type NavigationPreparation = {
  readonly application: ApplicationRuntime
  readonly signal: AbortSignal
  readonly isCurrent: () => boolean
  readonly address: Address
}

type Destination = {
  readonly address: Address
  readonly replace: boolean
  readonly historyTarget?: NavigationHistoryTarget | null
  readonly preserveTransient?: boolean
  readonly beforeApply?: () => void
  readonly draftWorktreeId?: WorktreeId
}

export function createNavigationCoordinator(router: ApplicationRouter, initial: AddressIntent) {
  const initialLocation = router.buildLocation({
    to: router.latestLocation.pathname,
    search: true,
    params: true,
    hash: true,
  })
  let application: ApplicationRuntime | null = null
  let generation = 0
  let operation: Operation | null = null
  let accepted = initial.address
  let status: NavigationStatus = { status: 'pending', href: router.history.location.href }
  const listeners = new Set<() => void>()
  let stopped = false
  let bootIntentAvailable = true
  let attachment = 0
  let observedIdentity = historyIdentity()
  let subscriptions: Array<() => void> = []
  let pendingHistory: PendingHistory | null = null
  let detachedHistory: PendingHistory | null = null
  let historyTimer: ReturnType<typeof setTimeout> | null = null
  let publication: { readonly href: string } | null = null

  function historyIdentity() {
    const state = router.history.location.state
    return `${state.__TSR_index}:${state.__TSR_key ?? ''}`
  }

  function publish(next: NavigationStatus) {
    status = next
    for (const listener of listeners) listener()
  }

  function begin(
    reason: ApplicationReason,
    href: string | null,
    historyWriteMode: HistoryWriteMode = 'immediate',
  ): Operation {
    cancel(historyWriteMode === 'continuous')
    const completion = Promise.withResolvers<NavigationResult>()
    const next: Operation = {
      generation: ++generation,
      abort: new AbortController(),
      reason,
      historyWriteMode,
      href,
      complete: null,
      applying: false,
      preserveTransient: false,
      writing: false,
      reconciliations: [],
      historyIdentity: href ? historyIdentity() : null,
      result: completion.promise,
      settle: completion.resolve,
    }
    operation = next
    publish({ status: 'pending', href: href ?? router.history.location.href })
    return next
  }

  function cancel(preserveHistory = false) {
    if (!preserveHistory) cancelHistory()
    operation?.abort.abort()
    operation?.settle({ status: 'superseded' })
    operation = null
  }

  function cancelHistory() {
    if (historyTimer !== null) clearTimeout(historyTimer)
    historyTimer = null
    pendingHistory = null
    publication = null
  }

  function scheduleHistory(owner: ApplicationRuntime) {
    pendingHistory = { owner, identity: historyIdentity() }
    if (historyTimer !== null) return
    // Share one cadence across edits; per-keystroke writes exhaust Safari's history quota.
    historyTimer = setTimeout(() => void publishHistory(), 250)
  }

  async function publishHistory() {
    historyTimer = null
    const pending = pendingHistory
    pendingHistory = null
    if (!pending || stopped || pending.owner !== application) return
    if (pending.identity !== historyIdentity()) return
    const canonical = budgetAddress(captureAddress(pending.owner, accepted)).address
    const href = buildAddressLocation(router, canonical).publicHref
    if (href === router.history.location.href) return
    const writing = { href }
    publication = writing
    try {
      const navigation = navigateAddress(router, canonical, { replace: true })
      router.history.flush()
      await navigation
    } catch (error) {
      if (publication !== writing) return
      const reason = errorMessage(error, 'The address could not be updated.')
      log.error({ action: 'navigation.history', area: 'address', status: 'failed', reason })
      publish({ status: 'unavailable', href, reason })
    } finally {
      if (publication === writing) publication = null
    }
  }

  function flushHistory() {
    if (historyTimer !== null) clearTimeout(historyTimer)
    void publishHistory()
  }

  function isCurrent(op: Operation, owner = application) {
    if (stopped || application !== owner || operation !== op || op.abort.signal.aborted)
      return false
    return (
      (op.href === null || op.href === router.history.location.href) &&
      (op.historyIdentity === null || op.historyIdentity === historyIdentity())
    )
  }

  function reachedIntent(op: Operation) {
    if (op.complete)
      return intentForAddress(reachedAddress(op, payloadAddress(op.complete)), {
        complete: op.complete.kind === 'command',
      })
    if (op.reason === 'boot')
      return resolveIntentEnvironment(
        initial,
        addressEnvironments(useEnvironmentsStore.getState().entries),
      )
    const incoming = parseAddressIntent(
      addressHrefFromBrowser(router.history.location.href),
      addressEnvironments(useEnvironmentsStore.getState().entries),
    )
    return intentForAddress(reachedAddress(op, incoming.address))
  }

  function reachedAddress(op: Operation, address: Address) {
    if (op.reason !== 'traverse') return address

    return addressForHistoryTraversal(
      address,
      router.history.location.state.platformNavigationTarget,
    )
  }

  function finish(op: Operation, result: NavigationResult) {
    if (operation !== op) return
    if (op.historyWriteMode === 'immediate') router.history.flush()
    op.settle(result)
    operation = null
    const href =
      op.historyWriteMode === 'continuous' && result.status === 'applied'
        ? buildAddressLocation(router, accepted).publicHref
        : router.history.location.href
    if (result.status === 'superseded') return
    publish({ ...result, href })
    const budget = op.complete ? budgetAddress(payloadAddress(op.complete)) : null
    log.info({
      action: 'navigation.completed',
      area: 'address',
      status: result.status,
      generation: op.generation,
      reason: op.reason,
      historyWriteMode: op.historyWriteMode,
      hrefLength: href.length,
      unavailableReason: result.status === 'unavailable' ? result.reason : undefined,
      omittedFields: budget?.omissions ?? [],
      destinationOverBudget: budget?.destinationOverBudget ?? false,
    })
  }

  async function apply(op = operation) {
    const owner = application
    if (!op || !owner || !isCurrent(op, owner) || op.applying) return
    op.applying = true
    try {
      while (isCurrent(op, owner)) {
        const payload = op.complete
        await applyCurrent(op, owner, payload)
        if (op.complete === payload) return
      }
    } catch (error) {
      if (!isCurrent(op, owner)) return
      finish(op, {
        status: 'unavailable',
        reason: errorMessage(error, 'This destination could not be opened.'),
      })
    }
  }

  async function applyCurrent(
    op: Operation,
    owner: ApplicationRuntime,
    payload: Operation['complete'],
  ) {
    if (!hasAvailableRoute(router)) {
      finish(op, { status: 'unavailable', reason: 'This destination is unavailable.' })
      return
    }
    const beforeApply = op.beforeApply
    op.beforeApply = undefined
    beforeApply?.()
    const intent = reachedIntent(op)
    const result = await applyAddressView({
      application: owner,
      address: intent,
      reason: op.reason,
      isCurrent: () => isCurrent(op, owner) && op.complete === payload,
      signal: op.abort.signal,
      preserveTransient: op.preserveTransient,
      draftWorktreeId: op.draftWorktreeId,
      reconcileResources: (workspace, rootPath) =>
        reconcileResolvedAddress(op, workspace, rootPath),
    })
    if (!isCurrent(op, owner) || op.complete !== payload) return
    if (result.status !== 'applied') {
      finish(op, result.status === 'superseded' ? { status: 'superseded' } : result)
      return
    }
    accepted = intent.address
    const complete = captureAddress(owner, accepted)
    const canonical = budgetAddress(complete).address
    const location = buildAddressLocation(router, canonical)
    if (
      op.historyWriteMode === 'immediate' &&
      location.publicHref !== router.history.location.href
    ) {
      op.href = location.publicHref
      op.historyIdentity = null
      op.writing = true
      await navigateAddress(router, canonical, { replace: true })
      if (!isCurrent(op, owner) || op.complete !== payload) return
    }
    accepted = canonical
    bootIntentAvailable = false
    writeAddressCache(formatAddress(canonical))
    if (op.historyWriteMode === 'continuous') scheduleHistory(owner)
    finish(op, { status: 'applied' })
  }

  async function commit(op: Operation, destination: Destination) {
    if (!isCurrent(op)) return
    const address = destination.address
    op.complete = payloadForAddress(address)
    op.beforeApply = destination.beforeApply
    op.draftWorktreeId = destination.draftWorktreeId
    op.preserveTransient = destination.preserveTransient ?? false
    if (op.historyWriteMode === 'continuous') {
      await apply(op)
      return
    }
    const wire = budgetAddress(address).address
    op.href = buildAddressLocation(router, wire).publicHref
    op.historyIdentity = null
    op.writing = true
    await navigateAddress(router, wire, {
      replace: destination.replace,
      historyTarget: destination.historyTarget,
    })
    if (!isCurrent(op)) return
    await apply(op)
  }

  function request(
    prepare: (context: NavigationPreparation) => Destination | Promise<Destination>,
    historyWriteMode: HistoryWriteMode = 'immediate',
  ): Promise<NavigationResult> {
    if (!application || stopped) return Promise.resolve({ status: 'superseded' })
    const owner = application
    const address = currentAddress()
    const op = begin('navigate', null, historyWriteMode)
    void prepareAndCommit(op, owner, address, prepare)
    return op.result
  }

  async function prepareAndCommit(
    op: Operation,
    owner: ApplicationRuntime,
    address: Address,
    prepare: (context: NavigationPreparation) => Destination | Promise<Destination>,
  ) {
    try {
      const destination = await prepare({
        application: owner,
        address,
        signal: op.abort.signal,
        isCurrent: () => isCurrent(op, owner),
      })
      await commit(op, destination)
    } catch (error) {
      if (isCurrent(op, owner))
        finish(op, {
          status: 'unavailable',
          reason: errorMessage(error, 'This destination could not be opened.'),
        })
    }
  }

  function currentAddress() {
    const current = application ? captureAddress(application, accepted) : accepted
    if (!operation?.complete || operation.complete.kind === 'incoming') return current
    const pending = payloadAddress(operation.complete)
    return sameWorkspaceOwner(pending, current) ? pending : current
  }

  function sameWorkspaceOwner(left: WorkspaceAddressOwner, right: WorkspaceAddressOwner) {
    const primary = addressEnvironments(
      useEnvironmentsStore.getState().entries,
    ).primaryEnvironmentId
    if ((left.environmentId ?? primary) !== (right.environmentId ?? primary)) return false
    if (left.rejectedEnvironment !== right.rejectedEnvironment) return false
    const leftRoot = parseWorkspaceToken(left.workspace ?? '-')
    const rightRoot = parseWorkspaceToken(right.workspace ?? '-')
    if (leftRoot.kind === 'none') return rightRoot.kind === 'none'
    return (
      leftRoot.kind === 'workspace' &&
      rightRoot.kind === 'workspace' &&
      leftRoot.id === rightRoot.id
    )
  }

  function reconcileResolvedAddress(
    op: Operation,
    owner: EditorWorkspaceStoreApi,
    rootPath: string | null,
  ) {
    if (!op.reconciliations.length || !isCurrent(op)) return
    const intent = reachedIntent(op)
    const address = intent.address
    let next = address
    for (const reconciliation of op.reconciliations) {
      if (reconciliation.owner !== owner) continue
      next = reconciliation.transform(next, rootPath)
    }
    op.reconciliations = []
    if (next !== address) op.complete = payloadForAddress(next, intent.source)
  }

  function reconcileAddress(
    owner: EditorWorkspaceStoreApi,
    transform: AddressReconciliation['transform'],
  ): Promise<NavigationResult> {
    if (!application?.getEditorForWorkspace(owner)) return Promise.resolve({ status: 'superseded' })
    const current = captureAddress(application, accepted)
    const op = operation
    if (op) {
      op.reconciliations.push({ owner, transform })
      reconcileVisibleAddress(op, current)
      return op.result
    }
    if (application.getSnapshot().editor.workspaceStore !== owner)
      return Promise.resolve({ status: 'superseded' })
    const address = transform(current, owner.getState().rootFolder?.path ?? null)
    const location = buildAddressLocation(router, budgetAddress(address).address)
    if (location.publicHref === router.history.location.href)
      return Promise.resolve({ status: 'applied' })
    return request(() => ({ address, replace: true, preserveTransient: true }))
  }

  function reconcileVisibleAddress(op: Operation, current: Address) {
    if (!application || !op.complete || !sameWorkspaceOwner(payloadAddress(op.complete), current))
      return
    const workspace = application.getSnapshot().editor.workspaceStore
    reconcileResolvedAddress(op, workspace, workspace.getState().rootFolder?.path ?? null)
  }

  function onHistory({ action }: Parameters<Parameters<typeof router.history.subscribe>[0]>[0]) {
    const href = router.history.location.href
    observedIdentity = historyIdentity()
    const traversing = action.type === 'BACK' || action.type === 'FORWARD' || action.type === 'GO'
    if (!traversing && publication?.href === href) return
    if (!traversing && operation?.writing && operation.href === href) {
      operation.historyIdentity = historyIdentity()
      operation.writing = false
      return
    }
    const normalizingBoot =
      bootIntentAvailable && action.type === 'REPLACE' && href === initialLocation.publicHref
    if (normalizingBoot) {
      begin('boot', href)
      return
    }
    bootIntentAvailable = false
    begin(traversing ? 'traverse' : 'navigate', href)
  }

  function observe() {
    if (subscriptions.length) return
    window.addEventListener('pagehide', flushHistory)
    subscriptions = [
      () => window.removeEventListener('pagehide', flushHistory),
      router.history.subscribe(onHistory),
      router.subscribe('onBeforeNavigate', () => {
        const href = router.history.location.href
        if (publication?.href === href) return
        if (!operation || (operation.href !== null && operation.href !== href))
          begin('navigate', href)
      }),
      router.subscribe('onResolved', () => {
        void apply()
      }),
    ]
  }

  function stopObserving() {
    for (const unsubscribe of subscriptions) unsubscribe()
    subscriptions = []
  }

  function pendingOutsideWorkspace(current: Address) {
    if (!operation) return false
    if (operation.href === null) return true
    const pending = reachedIntent(operation).address
    if (operation.reason === 'boot' && pending.workspace === null) return false
    return !sameWorkspaceOwner(pending, current)
  }

  function ownsWorkspace(owner: EditorWorkspaceStoreApi, path: string) {
    if (!application || application.getSnapshot().editor.workspaceStore !== owner) return false
    if (owner.getState().rootFolder?.path !== path) return false
    return !pendingOutsideWorkspace(captureAddress(application, accepted))
  }

  function invalidateWorkspace(
    owner: EditorWorkspaceStoreApi,
    path: string,
    reason: string,
    clear: () => void,
  ) {
    if (!application || application.getSnapshot().editor.workspaceStore !== owner) return
    if (owner.getState().rootFolder?.path !== path) return
    const keepPending = pendingOutsideWorkspace(captureAddress(application, accepted))
    clear()
    accepted = budgetAddress(captureAddress(application, accepted)).address
    writeAddressCache(formatAddress(accepted))
    if (keepPending) return
    cancel()
    publish({ status: 'unavailable', href: router.history.location.href, reason })
  }

  observe()

  return {
    router,
    initial,
    getApplication: () => application,
    ownsWorkspace,
    invalidateWorkspace,
    request,
    reconcileAddress,
    currentAddress,
    getSnapshot: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    permitsRecentRoot: () =>
      initial.address.workspace === null &&
      initial.unavailable === null &&
      status.status === 'applied',
    attach(owner: ApplicationRuntime) {
      const retained = pendingHistory ?? detachedHistory
      const resumed =
        retained?.owner === owner && retained.identity === historyIdentity()
          ? captureAddress(owner, accepted)
          : null
      detachedHistory = null
      if (historyIdentity() !== observedIdentity) bootIntentAvailable = false
      observedIdentity = historyIdentity()
      observe()
      application = owner
      stopped = false
      const currentAttachment = ++attachment
      const reason = bootIntentAvailable ? 'boot' : (operation?.reason ?? 'navigate')
      const op = begin(reason, router.history.location.href)
      if (resumed) {
        op.complete = payloadForAddress(resumed)
        op.preserveTransient = true
      }
      void router
        .load()
        .then(() => apply(op))
        .catch((error: unknown) => {
          if (isCurrent(op, owner))
            finish(op, {
              status: 'unavailable',
              reason: errorMessage(error, 'This destination could not be opened.'),
            })
        })
      return () => {
        if (application !== owner || attachment !== currentAttachment) return
        detachedHistory = pendingHistory
        cancel()
        stopObserving()
        application = null
      }
    },
    transient(select: (owner: ApplicationRuntime) => void): Promise<NavigationResult> {
      if (!application) return Promise.resolve({ status: 'superseded' })
      cancel(true)
      select(application)
      publish({ status: 'applied', href: router.history.location.href })
      return Promise.resolve({ status: 'applied' })
    },
    unavailable(reason: string) {
      cancel()
      publish({ status: 'unavailable', href: router.history.location.href, reason })
    },
    dispose() {
      stopped = true
      detachedHistory = null
      cancel()
      stopObserving()
      application = null
      listeners.clear()
    },
  }
}

function payloadAddress(payload: OperationPayload) {
  if (payload.kind === 'incoming') return payload.address
  return addressForView(payload.owner, payload.view, defaultLogsFilterState(), payload.passthrough)
}

function payloadForAddress(
  address: Address,
  source: AddressIntent['source'] = 'command',
): OperationPayload {
  if (source === 'incoming') return { kind: 'incoming', address }
  return {
    kind: 'command',
    view: viewForAddress(address, defaultLogsFilterState()),
    owner: {
      environmentId: address.environmentId,
      rejectedEnvironment: address.rejectedEnvironment,
      workspace: address.workspace,
    },
    passthrough: address.passthrough,
  }
}
