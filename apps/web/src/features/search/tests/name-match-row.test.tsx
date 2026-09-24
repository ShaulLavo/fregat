import { render, screen } from '@testing-library/react'

import { SearchNameMatchRow } from '@/features/search/components/name-match-row'
import type { WorkspaceSearchFileGroup } from '@/features/search/state/buffer-state'
import { expect, test } from '../../../../test/fixtures'

function group(pathLabel: string): WorkspaceSearchFileGroup {
  return {
    collapsed: false,
    count: 0,
    matches: [],
    name: pathLabel.split('/').at(-1)!,
    path: `/repo/${pathLabel}`,
    pathLabel,
  }
}

test('a match deep in the directory still shows the basename first', () => {
  const pathLabel = `needle/${'nested/'.repeat(20)}file.ts`
  render(<SearchNameMatchRow group={group(pathLabel)} query='needle' onOpen={() => {}} />)

  const row = screen.getByRole('treeitem')
  expect(row.textContent?.startsWith('file.ts')).toBe(true)
  expect(screen.getByText('needle').tagName).toBe('MARK')
  expect(row).toHaveAttribute('title', `/repo/${pathLabel}`)
})

test('a basename match is marked in the name', () => {
  render(
    <SearchNameMatchRow group={group('src/needle-file.ts')} query='needle' onOpen={() => {}} />,
  )

  const mark = screen.getByText('needle')
  expect(mark.tagName).toBe('MARK')
  expect(mark.parentElement?.textContent).toBe('needle-file.ts')
})
