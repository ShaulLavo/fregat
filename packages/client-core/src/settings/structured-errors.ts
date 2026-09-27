import * as v from 'valibot'
import { createClientError } from '../errors'

export const SETTINGS_SNAPSHOT_UNREADABLE = 'client.SETTINGS_SNAPSHOT_UNREADABLE'

export function settingsInvariantError(message: string) {
  return createClientError({
    code: 'client.SETTINGS_INVARIANT',
    status: 500,
    message,
    why: 'The settings owner could not establish confirmed state.',
    fix: 'Reconnect and reload the confirmed settings document.',
  })
}

/** A settings document or event this build's schema rejects: the server runs another version. */
export function settingsSnapshotUnreadableError(issues: readonly v.BaseIssue<unknown>[]) {
  return createClientError({
    code: SETTINGS_SNAPSHOT_UNREADABLE,
    status: 422,
    message: 'This tab cannot read the settings the server sent',
    why: 'The server runs a different version of the app than this tab, which happens when the server updates while the tab stays open.',
    fix: 'Reload the tab to load the version the server runs.',
    // Paths and expected types only: an issue's `input` is a setting value.
    internal: {
      issueCount: issues.length,
      issues: issues.slice(0, 5).map((issue) => ({
        path: v.getDotPath(issue),
        expected: issue.expected,
      })),
    },
  })
}
