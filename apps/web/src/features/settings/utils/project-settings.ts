import {
  WORKTREE_SUBMODULE_MODES,
  descriptorFor,
  type ProjectOverrideSettingId,
  type ScalarSettingId,
  type SetProjectOverrideOperation,
  type SettingsValues,
} from '@workspace/contracts'
import { settingOptionTitle, settingRowTitle } from '@workspace/client-core/settings/humanize'

/** A choice in a project row's menu; `DEFAULT_CHOICE` follows the machine-wide value. */
type ProjectChoice = { readonly value: string; readonly label: string }

export const DEFAULT_CHOICE = 'default'

/** The write a choice makes: this project's entry in one record, or its removal. */
type ProjectOverrideWrite = Omit<SetProjectOverrideOperation, 'kind'>

export type ProjectSettingRow = {
  readonly id: string
  /** The machine-wide setting this row overrides; its title and description name the row. */
  readonly global: ScalarSettingId
  readonly key: ProjectOverrideSettingId
  readonly choices: (values: SettingsValues) => readonly ProjectChoice[]
  readonly defaultLabel: (values: SettingsValues) => string
  /** The chosen value, or `DEFAULT_CHOICE` when the project has no override. */
  readonly current: (values: SettingsValues, projectId: string) => string
  /** This project's entry after `choice`; `value: null` removes it for the default. */
  readonly write: (
    values: SettingsValues,
    projectId: string,
    choice: string,
  ) => ProjectOverrideWrite
}

const SETTLE_DAYS = [0, 1, 3, 7, 14, 30] as const

export const PROJECT_SETTING_ROWS: readonly ProjectSettingRow[] = [
  {
    id: 'project-response-streaming',
    global: 'chat.responseStreamingMode',
    key: 'chat.projectResponseStreamingModes',
    choices: () =>
      (['paragraph', 'turn', 'token'] as const).map((mode) => ({
        value: mode,
        label: settingOptionTitle('chat.responseStreamingMode', mode),
      })),
    defaultLabel: (values) =>
      settingOptionTitle('chat.responseStreamingMode', values['chat.responseStreamingMode']),
    current: (values, projectId) =>
      values['chat.projectResponseStreamingModes'][projectId] ?? DEFAULT_CHOICE,
    write: (_values, projectId, choice) => ({
      key: 'chat.projectResponseStreamingModes',
      projectId,
      value: isStreamingMode(choice) ? choice : null,
    }),
  },
  {
    id: 'project-settle-after-days',
    global: 'chat.autoSettleAfterDays',
    key: 'chat.projectAutoSettle',
    choices: (values) => dayChoices(values),
    defaultLabel: (values) => daysLabel(values['chat.autoSettleAfterDays']),
    current: (values, projectId) => {
      const days = values['chat.projectAutoSettle'][projectId]?.afterDays
      return days === undefined ? DEFAULT_CHOICE : String(days)
    },
    write: (values, projectId, choice) =>
      withAutoSettle(values, projectId, {
        afterDays: choice === DEFAULT_CHOICE ? undefined : Number(choice),
      }),
  },
  {
    id: 'project-settle-on-merge',
    global: 'chat.autoSettleOnMerge',
    key: 'chat.projectAutoSettle',
    choices: () => ON_OFF,
    defaultLabel: (values) => onOffLabel(values['chat.autoSettleOnMerge']),
    current: (values, projectId) =>
      onOffChoice(values['chat.projectAutoSettle'][projectId]?.onMerge),
    write: (values, projectId, choice) =>
      withAutoSettle(values, projectId, { onMerge: booleanChoice(choice) ?? undefined }),
  },
  {
    id: 'project-auto-pull',
    global: 'git.autoPull',
    key: 'git.projectAutoPull',
    choices: () => ON_OFF,
    defaultLabel: (values) => onOffLabel(values['git.autoPull']),
    current: (values, projectId) => onOffChoice(values['git.projectAutoPull'][projectId]),
    write: (_values, projectId, choice) => ({
      key: 'git.projectAutoPull',
      projectId,
      value: booleanChoice(choice),
    }),
  },
  {
    id: 'project-worktree-submodules',
    global: 'git.worktreeSubmodules',
    key: 'git.projectWorktreeSubmodules',
    choices: () =>
      WORKTREE_SUBMODULE_MODES.map((mode) => ({
        value: mode,
        label: settingOptionTitle('git.worktreeSubmodules', mode),
      })),
    defaultLabel: (values) =>
      settingOptionTitle('git.worktreeSubmodules', values['git.worktreeSubmodules']),
    current: (values, projectId) =>
      values['git.projectWorktreeSubmodules'][projectId] ?? DEFAULT_CHOICE,
    write: (_values, projectId, choice) => ({
      key: 'git.projectWorktreeSubmodules',
      projectId,
      value: WORKTREE_SUBMODULE_MODES.find((mode) => mode === choice) ?? null,
    }),
  },
  {
    id: 'project-worktree-cleanup',
    global: 'git.worktreeCleanupOnDelete',
    key: 'git.projectWorktreeCleanupOnDelete',
    choices: () => ON_OFF,
    defaultLabel: (values) => onOffLabel(values['git.worktreeCleanupOnDelete']),
    current: (values, projectId) =>
      onOffChoice(values['git.projectWorktreeCleanupOnDelete'][projectId]),
    write: (_values, projectId, choice) => ({
      key: 'git.projectWorktreeCleanupOnDelete',
      projectId,
      value: booleanChoice(choice),
    }),
  },
]

