import { ok } from 'node:assert/strict'
import { orchestrationShellSnapshotSchema } from '../../../packages/contracts/src/index'
import * as v from 'valibot'
import type { Page } from 'playwright'

export async function readShell(page: Page, base: string) {
  const response = await page.request.get(`${base}/shell-snapshot`, {
    headers: { Origin: new URL(page.url()).origin },
  })
  ok(response.ok(), 'Shell snapshot is reachable')
  return v.parse(orchestrationShellSnapshotSchema, await response.json())
}

export async function dispatch(page: Page, base: string, command: Record<string, unknown>) {
  const response = await page.request.post(`${base}/commands`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { ...command, commandId: `chat-verification-${crypto.randomUUID()}` },
  })
  ok(response.ok(), `Verification command failed: ${await response.text()}`)
}
