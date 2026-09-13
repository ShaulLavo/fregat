import { useState, type KeyboardEvent } from 'react'

import { Breadcrumb, BreadcrumbList } from '@workspace/ui/components/breadcrumb'

import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { BreadcrumbFolderPicker } from '@/features/workbench/components/breadcrumb-folder-picker'
import { BreadcrumbItem } from '@/features/workbench/components/breadcrumb-item'
import { BreadcrumbSymbolPicker } from '@/features/workbench/components/breadcrumb-symbol-picker'
import { SymbolKindIcon } from '@/features/workbench/components/symbol-kind-icon'
import { useDocumentSymbolTree } from '@/features/workbench/hooks/use-document-symbol-tree'
import {
  breadcrumbPathItems,
  symbolChainAtCursor,
  symbolRowKey,
  type EditorCursor,
} from '@/features/workbench/utils/breadcrumbs'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { fileUriForPath, type DocumentSymbol } from '@/lib/document-symbols'
import { fileIconStyle } from '@/lib/file-icon-style'
import { iconForEntry } from '@/lib/file-icons'

export function BreadcrumbsBar({
  cursor,
  filePath,
  rootPath,
  onFocusEditor,
}: {
  readonly cursor: EditorCursor | null
  readonly filePath: FilesystemPath
  readonly rootPath: FilesystemPath
  readonly onFocusEditor?: () => void
}) {
  const { openDefinition, openFileSurface } = useEditorCommands()
  const symbols = useDocumentSymbolTree(rootPath, filePath)
  const pathItems = breadcrumbPathItems(rootPath, filePath)
  const symbolChain = symbolChainAtCursor(symbols, cursor)
  const [openKey, setOpenKey] = useState<string | null>(null)

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

    const crumbs = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[data-breadcrumb-item]'),
    )
    const index = crumbs.indexOf(document.activeElement as HTMLElement)
    const next = crumbs[index + (event.key === 'ArrowRight' ? 1 : -1)]
    if (!next) return

    event.preventDefault()
    next.focus()
  }

  function openFile(path: string) {
    setOpenKey(null)
    void openFileSurface(filesystemPath(path))
  }

  function revealSymbol(symbol: DocumentSymbol) {
    setOpenKey(null)
    void openDefinition({
      path: filePath,
      range: symbol.selectionRange,
      uri: fileUriForPath(filePath),
    }).then(() => onFocusEditor?.())
  }

  return (
    <Breadcrumb
      aria-label='Breadcrumbs'
      className='no-scrollbar flex h-(--density-row-height) shrink-0 items-center overflow-x-auto px-(--density-row-padding-x) select-none'
      onKeyDown={handleKeyDown}
    >
      <BreadcrumbList className='text-2xs flex-nowrap gap-0.5 whitespace-nowrap'>
        {pathItems.map((item, index) => {
          const icon = iconForEntry({
            name: item.name,
            type: item.kind === 'file' ? 'file' : 'directory',
          })
          return (
            <BreadcrumbItem
              first={index === 0}
              icon={
                <span
                  aria-hidden='true'
                  className='size-3.5 shrink-0'
                  style={fileIconStyle(icon)}
                />
              }
              key={item.path}
              label={item.name}
              open={openKey === item.path}
              onOpenChange={(open) => setOpenKey(open ? item.path : null)}
            >
              <BreadcrumbFolderPicker
                directoryPath={item.parentPath}
                rootPath={rootPath}
                selectedPath={item.path}
                onOpenFile={openFile}
              />
            </BreadcrumbItem>
          )
        })}
        {symbolChain.map((symbol, index) => {
          const key = `symbol:${symbolRowKey(symbol)}`
          return (
            <BreadcrumbItem
              first={false}
              icon={<SymbolKindIcon className='size-3.5 shrink-0' kind={symbol.kind} />}
              key={key}
              label={symbol.name}
              open={openKey === key}
              onOpenChange={(open) => setOpenKey(open ? key : null)}
            >
              <BreadcrumbSymbolPicker
                chain={symbolChain.slice(0, index + 1)}
                symbols={symbols}
                onPick={revealSymbol}
              />
            </BreadcrumbItem>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
