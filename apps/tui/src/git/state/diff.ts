import type { SettingsOwner } from '@workspace/client-core/settings/owner'
import { deriveWriteTarget } from '@workspace/contracts'
import { createTuiError } from '@/host/utils/structured-errors'
import type { Client } from '@workspace/client-core/transport/client'
import { requireEdenData } from '@workspace/client-core/transport/eden'
import { editorDiffFiles } from '@workspace/client-core/git/diff-files'

export async function readDiffFiles(
  client: Client,
  path: string,
  staged: boolean,
  signal: AbortSignal,
) {
  const snapshots = requireEdenData(
    await client.git.diff.get({ query: { path, staged }, fetch: { signal } }),
  )
  const files = await Promise.all(
    snapshots.map(async (snapshot) => {
      if (!snapshot.oldObjectId && !snapshot.newObjectId) return [snapshot]
      const blobs = requireEdenData(
        await client.git.diff.blob.get({
          query: {
            path: snapshot.path,
            oldPath: snapshot.oldPath,
            oldObjectId: snapshot.oldObjectId,
            newObjectId: snapshot.newObjectId,
          },
          fetch: { signal },
        }),
      )
      // The blob route re-roots patch paths; the requested snapshot owns file identity.
      return blobs.map((blob) => ({
        ...blob,
        path: snapshot.path,
        oldPath: snapshot.oldPath,
        staged,
      }))
    }),
  )
  return editorDiffFiles(files.flat())
}

export async function toggleDiffPreference(owner: SettingsOwner) {
  const projection = owner.getSnapshot().projection
  const value = owner.readSettingsMirror()['editor.diff.viewMode'] === 'split' ? 'stacked' : 'split'
  const target = deriveWriteTarget('editor.diff.viewMode', projection.layers)
  const submission = owner.submit(
    target,
    [{ kind: 'set', key: 'editor.diff.viewMode', value }],
    'tui.diff-layout',
  )
  if (submission.kind === 'noop') return false
  const outcome = await submission.settled
  if (outcome === 'acknowledged') return true
  if (outcome === 'discarded') return false
  throw createTuiError(
    'Could not save the diff layout.',
    'Retry or discard the failed change in Settings.',
  )
}
