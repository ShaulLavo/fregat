import { ok, strictEqual } from 'node:assert/strict'
import * as v from 'valibot'
import { settingsSnapshotSchema } from '../../../packages/contracts/src/index'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { collectOrchestrationBases, dispatch, readShell } from './chat-verification'

export const projectGrouping: Scenario = {
  name: 'project-grouping',
  description:
    'Verify repository/separate grouping and scoped delete previews with two already-connected owners sharing a repository. Never confirms deletion.',
  async run(page, { step }) {
    const bases = collectOrchestrationBases(page)
    await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
    await selectors.sessionSearch(page).waitFor()
    await page.waitForTimeout(2_000)
    const owners = [...bases]
    ok(
      owners.length >= 2,
      'Grouping verification requires two already-connected live owners; do not start a development server for this scenario',
    )
    const primary = owners[0]!
    const secondary = owners[1]!
    const snapshots = await Promise.all([readShell(page, primary), readShell(page, secondary)])
    const project = snapshots[0]!.projects.find(
      (candidate) =>
        candidate.repositoryIdentity.source !== 'path' &&
        snapshots[1]!.projects.some((other) => other.repositoryKey === candidate.repositoryKey),
    )
    ok(project, 'Both owners need the same registered Git repository')
    const settingsUrl = primary.replace(/\/orchestration$/, '/settings')
    const headers = { Origin: new URL(page.url()).origin }
    const response = await page.request.get(settingsUrl, { headers })
    ok(response.ok(), 'Settings must be reachable')
    const saved =
      v
        .parse(settingsSnapshotSchema, await response.json())
        .layers.find((layer) => layer.id === 'user')?.raw ?? {}
    const keys = ['chat.projectGrouping', 'chat.projectGroupingOverrides']
    const write = async (operations: readonly Record<string, unknown>[]) => {
      const result = await page.request.post(`${settingsUrl}/write`, {
        headers,
        data: { mutationId: crypto.randomUUID(), target: 'user', operations },
      })
      ok(result.ok(), 'Grouping settings write must succeed')
    }
    const sessionId = crypto.randomUUID()
    const title = `Grouping verification ${sessionId.slice(0, 8)}`
    const created: string[] = []
    try {
      for (const [index, base] of [primary, secondary].entries()) {
        const snapshot = snapshots[index]!
        const owned = snapshot.projects.find(
          (candidate) => candidate.repositoryKey === project.repositoryKey,
        )!
        const worktree = snapshot.worktrees.find(
          (candidate) => candidate.projectId === owned.id && candidate.kind === 'current',
        )
        ok(
          worktree && owned.defaultModelSelection,
          'Each owner needs a current checkout and default model',
        )
        await dispatch(page, base, {
          type: 'session.create',
          sessionId,
          title,
          modelSelection: owned.defaultModelSelection,
          worktreeTarget: { kind: 'current', worktreeId: worktree.id },
        })
        created.push(base)
      }
      for (const mode of ['repository', 'repository_path', 'separate']) {
        await write([
          { kind: 'set', key: keys[0], value: mode },
          { kind: 'set', key: keys[1], value: {} },
        ])
        await page.reload()
        await selectors.sessionSearch(page).fill(title)
        await selectors.projectGroups(page).first().waitFor()
        await page.waitForTimeout(250)
        strictEqual(await selectors.projectGroups(page).count(), mode === 'separate' ? 2 : 1)
        await selectors.projectGroups(page).first().click({ button: 'right' })
        await selectors.projectDeleteMenu(page).click()
        await selectors.projectDeleteDialog(page).waitFor()
        strictEqual(await selectors.projectDeleteOwners(page).count(), mode === 'separate' ? 1 : 2)
        await step(`${mode}-scoped-delete-preview`)
        await selectors.projectDeleteCancel(page).click()
      }
    } finally {
      for (const base of created) await dispatch(page, base, { type: 'session.delete', sessionId })
      await write(
        keys.map((key) =>
          Object.hasOwn(saved, key)
            ? { kind: 'set', key, value: saved[key] }
            : { kind: 'reset', keys: [key] },
        ),
      )
      await page.reload()
    }
  },
}
