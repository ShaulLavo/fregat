import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { Select } from '@/components/select'
import { EmptyState } from '@/components/empty-state'
import { LoadingState } from '@/components/loading-state'
import type { Theme } from '@/theme/utils/theme'
import type { ViewerDiagnostics } from '@/viewer/utils/lsp'

export function ProblemsPane({
  diagnostics,
  theme,
  enabled,
  onOpenFile,
}: {
  readonly diagnostics: ViewerDiagnostics
  readonly theme: Theme
  readonly enabled: boolean
  readonly onOpenFile: (path: string, line?: number) => void
}) {
  const focused = usePaneFocus({ id: 'workbench-problems', area: 'problems', enabled })
  if (diagnostics.status === 'loading')
    return (
      <scrollbox id='workbench-problems' focused={focused} flexGrow={1}>
        <LoadingState label='Loading diagnostics' theme={theme} />
      </scrollbox>
    )
  if (diagnostics.status !== 'ready')
    return (
      <scrollbox id='workbench-problems' focused={focused} flexGrow={1}>
        <EmptyState
          title='Diagnostics unavailable'
          description={diagnostics.message ?? 'Open a file to see diagnostics.'}
          theme={theme}
        />
      </scrollbox>
    )
  if (!diagnostics.items.length)
    return (
      <scrollbox id='workbench-problems' focused={focused} flexGrow={1}>
        <EmptyState title='No problems in this file' description={diagnostics.path} theme={theme} />
      </scrollbox>
    )
  return (
    <Select
      id='workbench-problems'
      focused={focused}
      flexGrow={1}
      options={diagnostics.items.map((item, index) => ({
        name: `${item.severity === 1 ? 'Error' : 'Warning'} ${item.range.start.line + 1}:${item.range.start.character + 1} ${item.message.replaceAll('\n', ' ')}`,
        description: item.source ?? '',
        value: index,
      }))}
      textColor={theme.foreground}
      selectedTextColor={theme.foreground}
      selectedBackgroundColor={theme.accent}
      onSelect={(_index, option) => {
        const item = diagnostics.items[Number(option?.value)]
        if (item) onOpenFile(diagnostics.path, item.range.start.line + 1)
      }}
    />
  )
}
