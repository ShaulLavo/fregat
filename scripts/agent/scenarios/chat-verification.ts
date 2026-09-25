import { ok } from 'node:assert/strict'
import {
  orchestrationSessionDetailSnapshotSchema,
  orchestrationShellSnapshotSchema,
} from '../../../packages/contracts/src/index'
import * as v from 'valibot'
import type { Page } from 'playwright'
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
  const base = await openChat(page)
  const snapshot = await readShell(page, base)
  const worktree = snapshot.worktrees.find((item) => item.path.endsWith('/projects/platform'))
  ok(worktree, 'Platform worktree must be registered')
  const project = snapshot.projects.find((item) => item.id === worktree.projectId)
  ok(project?.defaultModelSelection, 'Project must have a default model')
  return { base, project, snapshot, worktree }
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
