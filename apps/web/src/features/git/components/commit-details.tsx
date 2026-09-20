import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { CaretDownIcon, CopyIcon, XIcon } from '@phosphor-icons/react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import { cn } from '@workspace/ui/lib/utils'
import { useNavigation } from '@/hooks/use-navigation'
import { useRef, useLayoutEffect, useState } from 'react'
import { useHistoryView } from '@/features/git/hooks/use-history-view'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import type { GitCommitFile } from '@workspace/contracts'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { ToolbarButton } from '@/components/toolbar-button'
import { useCommitDetails } from '@/features/git/hooks/use-commit-details'
import { FileRow } from '@/features/git/components/file-row'
import { gitStatusSymbol } from '@/features/git/utils/status-symbols'
import { copyTextToClipboard } from '@/lib/clipboard'
import { errorMessage } from '@/lib/file-server'
import { historyMessageBody } from '@/features/git/utils/history-presentation'

export function CommitDetails({
  rootPath,
  commit,
  onClose,
  onOpen,
}: {
  rootPath: string
  commit: string
  onClose: () => void
  onOpen: (file: GitCommitFile) => void
}) {
  const details = useCommitDetails(rootPath, commit)
  const navigation = useNavigation()
  const panels = useEditorWorkspaceState((state) => state.workbenchPanels)
  const open = panels.gitCommitDetailsOpen
  const { view, updateView } = useHistoryView()
  const scrollRef = useRef<HTMLDivElement>(null)
  const initialScrollTop = useRef(view.detailsScrollTop)
  const [activePath, setActivePath] = useState<string | null>(null)
  const fileList = useListbox({
    role: 'tree',
    items: (details.data?.files ?? []).map((file) => ({
      id: file.path,
      disabled: file.kind === 'submodule',
    })),
    activeId: activePath,
    onActiveChange: setActivePath,
    onSelect: setActivePath,
    onCommit: (path) => {
      const file = details.data?.files.find((file) => file.path === path)
      if (file) onOpen(file)
    },
  })
  const loadedCommit = details.data?.id
  useLayoutEffect(() => {
    if (loadedCommit && scrollRef.current) scrollRef.current.scrollTop = initialScrollTop.current
  }, [loadedCommit])
  return (
    <Collapsible
      render={<section aria-label='Commit details' />}
      className='flex h-full min-h-0 flex-col'
      open={open}
      onOpenChange={(gitCommitDetailsOpen) => {
        void navigation.setWorkbenchPanels({ ...panels, gitCommitDetailsOpen })
      }}
    >
      <PaneBar>
        <CollapsibleTrigger
          aria-label='Commit information'
          className='focus-ring flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-xs outline-none'
          title={commit}
        >
          <CaretDownIcon
            className={cn(
              'size-(--icon-size-sm) shrink-0 transition-transform',
              !open && '-rotate-90',
            )}
          />
          {commit.slice(0, 10)}
        </CollapsibleTrigger>
        <ToolbarButton
          label='Copy commit hash'
          onClick={() => {
            void copyTextToClipboard(commit, 'commit hash')
          }}
        >
          <CopyIcon />
        </ToolbarButton>
        <ToolbarButton label='Close commit details' onClick={onClose}>
          <XIcon />
        </ToolbarButton>
      </PaneBar>
      {details.isPending ? (
        <LoadingState label='Loading commit details' className='p-3'>
          <div className='skeleton-sweep h-3 w-3/4 rounded-md' />
        </LoadingState>
      ) : null}
      {details.isError ? (
        <div className='p-3'>
          <EmptyState
            tone='error'
            title='Could not load commit'
            description={errorMessage(details.error)}
          />
          <Button
            size='sm'
            variant='outline'
            onClick={() => {
              void details.refetch()
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {details.data ? (
        <div
          ref={scrollRef}
          className='app-scrollbar-thin min-h-0 flex-1 overflow-auto'
          onScrollEnd={(event) => {
            void updateView({ detailsScrollTop: event.currentTarget.scrollTop })
          }}
        >
          <CollapsibleContent className='space-y-2 p-3'>
            <p className='text-sm font-semibold wrap-anywhere'>{details.data.subject}</p>
            <p className='text-muted-foreground text-xs wrap-anywhere'>
              {details.data.author}{' '}
              <span title={details.data.authorEmail}>&lt;{details.data.authorEmail}&gt;</span>
            </p>
            <p className='text-muted-foreground text-2xs tabular-nums'>
              {new Date(details.data.timestamp).toLocaleString()}
            </p>
            {details.data.message !== details.data.subject ? (
              <p className='text-xs wrap-anywhere whitespace-pre-wrap'>
                {historyMessageBody(details.data.message, details.data.subject)}
              </p>
            ) : null}
            <div className='text-2xs text-muted-foreground flex flex-wrap gap-1'>
              <span>
                {details.data.parents.length > 1 ? 'Merge · compared with first parent' : 'Parent'}
              </span>
              {details.data.parents.length === 0 ? <span>None · initial commit</span> : null}
              {details.data.parents.map((parent) => (
                <span key={parent} title={parent} className='font-mono'>
                  {parent.slice(0, 7)}
                </span>
              ))}
            </div>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                void copyTextToClipboard(details.data.message, 'commit message')
              }}
            >
              Copy message
            </Button>
          </CollapsibleContent>
          <PaneBar>
            <span className='text-xs font-medium'>Changed files</span>
            <span className='text-muted-foreground text-2xs tabular-nums'>
              {details.data.files.length}
            </span>
          </PaneBar>
          <div {...fileList.containerProps} aria-label='Commit files'>
            {details.data.files.map((file) => (
              <FileRow
                key={file.path}
                rowProps={fileList.rowProps(file.path)}
                path={file.path}
                oldPath={file.oldPath}
                rootPath={rootPath}
                status={gitStatusSymbol(file.status, 'historical')}
                historical
                disabledReason={
                  file.kind === 'submodule' ? 'Submodule reference changed' : undefined
                }
                onOpen={() => onOpen(file)}
              />
            ))}
          </div>
          {details.data.files.length === 0 ? (
            <EmptyState title='No file changes' className='p-3' />
          ) : null}
        </div>
      ) : null}
    </Collapsible>
  )
}
