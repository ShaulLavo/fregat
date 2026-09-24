import { render, screen } from '@testing-library/react'

import { FileLabel } from '@/components/file-label'
import { expect, test } from '../../../test/fixtures'

test('the basename comes first so a right cut eats the directory', () => {
  const { container } = render(<FileLabel path={`${'nested/'.repeat(30)}needle-file.ts`} />)

  const text = container.querySelector('.truncate')
  expect(text?.firstElementChild).toHaveTextContent(/^needle-file\.ts$/)
  expect(text?.lastElementChild).toHaveTextContent(/^nested\/.*nested$/)
  expect(text?.lastElementChild).toHaveClass('text-muted-foreground')
})

test('a root-level file shows no directory', () => {
  const { container } = render(<FileLabel path='README.md' />)

  expect(container.querySelector('.truncate')?.children).toHaveLength(1)
})

test('keeps a unicode name whole', () => {
  render(<FileLabel path='docs/café-日本語.md' />)

  expect(screen.getByText('café-日本語.md')).toBeInTheDocument()
  expect(screen.getByText('docs')).toBeInTheDocument()
})

test('name and directory slots replace the derived text', () => {
  render(<FileLabel directory={<mark>src</mark>} name={<mark>a.ts</mark>} path='src/a.ts' />)

  expect(screen.getByText('a.ts').tagName).toBe('MARK')
  expect(screen.getByText('src').tagName).toBe('MARK')
})
