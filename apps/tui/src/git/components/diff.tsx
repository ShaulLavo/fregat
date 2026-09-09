import { useEffect, useState } from 'react'
import {
  createDiffRegionStore,
  createSplitProjection,
  createStackedProjection,
  type DiffFile,
} from '@singapor/diff'
import type { SettingsOwner } from '@workspace/client-core/settings/owner'
import { useSettingValue } from '@/settings/hooks/use-setting-value'
import { toggleDiffPreference } from '@/git/state/diff'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { diffRowColor, diffRowText } from '@/git/utils/rows'
import type { Theme } from '@/theme/utils/theme'

export function DiffView({
  file,
  theme,
  enabled,
  owner,
}: {
  owner: SettingsOwner | null
  file: DiffFile
  theme: Theme
  enabled: boolean
}) {
  const focused = usePaneFocus({ id: 'workbench-diff', area: 'git', enabled })
  const [width, setWidth] = useState(0)
  const mode = useSettingValue(owner, 'editor.diff.viewMode')
  const [regions] = useState(() => createDiffRegionStore())
  const [, setRevision] = useState(0)
  const [selection, setSelection] = useState<{ file: DiffFile; index: number } | null>(null)
  const selected = selection?.file === file ? selection.index : 0
  useEffect(() => {
    regions.setFile(file)
  }, [file, regions])
  useEffect(() => {
    const subscription = regions.onDidChange(() => setRevision((value) => value + 1))
    return () => subscription.dispose()
  }, [regions])
  const split = width >= 120 && mode === 'split'
  const projection = split
    ? createSplitProjection(file, { expandedRegions: regions.getExpandedRegions() })
    : null
  const rows =
    projection?.leftRows ??
    createStackedProjection(file, { expandedRegions: regions.getExpandedRegions() }).rows
  function expand() {
    const row = rows[selected]?.expandKey ? rows[selected] : rows.find((item) => item.expandable)
    if (row?.expandKey) regions.toggleRegion(row.expandKey)
  }
  useCommandHandlers(
    {
      'git.toggleDiff': {
        disabledReason: () => (owner ? null : 'Reconnect before changing the diff layout.'),
        run: () => (owner ? toggleDiffPreference(owner) : false),
      },
      'git.expandDiff': { run: expand },
    },
    enabled,
  )
  return (
    <box
      flexDirection='column'
      flexGrow={1}
      minHeight={0}
      onSizeChange={function () {
        setWidth(this.width)
      }}
    >
      <text fg={theme.mutedForeground} height={1}>
        {file.path} · {split ? 'split' : 'stacked'} · click a context row to expand
      </text>
      <scrollbox id='workbench-diff' focused={focused} flexGrow={1} minHeight={0}>
        {rows.map((row, index) => (
          <box
            key={index}
            flexDirection='row'
            height={1}
            onMouseDown={() => {
              setSelection({ file, index })
              if (row.expandKey) regions.toggleRegion(row.expandKey)
            }}
          >
            <text
              flexGrow={1}
              flexBasis={0}
              minWidth={0}
              wrapMode='none'
              fg={diffRowColor(row, theme)}
            >
              {diffRowText(row, split ? 'old' : 'stacked')}
            </text>
            {projection && (
              <text width={1} fg={theme.border}>
                │
              </text>
            )}
            {projection?.rightRows[index] && (
              <text
                flexGrow={1}
                flexBasis={0}
                minWidth={0}
                wrapMode='none'
                fg={diffRowColor(projection.rightRows[index], theme)}
              >
                {diffRowText(projection.rightRows[index], 'new')}
              </text>
            )}
          </box>
        ))}
      </scrollbox>
    </box>
  )
}
