import { renderHook } from '@testing-library/react'
import { useLayoutEffect, type ReactNode } from 'react'
import { vi } from 'vitest'

import { useMountedEditorRegistry } from '@/features/editor/hooks/use-mounted-editor-registry'
import { MountedEditorProvider } from '@/features/editor/providers/mounted-editor-provider'
import { MountedEditorRegistry } from '@/features/editor/state/mounted-editor-registry'

import { expect, test } from '../../../../test/fixtures'

const EDITOR_PATH = '/repo/a.ts'

test('keeps the mounted editor registered through a StrictMode effect replay', async () => {
  const registry = new MountedEditorRegistry()
  const listener = vi.fn()
  registry.subscribe(listener)
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <MountedEditorProvider registry={registry}>{children}</MountedEditorProvider>
  )

  const hook = renderHook(
    () => {
      const mountedEditors = useMountedEditorRegistry()
      useLayoutEffect(() => mountedEditors.register(EDITOR_PATH), [mountedEditors])
      return mountedEditors
    },
    { reactStrictMode: true, wrapper },
  )
  await Promise.resolve()

  expect(hook.result.current).toBe(registry)
  expect(listener.mock.calls).toEqual([[EDITOR_PATH, true]])

  hook.unmount()
  await Promise.resolve()

  expect(listener.mock.calls).toEqual([
    [EDITOR_PATH, true],
    [EDITOR_PATH, false],
  ])
})
