import { ok } from 'node:assert/strict'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import * as v from 'valibot'
import {
  DEFAULT_CODEX_PROVIDER_SETTINGS,
  DEFAULT_CLAUDE_PROVIDER_SETTINGS,
  providerListResultSchema,
  settingsSnapshotSchema,
} from '../../../packages/contracts/src/index'
import type { Scenario } from './index'
import { liveNativeProcesses, reapNativeProcesses } from '../native-processes'
import { selectors } from '../selectors'
import { dispatch, openChat, readShell } from './chat-verification'

const nativeEntrySchema = v.looseObject({
  event: v.string(),
  params: v.optional(v.unknown()),
  pid: v.optional(v.number()),
  childPid: v.optional(v.number()),
  cwd: v.optional(v.string()),
  result: v.optional(v.unknown()),
})

/** Fail before a scenario proceeds if settings could launch an unowned account. */
export async function assertFixtureProviders(page: Page, base: string, binaryPath?: string) {
  const snapshot = await settingsSnapshot(page, base)
  const instances = snapshot.values['providers.instances']
  for (const defaults of [DEFAULT_CODEX_PROVIDER_SETTINGS, DEFAULT_CLAUDE_PROVIDER_SETTINGS])
    ok(
      instances.some(
        (provider) =>
          provider.providerInstanceId === defaults.providerInstanceId && !provider.enabled,
      ),
      'Built-in providers must be explicitly disabled before any scenario runs',
    )
  const enabled = instances.filter((provider) => provider.enabled)
  ok(
    enabled.every(
      (provider) =>
        provider.driverKind === 'mock' ||
        (binaryPath !== undefined && provider.binaryPath === binaryPath),
    ),
    'Only mock providers or this scenario’s fixture binary may be enabled',
  )
}

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

/** Sets one key in the user's settings document, the path a map setting without its own operation takes. */
export async function writeRawSetting(page: Page, base: string, key: string, value: unknown) {
  const headers = { Origin: new URL(page.url()).origin }
  const layer = await page.request.get(`${base}/settings/raw?target=user`, { headers })
  ok(layer.ok(), `Read the user settings document returned ${layer.status()}`)
  const { text, revision } = (await layer.json()) as { text: string; revision: string }
  const document = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {}
  document[key] = value
  const response = await page.request.post(`${base}/settings/raw`, {
    headers,
    data: {
      writeId: crypto.randomUUID(),
      target: 'user',
      text: `${JSON.stringify(document, null, 2)}\n`,
      baseRevision: revision,
    },
  })
  ok(response.ok(), `Write the user settings document returned ${response.status()}`)
}

export async function writeSettings(page: Page, base: string, operations: readonly unknown[]) {
  const response = await page.request.post(`${base}/settings/write`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { target: 'user', mutationId: crypto.randomUUID(), operations },
  })
  ok(response.ok(), `Write isolated provider settings returned ${response.status()}`)
}

/** Runs `body` with one user setting written, then puts the user layer back as it was. */
export async function withUserSetting(
  page: Page,
  orchestration: string,
  setting: { readonly key: string; readonly value: unknown },
  body: () => Promise<void>,
) {
  const base = orchestration.replace(/\/orchestration$/, '')
  const before = await settingsSnapshot(page, base)
  await writeSettings(page, base, [{ kind: 'set', key: setting.key, value: setting.value }])
  try {
    await body()
  } finally {
    await restoreUserSettings(page, base, before, [setting.key])
  }
}

/**
 * A second window on the same session and throwaway server. Its own browser context:
 * tabs of one context share six HTTP/1.1 connections, and each tab holds four streams.
 */
export async function openSecondWindow(page: Page, orchestration: string) {
  const browser = page.context().browser()
  ok(browser, 'The scenario browser is unavailable')
  const context = await browser.newContext({ viewport: page.viewportSize() })
  const origin = orchestration.replace(/\/orchestration$/, '')
  await context.addInitScript(`window.platformDevServerUrl = ${JSON.stringify(origin)}`)
  const second = await context.newPage()
  await second.goto(page.url())
  await selectors.chatMessage(second).waitFor({ timeout: 30_000 })
  return { page: second, close: () => context.close() }
}

export async function sendPrompt(page: Page, prompt: string) {
  await selectors.chatMessage(page).fill(prompt)
  await selectors.chatSend(page).click()
}

