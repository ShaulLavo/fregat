import { testTabContent } from '../../../../../test/factories/document-targets'
import { tabId } from '@/lib/documents/utils/identity'
import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'

import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { EditorTabActionsContext } from '@/features/editor/providers/tab-actions-context'
import type { RequestCloseTab, RequestCloseTabs } from '@/features/editor/hooks/use-dirty-tab-close'
import { EditorTabBar } from '@/features/workbench/components/editor-tab-bar'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('removes closed tabs from the DOM on the next render', () => {
  const { container, rerender } = renderWithProviders(<TestEditorTabs tabs={editorTabs()} />)

  expect(editorTabElement(container, 'tab-a')).toBeInTheDocument()

  rerender(<TestEditorTabs tabs={editorTabs().filter((tab) => tab.id !== 'tab-a')} />)

  expect(editorTabElement(container, 'tab-a')).toBeNull()
  expect(editorTabElement(container, 'tab-b')).toBeInTheDocument()
})

test('hides the horizontal tab strip scrollbar', () => {
  renderWithProviders(<TestEditorTabs tabs={editorTabs()} />)

  expect(screen.getByRole('tablist', { name: 'Editor tabs' })).toHaveClass('no-scrollbar')
})

test('only the active tab carries a background fill, and inactive tabs react to hover', () => {
  const { container } = renderWithProviders(<TestEditorTabs tabs={editorTabs()} />)

  // The active tab lifts to the well colour so it reads as part of the editor.
  expect(editorTabElement(container, 'tab-a')).toHaveClass('bg-content-well')
  expect(editorTabElement(container, 'tab-a')).not.toHaveClass('hover:bg-accent')
  expect(editorTabElement(container, 'tab-b')).not.toHaveClass('bg-content-well')
  expect(editorTabElement(container, 'tab-b')).toHaveClass('hover:bg-accent')
})

test('shimmers the filename of the editor input being resolved', () => {
  const { container } = renderWithProviders(
    <TestEditorTabs loadingTabId='tab-a' tabs={editorTabs()} />,
  )

  const loadingTab = editorTabElement(container, 'tab-a')
  expect(loadingTab).toHaveAttribute('aria-busy', 'true')
  expect(loadingTab?.querySelector('[data-slot="shimmer"]')).toHaveTextContent('a.ts')
  expect(editorTabElement(container, 'tab-b')?.querySelector('[data-slot="shimmer"]')).toBeNull()
})

test('closes the clicked tab id', () => {
  const closeTab = vi.fn()

  renderWithProviders(<TestEditorTabs tabs={editorTabs()} onCloseTab={closeTab} />)

  fireEvent.click(screen.getByLabelText('Close src/a.ts'))

  expect(closeTab).toHaveBeenCalledWith('tab-a')
})

test('selects the clicked tab id', () => {
  const selectTab = vi.fn()

  const { container } = renderWithProviders(
    <TestEditorTabs tabs={editorTabs()} onSelectTab={selectTab} />,
  )

  fireEvent.click(editorTabElement(container, 'tab-b')!)

  expect(selectTab).toHaveBeenCalledWith('tab-b')
})

test('requests bulk close ids from the tab context menu', () => {
  const closeTabs = vi.fn()

  const { container } = renderWithProviders(
    <TestEditorTabs tabs={editorTabs()} onCloseTabs={closeTabs} />,
  )

  fireEvent.contextMenu(editorTabElement(container, 'tab-b')!)
  fireEvent.click(screen.getByText('Close Others'))

  expect(closeTabs).toHaveBeenCalledWith(['tab-a', 'tab-c'])
})

function TestEditorTabs({
  loadingTabId,
  tabs,
  onCloseTab = (tabId) => ({
    status: 'closed',
    completion: Promise.resolve({ status: 'applied' as const }),
    tabIds: [tabId],
  }),
  onCloseTabs = (tabIds) => ({
    status: 'closed',
    tabIds,
    completion: Promise.resolve({ status: 'applied' as const }),
  }),
  onSelectTab = () => undefined,
}: {
  readonly loadingTabId?: string | null
  readonly tabs: readonly EditorTabModel[]
  readonly onCloseTab?: RequestCloseTab
  readonly onCloseTabs?: RequestCloseTabs
  readonly onSelectTab?: (tabId: string) => void
}) {
  return (
    <EditorStateProvider>
      <EditorTabActionsContext
        value={{
          requestCloseTab: onCloseTab,
          requestCloseTabs: onCloseTabs,
          reorderTab: async () => ({ status: 'superseded' }),
          selectTab: onSelectTab,
        }}
      >
        <EditorTabBar loadingTabId={loadingTabId ? tabId(loadingTabId) : null} tabs={tabs} />
      </EditorTabActionsContext>
    </EditorStateProvider>
  )
}

function editorTabElement(container: HTMLElement, tabId: string) {
  return container.querySelector(`[data-editor-tab-id="${tabId}"]`)
}

function editorTabs(): EditorTabModel[] {
  return [
    editorTab({ active: true, id: 'tab-a', name: 'a.ts', path: 'src/a.ts' }),
    editorTab({ active: false, id: 'tab-b', name: 'b.ts', path: 'src/b.ts' }),
    editorTab({ active: false, id: 'tab-c', name: 'c.ts', path: 'src/c.ts' }),
  ]
}

function editorTab({
  active,
  id,
  name,
  path,
}: {
  active: boolean
  id: string
  name: string
  path: string
}): EditorTabModel {
  return {
    active,
    copyPath: path,
    copyRelativePath: path,
    diffSource: null,
    diffStatus: null,
    diffSuffix: '',
    icon: { name: 'typescript', src: '' },
    id: tabId(id),
    name,
    content: testTabContent(path),
    title: path,
  }
}