export function projectRowTitle(row: ProjectSettingRow) {
  return settingRowTitle(row.global)
}

export function projectRowDescription(row: ProjectSettingRow) {
  return descriptorFor(row.global).description
}

const ON_OFF: readonly ProjectChoice[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
]

function onOffLabel(value: boolean) {
  return value ? 'On' : 'Off'
}

function onOffChoice(value: boolean | undefined) {
  if (value === undefined) return DEFAULT_CHOICE
  return value ? 'on' : 'off'
}

function booleanChoice(choice: string) {
  if (choice === DEFAULT_CHOICE) return null
  return choice === 'on'
}

function isStreamingMode(choice: string): choice is 'paragraph' | 'turn' | 'token' {
  return choice === 'paragraph' || choice === 'turn' || choice === 'token'
}

function daysLabel(days: number) {
  if (days === 0) return 'Off'
  return days === 1 ? '1 day' : `${days} days`
}

// A value set in settings.json outside the presets stays selectable.
function dayChoices(values: SettingsValues): readonly ProjectChoice[] {
  const set = Object.values(values['chat.projectAutoSettle']).map((entry) => entry.afterDays)
  const days = new Set<number>([...SETTLE_DAYS, ...set.filter((day) => day !== undefined)])
  return [...days]
    .toSorted((left, right) => left - right)
    .map((day) => ({ value: String(day), label: daysLabel(day) }))
}

type AutoSettleOverride = SettingsValues['chat.projectAutoSettle'][string]

function withAutoSettle(
  values: SettingsValues,
  projectId: string,
  change: Partial<Record<keyof AutoSettleOverride, number | boolean | undefined>>,
): ProjectOverrideWrite {
  const record = values['chat.projectAutoSettle']
  const next: AutoSettleOverride = { ...record[projectId] }
  if ('afterDays' in change) setOptional(next, 'afterDays', change.afterDays as number | undefined)
  if ('onMerge' in change) setOptional(next, 'onMerge', change.onMerge as boolean | undefined)
  const empty = next.afterDays === undefined && next.onMerge === undefined
  return { key: 'chat.projectAutoSettle', projectId, value: empty ? null : next }
}

function setOptional<Key extends keyof AutoSettleOverride>(
  target: AutoSettleOverride,
  key: Key,
  value: AutoSettleOverride[Key] | undefined,
) {
  if (value === undefined) {
    delete target[key]
    return
  }
  target[key] = value
}