/** The native Codex fixture opens an app-access approval on every turn it starts. */
export async function requestAppApproval(
  page: Page,
  prompt = 'Request the isolated app approval.',
) {
  await sendPrompt(page, prompt)
  await selectors.appApproval(page).waitFor({ timeout: 30_000 })
}

export async function nativeLog(root: string) {
  const text = await readFile(join(root, 'native.jsonl'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => v.parse(nativeEntrySchema, JSON.parse(line)))
}

/** Waits for the fixture and its recorded children to exit; SIGKILLs survivors, then fails. */
async function waitForNativeExit(root: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const entries = await nativeLog(root)
    if (liveNativeProcesses(root, entries).length === 0) return entries
    await Bun.sleep(100)
  }
  const survivors = liveNativeProcesses(root, await nativeLog(root))
  reapNativeProcesses(survivors)
  const named = survivors.map((process) => `${process.kind} ${process.pid}`).join(', ')
  ok(false, `Native fixture processes outlived their provider and were killed: ${named}`)
}

export type NativeProvider = Awaited<ReturnType<typeof installNativeProvider>>

/**
 * A Codex instance that runs `fixture` from its own folder under /work/tmp, which is also its
 * Codex home. `remove` drops the instance, waits for every fixture process to exit, deletes the
 * folder and returns what the fixture recorded.
 */
