import {
  scopedSessionKey,
  type ClientOrchestrationCommand,
  type ScopedSessionRef,
  type WorktreeId,
} from '@workspace/contracts'
import {
  createSessionActiveReorderCommand,
  createSessionLifecycleCommand,
  createSessionPlaceCommand,
  createSessionReorderCommand,
} from '@workspace/client-core/chat/commands'
import type { RailDropPlan, RailShelf, RailListItem } from '@workspace/client-core/chat/rail/drop'
import type {
  SessionLifecycleOverride,
  SessionRailItem,
} from '@workspace/client-core/chat/rail/model'

export type SessionDropEntry = {
  readonly ref: ScopedSessionRef
  readonly key: string
  readonly worktreeId: WorktreeId
  readonly source: RailShelf
  readonly original: SessionLifecycleOverride
  readonly preview: SessionLifecycleOverride
}
export type SessionDropPatch = {
  readonly kind: 'session-drop'
  readonly ref: ScopedSessionRef
  readonly movedKey: string
  readonly source: RailShelf
  readonly destination: RailShelf
  readonly entries: readonly SessionDropEntry[]
  readonly commands: readonly {
    readonly ref: ScopedSessionRef
    readonly command: ClientOrchestrationCommand
  }[]
}

export function railDropItems(rows: readonly SessionRailItem[]): readonly RailListItem[] {
  const items: RailListItem[] = [{ kind: 'marker', marker: 'pinned-header' }]
  items.push(...shelfRows(rows, 'pinned'), { kind: 'marker', marker: 'pinned-divider' })
  items.push({ kind: 'marker', marker: 'active-placeholder' }, ...shelfRows(rows, 'active'))
  items.push({ kind: 'marker', marker: 'snoozed-header' }, ...shelfRows(rows, 'snoozed'))
  items.push(
    { kind: 'marker', marker: 'settled-header' },
    { kind: 'marker', marker: 'settled-placeholder' },
    ...shelfRows(rows, 'settled'),
  )
  return items
}
function shelfRows(rows: readonly SessionRailItem[], section: RailShelf): RailListItem[] {
  return rows
    .filter((row) => row.placement === section)
    .map((row) => ({ kind: 'session', key: row.key, section }))
}

export function sessionDropPatch(
  active: SessionRailItem,
  plan: RailDropPlan,
  rows: ReadonlyMap<string, SessionRailItem>,
  at: string,
): SessionDropPatch | null {
  if (plan.kind === 'none') return null
  const commands = dropCommands(active, plan, rows)
  if (!commands) return null
  const entries = new Map<string, SessionDropEntry>()
  for (const { ref, command } of commands) {
    const key = scopedSessionKey(ref)
    const row = rows.get(key)
    if (!row) return null
    const held = entries.get(key)
    const original = held?.original ?? lifecycleFields(row)
    const preview = {
      ...held?.preview,
      ...commandPreview(command, { ...original, ...held?.preview }, at),
    }
    entries.set(key, {
      ref,
      key,
      worktreeId: row.worktree.id,
      source: row.placement,
      original,
      preview,
    })
  }
  const destination = dropDestination(plan)
  return {
    kind: 'session-drop',
    ref: active.ref,
    movedKey: active.key,
    source: active.placement,
    destination,
    entries: [...entries.values()],
    commands,
  }
}

function dropCommands(
  active: SessionRailItem,
  plan: Exclude<RailDropPlan, { kind: 'none' }>,
  rows: ReadonlyMap<string, SessionRailItem>,
) {
  const commands: Array<{ ref: ScopedSessionRef; command: ClientOrchestrationCommand }> = []
  const change = (type: 'pin' | 'unpin' | 'unsettle' | 'unsnooze' | 'settle') =>
    commands.push({ ref: active.ref, command: createSessionLifecycleCommand(active.id, { type }) })
  let assignments: readonly { readonly id: string; readonly orderKey: string }[] = []
  if (plan.kind === 'settle') change('settle')
  if (plan.kind === 'reorder-pinned') assignments = plan.assignments
  if (plan.kind === 'pin') {
    const command = plan.orderKey
      ? createSessionPlaceCommand({ sessionId: active.id, orderKey: plan.orderKey })
      : createSessionLifecycleCommand(active.id, { type: 'pin' })
    commands.push({ ref: active.ref, command })
    assignments = plan.extraAssignments
  }
  if (plan.kind === 'move-active') {
    if (plan.unpin) change('unpin')
    if (plan.unsettle) change('unsettle')
    if (plan.unsnooze) change('unsnooze')
    assignments = plan.assignments
  }
  for (const assignment of assignments) {
    const row = rows.get(assignment.id)
    if (!row) return null
    const input = { sessionId: row.id, orderKey: assignment.orderKey }
    const command =
      plan.kind === 'move-active'
        ? createSessionActiveReorderCommand(input)
        : createSessionReorderCommand(input)
    commands.push({ ref: row.ref, command })
  }
  return commands
}

function lifecycleFields(row: SessionRailItem): SessionLifecycleOverride {
  return {
    pinnedAt: row.pinnedAt,
    pinOrderKey: row.pinOrderKey,
    settledOverride: row.settledOverride,
    settledAt: row.settledAt,
    snoozedUntil: row.snoozedUntil,
    snoozedAt: row.snoozedAt,
    activeOrderKey: row.activeOrderKey,
    unsettledAt: row.unsettledAt,
  }
}
function commandPreview(
  command: ClientOrchestrationCommand,
  prior: SessionLifecycleOverride,
  at: string,
): SessionLifecycleOverride {
  switch (command.type) {
    case 'session.pin':
      return {
        pinnedAt: prior.pinnedAt ?? at,
        pinOrderKey: prior.pinnedAt ? prior.pinOrderKey : (command.orderKey ?? prior.pinOrderKey),
        ...(prior.settledOverride === 'settled'
          ? { settledOverride: 'active', settledAt: null, unsettledAt: at }
          : {}),
        snoozedAt: null,
        snoozedUntil: null,
      }
    case 'session.unpin':
      return { pinnedAt: null, pinOrderKey: null }
    case 'session.unsettle':
      return {
        settledOverride: 'active',
        settledAt: null,
        unsettledAt: prior.settledOverride === 'active' ? prior.unsettledAt : at,
      }
    case 'session.unsnooze':
      return { snoozedAt: null, snoozedUntil: null }
    case 'session.settle':
      return {
        settledOverride: 'settled',
        settledAt: prior.settledAt ?? at,
        pinnedAt: null,
        pinOrderKey: null,
        snoozedUntil: null,
        snoozedAt: null,
        activeOrderKey: null,
        unsettledAt: null,
      }
    case 'session.pin.reorder':
      return { pinOrderKey: command.orderKey }
    case 'session.active.reorder':
      return { activeOrderKey: command.orderKey }
    default:
      return {}
  }
}

function dropDestination(plan: RailDropPlan): RailShelf {
  if (plan.kind === 'settle') return 'settled'
  if (plan.kind === 'move-active') return 'active'
  return 'pinned'
}
