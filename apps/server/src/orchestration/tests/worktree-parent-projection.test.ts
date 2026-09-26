import { expect, test } from 'vitest'
import { domainEvent, DOMAIN_AT, DOMAIN_IDS } from './factories/session-domain'
import { createWorktreeDomain, MANAGED_ID } from './factories/worktree-domain'

test('reviving a formerly managed worktree clears the stored creation parent', () => {
  const fixture = createWorktreeDomain()
  fixture.create()
  fixture.ready()
  expect(fixture.worktree()).toMatchObject({ baseBranch: 'main' })
  const event = domainEvent(
    'worktree.revived',
    {
      worktreeId: MANAGED_ID,
      projectId: DOMAIN_IDS.project,
      registrationGeneration: 1,
      canonicalPath: '/managed/checkout',
      path: '/managed/checkout',
      branch: `worktree/${MANAGED_ID}`,
      kind: 'linked',
      ownership: 'external',
      createdAt: DOMAIN_AT,
      updatedAt: DOMAIN_AT,
    },
    100,
  )

  fixture.pipeline.applyEvents(fixture.append([event]))

  expect(fixture.worktree()).toMatchObject({ ownership: 'external', baseBranch: null })
})