export async function installNativeProvider(
  page: Page,
  base: string,
  input: {
    readonly name: string
    readonly fixture: URL
    readonly displayLabel: string
    readonly kind?: FixtureProviderKind
  },
) {
  const kind = input.kind ?? 'codex'
  const root = await mkdtemp(`/work/tmp/fregat-${input.name}-native-`)
  // Claude's SDK runs a path without a script extension directly, as it runs the real CLI.
  const binary = join(root, kind === 'codex' ? 'codex.mjs' : 'claude')
  await copyFile(input.fixture, binary)
  await chmod(binary, 0o700)
  await writeFile(join(root, 'scenario'), input.name)
  const providerInstanceId = `verify-${crypto.randomUUID()}`
  const configDir = join(root, 'config')
  if (kind === 'claude') await mkdir(configDir)
  await writeSettings(page, base, [
    {
      kind: 'provider.setEnabled',
      providerInstanceId,
      enabled: true,
      createIfMissing: {
        driverKind: kind,
        displayLabel: input.displayLabel,
        binaryPath: binary,
        config: kind === 'codex' ? { home: root } : { configDir },
      },
    },
  ])
  await assertFixtureProviders(page, base, binary)
  const remove = async () => {
    const current = await settingsSnapshot(page, base)
    const remaining = current.values['providers.instances'].filter(
      (item) => item.providerInstanceId !== providerInstanceId,
    )
    await writeRawSetting(page, base, 'providers.instances', remaining)
    try {
      return await waitForNativeExit(root)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
  return {
    binary,
    /** Claude's config folder; Codex keeps its home in `root`. */
    configDir,
    model: { providerInstanceId, model: kind === 'codex' ? 'gpt-5.5' : CLAUDE_FIXTURE_MODEL },
    providerInstanceId,
    remove,
    root,
  }
}

/** The Codex stand-in whose threads persist, fork, rewind and compact; see the fixture's header. */
const CONVERSATION_FIXTURE = new URL('../fixtures/native-conversation.mjs', import.meta.url)

/** The Claude Code stand-in speaking the SDK's stream-json protocol; see the fixture's header. */
const CLAUDE_FIXTURE = new URL('../fixtures/native-claude.mjs', import.meta.url)
const CLAUDE_FIXTURE_MODEL = 'claude-haiku-4-5'

async function withClaudeProvider<T>(
  page: Page,
  orchestration: string,
  name: string,
  body: (native: NativeProvider) => Promise<T>,
) {
  const native = await installNativeProvider(page, orchestration.replace(/\/orchestration$/, ''), {
    name,
    fixture: CLAUDE_FIXTURE,
    displayLabel: `${name} fixture`,
    kind: 'claude',
  })
  try {
    return await body(native)
  } finally {
    await native.remove()
  }
}

/** Runs `body` with a conversation fixture instance on the owner at `orchestration`, then removes it. */
export async function withConversationProvider<T>(
  page: Page,
  orchestration: string,
  name: string,
  body: (native: NativeProvider) => Promise<T>,
) {
  const native = await installNativeProvider(page, orchestration.replace(/\/orchestration$/, ''), {
    name,
    fixture: CONVERSATION_FIXTURE,
    displayLabel: `${name} fixture`,
  })
  try {
    return await body(native)
  } finally {
    await native.remove()
  }
}

export type FixtureProviderKind = 'codex' | 'claude'

/** Runs `body` with a fixture instance of `kind` on the owner at `orchestration`, then removes it. */
export async function withFixtureProvider<T>(
  page: Page,
  orchestration: string,
  provider: { readonly kind: FixtureProviderKind; readonly name: string },
  body: (native: NativeProvider) => Promise<T>,
) {
  if (provider.kind === 'codex')
    return withConversationProvider(page, orchestration, provider.name, body)
  return withClaudeProvider(page, orchestration, provider.name, body)
}

/** Keeps the conversation fixture's turns running until `release` removes the hold. */
export async function holdTurns(native: NativeProvider) {
  const file = join(native.root, 'hold')
  await writeFile(file, '')
  return { release: () => rm(file, { force: true }) }
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

/** A cold server can reject the page's first workspace open; the page retries it. */
async function firstWorktree(page: Page, orchestration: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const worktree = (await readShell(page, orchestration)).worktrees[0]
    if (worktree) return worktree
    await Bun.sleep(100)
  }
  return undefined
}

export function isolatedNativeScenario(options: {
  name: string
  description: string
  fixture: URL
  /** Runs the session in this checkout; omitted, the first registered worktree is used. */
  prepareWorktree?: () => Promise<PreparedWorktree>
  /** Starts the session in a new worktree forked from that checkout. */
  newWorktree?: boolean
  prepareServer?: Scenario['prepareServer']
  drive: (
    page: Page,
    context: {
      step: (name: string, target?: Page) => Promise<void>
      root: string
      orchestration: string
      sessionId: string
      providerInstanceId: string
      projectId: string
      worktreeId: string
      worktreePath: string
    },
  ) => Promise<unknown>
}): Scenario {
  const evidence = new WeakMap<Page, unknown>()
  return {
    name: options.name,
    requiresIsolatedServer: true,
    description: options.description,
    prepareServer: options.prepareServer,
    inspect: async (page) => evidence.get(page) ?? null,
    async run(page, { step }) {
      const orchestration = await openChat(page)
      const base = orchestration.replace(/\/orchestration$/, '')
      await assertFixtureProviders(page, base)
      const sessionId = crypto.randomUUID()
      const title = `${options.name} verification ${sessionId.slice(0, 8)}`
      const native = await installNativeProvider(page, base, {
        name: options.name,
        fixture: options.fixture,
        displayLabel: title,
      })
      const { binary, providerInstanceId, root } = native
      let created = false
      let driveEvidence: unknown
      const prepared = await options.prepareWorktree?.()
      let fixtureProjectId: string | null = null
      const newWorktreeId = options.newWorktree ? crypto.randomUUID() : null
      try {
        const worktree = prepared
          ? await registerFixtureProject(page, orchestration, prepared.path)
          : await firstWorktree(page, orchestration)
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
        ok(
          providers.providers
            .filter((provider) => provider.enabled)
            .every((provider) => provider.providerInstanceId === providerInstanceId),
          'The running registry enables only the scenario fixture',
        )
        await selectors.chatMessage(page).waitFor()
        driveEvidence = await options.drive(page, {
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
        // Printed here: a cleanup failure below would otherwise replace this error.
        console.error(`${options.name} drive failed: ${String(error)}`)
        await step('failed-before-cleanup')
        throw error
      } finally {
        await assertFixtureProviders(page, base, binary)
        // A drive may have deleted the session and removed its worktree itself.
        const shell = created ? await readShell(page, orchestration) : null
        if (shell?.sessions.some((session) => session.id === sessionId)) {
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
        const leftWorktree = shell?.worktrees.find((worktree) => worktree.id === newWorktreeId)
        if (newWorktreeId && leftWorktree && leftWorktree.lifecycle.state !== 'removed')
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
        const entries = await native.remove()
        evidence.set(page, {
          driveEvidence,
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
        await prepared?.release()
      }
    },
  }
}
