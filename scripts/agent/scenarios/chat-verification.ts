import { ok } from 'node:assert/strict'
import {
  orchestrationSessionDetailSnapshotSchema,
  orchestrationShellSnapshotSchema,
} from '../../../packages/contracts/src/index'
import * as v from 'valibot'
import type { Page } from 'playwright'
import { releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'

export async function readShell(page: Page, base: string) {
  const response = await page.request.get(`${base}/shell-snapshot`, {
    headers: { Origin: new URL(page.url()).origin },
  })
  ok(response.ok(), 'Shell snapshot is reachable')
  return v.parse(orchestrationShellSnapshotSchema, await response.json())
}

/** The session's projected detail over HTTP, as the page's own snapshot read gets it. */
export async function readSessionDetail(page: Page, base: string, sessionId: string) {
  const response = await page.request.get(`${base}/session-detail`, {
    headers: { Origin: new URL(page.url()).origin },
    params: { sessionId },
  })
  ok(response.ok(), 'Session detail is reachable')
  return v.parse(orchestrationSessionDetailSnapshotSchema, await response.json()).session
}

export async function dispatch(page: Page, base: string, command: Record<string, unknown>) {
  const response = await page.request.post(`${base}/commands`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { ...command, commandId: `chat-verification-${crypto.randomUUID()}` },
  })
  ok(response.ok(), `Verification command failed: ${await response.text()}`)
}

/** Switches the page to chat mode and returns the orchestration HTTP base its socket connected to. */
export async function openChat(page: Page) {
  const connected = page.waitForEvent('websocket', {
    predicate: (socket) => socket.url().endsWith('/orchestration/rpc'),
  })
  await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
  return (await connected)
    .url()
    .replace(/^ws/, 'http')
    .replace(/\/rpc$/, '')
}

/**
 * Opens chat mode on the connected owner and returns the shell every session scenario drives:
 * the orchestration base URL, the platform worktree and the project that owns it.
 */
export async function openChatShell(page: Page) {
  const workspace = await openChatWorkspace(page)
  ok(workspace.project?.defaultModelSelection, 'Project must have a default model')
  return { ...workspace, project: workspace.project }
}

/** Chat mode on the platform worktree, for scenarios that never run a turn and need no model. */
export async function openChatWorkspace(page: Page) {
  const base = await openChat(page)
  const { snapshot, worktree } = await platformWorktree(page, base)
  const project = snapshot.projects.find((item) => item.id === worktree.projectId)
  return { base, project, snapshot, worktree }
}

/**
 * Sessions that never run a turn, titled `${prefix} 1…count`, on the platform worktree. A
 * throwaway server has no provider, so the project may have no default model to borrow.
 */
export async function createIdleSessions(
  page: Page,
  workspace: Awaited<ReturnType<typeof openChatWorkspace>>,
  prefix: string,
  count: number,
) {
  const modelSelection = workspace.project?.defaultModelSelection ?? {
    providerInstanceId: 'claude',
    model: 'claude-sonnet-5',
  }
  const ids = Array.from({ length: count }, () => crypto.randomUUID())
  for (const [index, sessionId] of ids.entries())
    await dispatch(page, workspace.base, {
      type: 'session.create',
      sessionId,
      title: `${prefix} ${index + 1}`,
      modelSelection,
      worktreeTarget: { kind: 'current', worktreeId: workspace.worktree.id },
    })
  return ids
}

// A fresh server registers the workspace while the page boots, so the first snapshot can miss it.
async function platformWorktree(page: Page, base: string) {
  const deadline = Date.now() + 10_000
  for (;;) {
    const snapshot = await readShell(page, base)
    const worktree = snapshot.worktrees.find((item) => item.path.endsWith('/projects/platform'))
    if (worktree) return { snapshot, worktree }
    ok(Date.now() < deadline, 'Platform worktree must be registered')
    await page.waitForTimeout(200)
  }
}

export type ChatShell = Awaited<ReturnType<typeof openChatShell>>

/** Creates one disposable session on the shell's worktree with the project's default model. */
export async function createSession(
  page: Page,
  shell: Pick<ChatShell, 'base' | 'project' | 'worktree'>,
  sessionId: string,
  title: string,
) {
  await dispatch(page, shell.base, {
    type: 'session.create',
    sessionId,
    title,
    worktreeTarget: { kind: 'current', worktreeId: shell.worktree.id },
    modelSelection: shell.project.defaultModelSelection,
  })
}

/**
 * Every orchestration owner the page connects to while the scenario runs, as HTTP bases.
 * Registered before the navigation that opens the sockets.
 */
export function collectOrchestrationBases(page: Page) {
  const bases = new Set<string>()
  page.on('websocket', (socket) => {
    if (socket.url().endsWith('/orchestration/rpc'))
      bases.add(
        socket
          .url()
          .replace(/^ws/, 'http')
          .replace(/\/rpc$/, ''),
      )
  })
  return bases
}

/** A new session's composer with the model picker open; returns the picker panel. */
export async function openModelPickerInNewSession(page: Page) {
  await selectors.chatNewSession(page).click()
  const trigger = selectors.modelPickerTrigger(page)
  await trigger.waitFor({ timeout: 20_000 })
  await trigger.click()
  const panel = selectors.modelPickerPanel(page)
  await panel.waitFor({ timeout: 10_000 })
  return panel
}

/** Waits for the agent's reply marker. The prompt names it too, so the reply is the second match. */
export async function waitForReply(page: Page, marker: string) {
  const matches = selectors.chatMessages(page).getByText(marker)
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if ((await matches.count()) >= 2) return
    await Bun.sleep(250)
  }
  ok(false, `The agent never replied ${marker}`)
}

/** The composer re-mounts once the session loads, which drops text typed before it. */
export async function typePrompt(page: Page, prompt: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await selectors.chatMessage(page).fill(prompt)
    await Bun.sleep(300)
    if (await selectors.chatSend(page).isEnabled()) return
  }
  ok(false, 'The composer never accepted the prompt')
}

/** Stops and deletes a real-provider scenario's sessions, then its project and fixture. */
export async function removeScenarioSessions(
  page: Page,
  orchestration: string,
  input: { fixture: string; projectId: string | null; sessions: readonly string[] },
) {
  for (const sessionId of input.sessions) {
    await dispatch(page, orchestration, { type: 'session.runtime.stop', sessionId })
    await dispatch(page, orchestration, { type: 'session.delete', sessionId })
  }
  if (input.projectId)
    await dispatch(page, orchestration, {
      type: 'project.delete',
      projectId: input.projectId,
      force: true,
    })
  await releaseFixture(input.fixture)
}

/** Creates a full-access session on a fixture worktree and opens it in the rail. */
export async function openScenarioSession(
  page: Page,
  orchestration: string,
  input: {
    model: { providerInstanceId: string; model: string }
    sessionId: string
    title: string
    worktreeId: string
  },
) {
  await dispatch(page, orchestration, {
    type: 'session.create',
    sessionId: input.sessionId,
    title: input.title,
    worktreeTarget: { kind: 'current', worktreeId: input.worktreeId },
    modelSelection: input.model,
    runtimeMode: 'full-access',
  })
  await selectors.sessionSearch(page).fill(input.title)
  await selectors.sessionByTitle(page, input.title).click()
  await page.waitForURL((url) => url.href.includes(input.sessionId))
}
