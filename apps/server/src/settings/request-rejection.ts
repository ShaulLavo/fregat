import {
  descriptorFor,
  isSettingId,
  SCALAR_SETTING_IDS,
  SETTINGS_OPERATION_KINDS,
  settingsOperationSchemasByKind,
  type SettingId,
} from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import type * as v from 'valibot'
import { safeParse } from 'valibot'
import { settingsErrors } from './structured-errors'

type Issue = v.BaseIssue<unknown>

const SCALAR_IDS = new Set<string>(SCALAR_SETTING_IDS)
const OPERATION_KINDS = new Set<string>(SETTINGS_OPERATION_KINDS)

/**
 * `settingsOperationSchema` is an untagged union with one branch per setting, so
 * valibot reports every operation failure as `Expected Object but received
 * Object` — identical for an unregistered key and for a value of the wrong type.
 * Re-check the named operation against its own schema to recover which it was.
 */
export function requestRejection(input: unknown, issues: readonly Issue[]) {
  const issue = issues[0]
  if (!issue) return settingsErrors.WRITE_INVALID({ key: 'request', reason: 'no issue reported' })

  const issuePath = pathOf(issue)
  const found = failedOperation(input, issue)
  if (!found) {
    return settingsErrors.WRITE_INVALID({
      key: issuePath || 'request',
      reason: describe(issues, issuePath),
    })
  }

  const { operation, path } = found
  const kind = typeof operation.kind === 'string' ? operation.kind : ''
  if (!OPERATION_KINDS.has(kind)) {
    return settingsErrors.WRITE_INVALID({
      key: path,
      reason: kind ? `unknown operation kind "${kind.slice(0, 60)}"` : 'operation has no `kind`',
    })
  }
  if (kind !== 'set') {
    const unregistered = unregisteredResetKey(kind, operation)
    if (unregistered) return settingsErrors.UNKNOWN_KEY({ key: unregistered })
    return settingsErrors.WRITE_INVALID({ key: path, reason: branchReason(kind, operation) })
  }
  if (typeof operation.key !== 'string') {
    return settingsErrors.WRITE_INVALID({ key: path, reason: 'a `set` operation needs a `key`' })
  }
  if (!isSettingId(operation.key)) return settingsErrors.UNKNOWN_KEY({ key: operation.key })
  if (!SCALAR_IDS.has(operation.key)) {
    return settingsErrors.WRITE_INVALID({
      key: operation.key,
      reason: 'this setting changes only through its own operation kind',
    })
  }

  return settingsErrors.WRITE_INVALID({
    key: operation.key,
    reason: valueReason(operation.key, operation.value),
  })
}

/** A `reset` naming a key this build does not register, which the union hides. */
function unregisteredResetKey(kind: string, operation: Record<string, unknown>) {
  if (kind !== 'reset' || !Array.isArray(operation.keys)) return undefined

  return operation.keys.find((key) => typeof key === 'string' && !isSettingId(key)) as
    | string
    | undefined
}

/** Re-check a non-`set` operation against only its own branch. */
function branchReason(kind: string, operation: Record<string, unknown>) {
  const schema = settingsOperationSchemasByKind[kind as keyof typeof settingsOperationSchemasByKind]
  const parsed = safeParse(schema, operation)
  return parsed.success ? `the \`${kind}\` operation is not valid here` : describe(parsed.issues)
}

function valueReason(key: SettingId, value: unknown) {
  const parsed = safeParse(descriptorFor(key).schema, value)
  if (!parsed.success) return `value: ${describe(parsed.issues)}`

  // The value itself is fine, so the operation failed on its shape — an extra
  // property, or a missing `kind`. `strictObject` names it.
  return 'the operation object does not match `{ kind: "set", key, value }`'
}

/** The operation an issue points at, when the issue path names one. */
function failedOperation(input: unknown, issue: Issue) {
  const path = issue.path
  if (!path || path.length < 2) return undefined
  if (String(path[0]?.key) !== 'operations') return undefined
  if (!isRecord(input) || !Array.isArray(input.operations)) return undefined

  const index = Number(path[1]?.key)
  const operation = input.operations[index]
  return isRecord(operation) ? { operation, path: `operations.${index}` } : undefined
}

/** Path-qualified issue text, minus any prefix the error's `key` already shows. */
function describe(issues: readonly Issue[], covered = '') {
  return issues
    .slice(0, 3)
    .map((issue) => {
      const shown = relativePath(pathOf(issue), covered)
      const message = expectation(issue)
      return shown ? `${shown}: ${message}` : message
    })
    .join('; ')
}

/**
 * Settings values never reach a log or an error message — the store holds
 * tokens, paths and machine names. `issue.message` embeds the rejected value
 * after ` but received `, so keep only the schema half and name the type that
 * arrived instead. `apps/server/src/observability/tests/runtime.test.ts` pins this.
 */
function expectation(issue: Issue) {
  const [head] = issue.message.split(' but received ')
  return `${clamp(head ?? issue.message)}, received ${typeName(issue.input)}`
}

function typeName(input: unknown) {
  if (input === null) return 'null'
  if (Array.isArray(input)) return 'array'
  return typeof input
}

// A picklist over every setting id renders its whole option list, which is a
// 1.6KB toast. Keep the head, which carries the kind of mismatch.
function clamp(message: string) {
  return message.length > 160 ? `${message.slice(0, 159)}…` : message
}

function relativePath(path: string, covered: string) {
  if (!covered || path === covered) return path === covered ? '' : path
  return path.startsWith(`${covered}.`) ? path.slice(covered.length + 1) : path
}

function pathOf(issue: Issue) {
  return issue.path?.map((item) => String(item.key)).join('.') ?? ''
}
