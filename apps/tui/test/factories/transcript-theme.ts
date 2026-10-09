import assert from 'node:assert/strict'
import { act } from 'react'
import { CodeRenderable, MarkdownRenderable, type Renderable } from '@opentui/core'
import { appendAgentMessage, appendAgentPlan, renderAgentStage } from './agent-stage'
import type { TestServer } from '../server'

export const transcriptMarkers = [
  'Static user heading',
  'Static user prose',
  'Static user list',
  'Static user code',
  'Theme assistant',
  'Theme list',
  'Theme quote',
  'Theme table',
  'Theme code',
  'Plan retained',
] as const

export async function renderThemeTranscript(server: TestServer) {
  const app = await renderAgentStage(server, {
    conversation: true,
    conversationText:
      '# Static user heading\n\nStatic user prose\n\n1. Static user list\n2. Static user list next\n\n```text\nStatic user code\n```\n\n---',
    height: 100,
    noColor: false,
    colorMode: 'truecolor',
  })
  assert(app.submission)
  const { sessionId, turnId } = app.submission.command
  await act(async () => {
    await appendAgentPlan(server, {
      sessionId,
      turnId,
      text: 'Plan retained paragraph\n\n1. Plan item',
    })
    await appendAgentMessage(server, {
      sessionId,
      turnId,
      text: '# Theme assistant\n\nTheme assistant paragraph **bold**\n\n1. Theme list\n2. Theme list next\n\n> Theme quote\n\n| Column | Value |\n|---|---|\n| Theme table | Value |\n\n```text\nTheme code\n```\n\n---',
    })
  })
  await settleTranscript(app.frame)
  return app
}

export function transcriptRenderables(root: Renderable) {
  const nodes = [root]
  for (const node of nodes) nodes.push(...node.getChildren())
  return nodes
}

export async function settleTranscript(
  frame: Awaited<ReturnType<typeof renderAgentStage>>['frame'],
) {
  await frame.renderOnce()
  await finishHighlights(frame)
  await frame.renderOnce()
  await finishHighlights(frame)
  await frame.renderOnce()
}

async function finishHighlights(frame: Awaited<ReturnType<typeof renderAgentStage>>['frame']) {
  await act(async () => {
    await Promise.all(
      transcriptRenderables(frame.renderer.root)
        .filter((node): node is CodeRenderable => node instanceof CodeRenderable)
        .map((node) => node.highlightingDone),
    )
  })
}

export function transcriptMarkdown(root: Renderable, content: string) {
  const markdown = transcriptRenderables(root).find(
    (node) => node instanceof MarkdownRenderable && node.content.includes(content),
  )
  assert(markdown instanceof MarkdownRenderable)
  return markdown
}

export function transcriptCode(root: Renderable, content: string) {
  const code = transcriptRenderables(root).find(
    (node) => node instanceof CodeRenderable && node.content.includes(content),
  )
  assert(code instanceof CodeRenderable)
  return code
}
