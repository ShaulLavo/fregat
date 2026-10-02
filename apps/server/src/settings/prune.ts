import { isSettingId } from '@workspace/contracts'
import { statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { parseTree } from 'jsonc-parser'
import { writeFileAtomicSync } from '../fs/atomic-write'
import { textFileVersion } from '../fs/version'
import {
  discardStagedSettingsFile,
  editSettingsText,
  parseSettingsDocument,
  readSettingsFileSync,
  stageSettingsFile,
  tryCommitStagedSettingsFile,
  type SettingsFileContents,
} from './json-document'
import { settingsWriteContendedError } from './structured-errors'

export type SettingsPruneResult = {
  readonly contents: { readonly text: string; readonly revision: string }
  readonly keys: readonly string[]
}

export function pruneSettingsText(
  text: string,
): { readonly text: string; readonly keys: readonly string[] } | null {
  if (parseSettingsDocument(text).parseErrors.length > 0) return null

  const root = parseTree(text, [], { allowTrailingComma: true, allowEmptyContent: true })
  const unknownKeys = (root?.children ?? [])
    .map((property) => property.children?.[0]?.value as unknown)
    .filter((key): key is string => typeof key === 'string' && !isSettingId(key))
  if (unknownKeys.length === 0) return null

  // One removal per property: JSONC permits duplicate spellings of the same key.
  return {
    text: editSettingsText(
      text,
      unknownKeys.map((key) => ({ key })),
    ),
    keys: [...new Set(unknownKeys)],
  }
}

/** The caller holds the canonical path's write coordinator throughout this operation. */
export function pruneSettingsFileSync(
  destination: string,
  current: SettingsFileContents,
  eligible: () => boolean,
): SettingsPruneResult | null {
  if (current.revision === null || !eligible()) return null
  const pruned = pruneSettingsText(current.text)
  if (!pruned) return null

  const mode = statSync(destination).mode & 0o777
  writeFileAtomicSync(destination, pruned.text, {
    durability: 'fsync-all',
    mode,
    beforeCommit: () => {
      if (!eligible() || readSettingsFileSync(destination).revision !== current.revision) {
        throw settingsWriteContendedError(1, 0)
      }
    },
  })
  return {
    contents: { text: pruned.text, revision: textFileVersion(pruned.text) },
    keys: pruned.keys,
  }
}

/** A failed revision check leaves the new external bytes untouched for the next reload. */
export async function pruneSettingsFile(
  destination: string,
  current: SettingsFileContents,
  coordinatorWaitMs: number,
  eligible: () => boolean,
): Promise<SettingsPruneResult | null> {
  if (current.revision === null || !eligible()) return null
  const pruned = pruneSettingsText(current.text)
  if (!pruned) return null

  const mode = (await stat(destination)).mode & 0o777
  const staged = await stageSettingsFile(destination, pruned.text, mode)
  try {
    if (!eligible()) return null
    const outcome = await tryCommitStagedSettingsFile(staged, current.revision, () => {
      if (!eligible()) throw settingsWriteContendedError(1, coordinatorWaitMs)
    })
    if (outcome.kind === 'revision-mismatch') {
      throw settingsWriteContendedError(1, coordinatorWaitMs)
    }
    return {
      contents: { text: pruned.text, revision: outcome.revision },
      keys: pruned.keys,
    }
  } finally {
    await discardStagedSettingsFile(staged)
  }
}
