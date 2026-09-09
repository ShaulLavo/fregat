import { workspaceAddressIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { expect, test, vi } from 'vitest'
import { FsMetadataStore } from '../metadata'

test('retries an ID collision without changing the folder already using that ID', () => {
  const first = v.parse(workspaceAddressIdSchema, 'aB3_cD4-eF5_gH6-')
  const second = v.parse(workspaceAddressIdSchema, 'N7p_Q8r-S9t_U0v-')
  const createWorkspaceAddressId = vi
    .fn<() => typeof first>()
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(second)
  const metadata = new FsMetadataStore({ databasePath: ':memory:', createWorkspaceAddressId })

  try {
    expect(metadata.registerWorkspaceAddress('/', '/one')).toBe(first)
    expect(metadata.registerWorkspaceAddress('/', '/two')).toBe(second)
    expect(metadata.findWorkspaceAddress('/', first)?.canonicalPath).toBe('/one')
    expect(metadata.findWorkspaceAddress('/', second)?.canonicalPath).toBe('/two')
    expect(createWorkspaceAddressId).toHaveBeenCalledTimes(3)
  } finally {
    metadata.close()
  }
})

test('reuses a registered directory ID without generating another candidate', () => {
  const id = v.parse(workspaceAddressIdSchema, 'aB3_cD4-eF5_gH6-')
  const createWorkspaceAddressId = vi.fn(() => id)
  const metadata = new FsMetadataStore({ databasePath: ':memory:', createWorkspaceAddressId })

  try {
    expect(metadata.registerWorkspaceAddress('/', '/one')).toBe(id)
    expect(metadata.registerWorkspaceAddress('/', '/one')).toBe(id)
    expect(createWorkspaceAddressId).toHaveBeenCalledOnce()
  } finally {
    metadata.close()
  }
})
