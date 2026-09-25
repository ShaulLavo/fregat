import { ok } from 'node:assert/strict'
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import * as v from 'valibot'
import {
  providerListResultSchema,
  settingsSnapshotSchema,
} from '../../../packages/contracts/src/index'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { dispatch, openChat, readShell } from './chat-verification'

const nativeEntrySchema = v.looseObject({
  event: v.string(),
  pid: v.optional(v.number()),
  result: v.optional(v.unknown()),
})

export async function settingsSnapshot(page: Page, base: string) {
  const response = await page.request.get(`${base}/settings`, {
    headers: { Origin: new URL(page.url()).origin },
  })
  ok(response.ok(), 'Read provider settings')
  return v.parse(settingsSnapshotSchema, await response.json())
}

/** Puts the user layer back exactly as `preserveAppearance` found it, key by key. */
export async function restoreUserSettings(
  page: Page,
  base: string,
  before: { layers: readonly { id: string; raw?: Record<string, unknown> }[] },
  keys: readonly string[],
) {
  const raw = before.layers.find((layer) => layer.id === 'user')?.raw
  await writeSettings(
    page,
    base,
    keys.map((key) =>
      raw?.[key] === undefined
        ? { kind: 'reset', keys: [key] }
        : { kind: 'set', key, value: raw[key] },
    ),
  )
}

export async function writeSettings(page: Page, base: string, operations: readonly unknown[]) {
  const response = await page.request.post(`${base}/settings/write`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { target: 'user', mutationId: crypto.randomUUID(), operations },
  })
  ok(response.ok(), `Write isolated provider settings returned ${response.status()}`)
}

export async function nativeLog(root: string) {
  const text = await readFile(join(root, 'native.jsonl'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => v.parse(nativeEntrySchema, JSON.parse(line)))
}

async function waitForNativeExit(root: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const entries = await nativeLog(root)
    const exited = new Set(
      entries.filter((entry) => entry.event === 'exit').map((entry) => entry.pid),
    )
    if (entries.filter((entry) => entry.event === 'spawn').every((entry) => exited.has(entry.pid)))
      return entries
    await Bun.sleep(100)
  }
  ok(false, 'Isolated native fixture processes must exit before removing their directory')
}

/** A disposable checkout the session runs in, instead of whichever worktree is registered first. */
type PreparedWorktree = {
  readonly path: string
  readonly release: () => Promise<void>
}

/** Registers `path` as its own project and resolves the exact worktree the server recorded. */
export async function registerFixtureProject(page: Page, orchestration: string, path: string) {
  await dispatch(page, orchestration, {
    type: 'project.create',
    title: `Fixture ${path.split('/').at(-1)}`,
    workspaceRoot: path,
  })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const worktree = (await readShell(page, orchestration)).worktrees.find(
      (item) => item.canonicalPath === path,
    )
    if (worktree) return worktree
    await Bun.sleep(100)
  }
  ok(false, `The fixture checkout ${path} must be registered`)
}

async function readyWorktree(page: Page, orchestration: string, worktreeId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const worktree = (await readShell(page, orchestration)).worktrees.find(
      (item) => item.id === worktreeId,
    )
    if (worktree?.lifecycle.state === 'ready') return worktree
    await Bun.sleep(100)
  }
  ok(false, `The new worktree ${worktreeId} must become ready`)
}

