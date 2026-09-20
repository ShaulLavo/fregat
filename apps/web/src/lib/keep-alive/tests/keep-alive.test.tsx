import { render, screen } from '@testing-library/react'
import { useEffect } from 'react'

import { KeepAliveSlot } from '@/lib/keep-alive/components/keep-alive-slot'
import { useKeptIds } from '@/lib/keep-alive/hooks/use-kept-ids'
import { KeepAliveProvider } from '@/lib/keep-alive/providers/keep-alive-provider'
import { expect, test } from '../../../../test/fixtures'

const lifecycle = { mounts: 0, unmounts: 0 }

function Shell({ attached }: { readonly attached: boolean }) {
  useEffect(() => {
    lifecycle.mounts += 1
    return () => {
      lifecycle.unmounts += 1
    }
  }, [])

  return <output data-testid='shell'>{attached ? 'attached' : 'parked'}</output>
}

function Surface({ name }: { readonly name: string }) {
  return (
    <section aria-label={name}>
      <KeepAliveSlot id='shell-1' scope='shells'>
        {(attached) => <Shell attached={attached} />}
      </KeepAliveSlot>
    </section>
  )
}

function Owner({ ids }: { readonly ids: readonly string[] }) {
  useKeptIds('shells', ids)
  return null
}

type View = 'first' | 'second' | 'none'

function Harness({ ids, view }: { readonly ids: readonly string[]; readonly view: View }) {
  return (
    <KeepAliveProvider>
      <Owner ids={ids} />
      {view === 'first' ? <Surface name='first' /> : null}
      {view === 'second' ? <Surface name='second' /> : null}
    </KeepAliveProvider>
  )
}

test('kept content mounts once, follows its slot, stands down while parked, and ends only by prune', () => {
  lifecycle.mounts = 0
  lifecycle.unmounts = 0
  const view = render(<Harness ids={['shell-1']} view='first' />)
  const show = (next: View, ids: readonly string[] = ['shell-1']) =>
    view.rerender(<Harness ids={ids} view={next} />)
  const shell = screen.getByTestId('shell')
  expect(screen.getByLabelText('first').contains(shell)).toBe(true)
  expect(shell.textContent).toBe('attached')

  show('second')
  expect(screen.getByTestId('shell')).toBe(shell)
  expect(screen.getByLabelText('second').contains(shell)).toBe(true)
  expect(shell.textContent).toBe('attached')

  show('none')
  expect(screen.getByTestId('shell')).toBe(shell)
  expect(shell.textContent).toBe('parked')
  expect(shell.closest('[hidden]')).not.toBeNull()

  show('first')
  expect(screen.getByLabelText('first').contains(shell)).toBe(true)
  expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 })

  show('none')
  show('none', [])
  expect(screen.queryByTestId('shell')).toBeNull()
  expect(lifecycle).toEqual({ mounts: 1, unmounts: 1 })
  view.unmount()
})