export function isolatedNativeScenario(options: {
  name: string
  description: string
  fixture: URL
  /** Runs the session in this checkout; omitted, the first registered worktree is used. */
  prepareWorktree?: () => Promise<PreparedWorktree>
  /** Starts the session in a new worktree forked from that checkout. */
  newWorktree?: boolean
  drive: (
    page: Page,
    context: {
      step: (name: string) => Promise<void>
      root: string
      orchestration: string
      sessionId: string
      providerInstanceId: string
      projectId: string
      worktreeId: string
      worktreePath: string
    },
  ) => Promise<void>
}): Scenario {
  const evidence = new WeakMap<Page, unknown>()
  return {
    name: options.name,
    description: options.description,
    inspect: async (page) => evidence.get(page) ?? null,
    async run(page, { step }) {
      const orchestration = await openChat(page)
      const base = orchestration.replace(/\/orchestration$/, '')
      const before = await settingsSnapshot(page, base)
      const originallySet =
        before.layers.find((layer) => layer.id === 'user')?.raw['providers.instances'] !== undefined
      const originalInstances = before.values['providers.instances']
      const root = await mkdtemp(`/work/tmp/fregat-${options.name}-native-`)
      const binary = join(root, 'codex.mjs')
      await copyFile(options.fixture, binary)
      await chmod(binary, 0o700)
      await writeFile(join(root, 'scenario'), options.name)
      const providerInstanceId = `verify-${crypto.randomUUID()}`
      const sessionId = crypto.randomUUID()
      const title = `${options.name} verification ${sessionId.slice(0, 8)}`
      let created = false
      const prepared = await options.prepareWorktree?.()
      let fixtureProjectId: string | null = null
      const newWorktreeId = options.newWorktree ? crypto.randomUUID() : null
      try {
        await writeSettings(page, base, [
          {
            kind: 'provider.setEnabled',
            providerInstanceId,
            enabled: true,
            createIfMissing: {
              driverKind: 'codex',
              displayLabel: title,
              binaryPath: binary,
              config: { home: root },
            },
          },
        ])
        const worktree = prepared
          ? await registerFixtureProject(page, orchestration, prepared.path)
          : (await readShell(page, orchestration)).worktrees[0]
        ok(worktree, 'A worktree exists')
        if (prepared) fixtureProjectId = worktree.projectId
        await dispatch(page, orchestration, {
          type: 'session.create',
          sessionId,
          title,
          worktreeTarget: newWorktreeId
            ? { kind: 'new', worktreeId: newWorktreeId, baseWorktreeId: worktree.id }
            : { kind: 'current', worktreeId: worktree.id },
          modelSelection: { providerInstanceId, model: 'gpt-5.5' },
        })
        created = true
        const sessionWorktree = newWorktreeId
          ? await readyWorktree(page, orchestration, newWorktreeId)
          : worktree
        await selectors.sessionSearch(page).fill(title)
        await selectors.sessionByTitle(page, title).click()
        await page.waitForURL((url) => url.href.includes(sessionId))
        const providerRead = page.waitForResponse(
          (response) => response.url() === `${base}/providers` && response.ok(),
        )
        await page.reload()
        const providers = v.parse(providerListResultSchema, await (await providerRead).json())
        ok(
          providers.providers.some(
            (provider) => provider.providerInstanceId === providerInstanceId,
          ),
          'Reloaded browser provider snapshot includes the isolated provider',
        )
        await selectors.chatMessage(page).waitFor()
        await options.drive(page, {
          step,
          root,
          orchestration,
          sessionId,
          providerInstanceId,
          projectId: worktree.projectId,
          worktreeId: sessionWorktree.id,
          worktreePath: sessionWorktree.canonicalPath,
        })
      } catch (error) {
        await step('failed-before-cleanup')
        throw error
      } finally {
        if (created) {
          await dispatch(page, orchestration, {
            type: 'session.runtime.stop',
            sessionId,
          })
          await dispatch(page, orchestration, {
            type: 'session.delete',
            sessionId,
          })
        }
        // The fixture directory goes with the project; the project goes only once nothing owns a checkout.
        if (newWorktreeId && created)
          await dispatch(page, orchestration, {
            type: 'worktree.release',
            worktreeId: newWorktreeId,
          })
        if (fixtureProjectId)
          await dispatch(page, orchestration, {
            type: 'project.delete',
            projectId: fixtureProjectId,
            force: true,
          })
        const current = await settingsSnapshot(page, base)
        const remaining = current.values['providers.instances'].filter(
          (item) => item.providerInstanceId !== providerInstanceId,
        )
        const unchanged = JSON.stringify(remaining) === JSON.stringify(originalInstances)
        const operation =
          !originallySet && unchanged
            ? { kind: 'reset', keys: ['providers.instances'] }
            : { kind: 'set', key: 'providers.instances', value: remaining }
        await writeSettings(page, base, [operation])
        const entries = await waitForNativeExit(root)
        evidence.set(page, {
          nativeReplies: entries.filter(
            (entry) => entry.event !== 'spawn' && entry.event !== 'exit',
          ),
          removedSession: sessionId,
          removedProject: fixtureProjectId,
          removedProvider: providerInstanceId,
          processEvents: entries.filter(
            (entry) => entry.event === 'spawn' || entry.event === 'exit',
          ),
        })
        await rm(root, { recursive: true, force: true })
        await prepared?.release()
      }
    },
  }
}
