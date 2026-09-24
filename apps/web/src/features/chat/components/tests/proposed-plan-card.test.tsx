import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OrchestrationProposedPlan } from '@workspace/contracts'

import { ProposedPlanCard } from '@/features/chat/components/proposed-plan-card'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'
import { stubClipboard } from '../../../../../test/factories/clipboard'

const PLAN_MARKDOWN = '# Ship the retry queue\n\n1. Add the queue\n2. Drain it on boot'

test('copying puts the plan on the clipboard with its heading intact', async () => {
  const clipboard = stubClipboard()
  renderCard(proposedPlan())

  await userEvent.click(screen.getByRole('button', { name: 'Plan actions' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy to clipboard' }))

  await expect
    .poll(() => clipboard.written.map((write) => write.text))
    .toEqual(['# Ship the retry queue\n\n1. Add the queue\n2. Drain it on boot\n'])
  clipboard.restore()
})

test('downloading offers the plan as a markdown file named after its title', async () => {
  const downloads = stubDownloads()
  renderCard(proposedPlan())

  await userEvent.click(screen.getByRole('button', { name: 'Plan actions' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Download as markdown' }))

  expect(downloads).toHaveLength(1)
  expect(downloads[0]?.filename).toBe('ship-the-retry-queue.md')
  await expect(downloads[0]?.blob.text()).resolves.toContain('Drain it on boot')
})

test('a plan that was already built from says so', () => {
  renderCard(proposedPlan({ implementedAt: '2026-05-28T00:00:09.000Z' }))

  expect(screen.getByText('Implemented')).toBeInTheDocument()
})

test('an open plan is not labelled implemented', () => {
  renderCard(proposedPlan())

  expect(screen.queryByText('Implemented')).not.toBeInTheDocument()
})

// The card renders real chat markdown, which reaches for the editor commands
// behind its file links.
function renderCard(plan: OrchestrationProposedPlan) {
  renderWithProviders(
    <EditorStateProvider>
      <ProposedPlanCard plan={plan} />
    </EditorStateProvider>,
  )
}

type CapturedDownload = { blob: Blob; filename: string }

/**
 * The download is a real anchor click on a real object URL, so the seam is the
 * click and the URL factory — not our own code.
 */
function stubDownloads() {
  const downloads: CapturedDownload[] = []
  const blobsByUrl = new Map<string, Blob>()
  let nextUrl = 0

  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:plan-${(nextUrl += 1)}`
    blobsByUrl.set(url, blob)
    return url
  }
  URL.revokeObjectURL = () => {}
  HTMLAnchorElement.prototype.click = function capture(this: HTMLAnchorElement) {
    const blob = blobsByUrl.get(this.getAttribute('href') ?? '')
    if (!blob) return

    downloads.push({ blob, filename: this.download })
  }

  return downloads
}

function proposedPlan(
  overrides: Partial<OrchestrationProposedPlan> = {},
): OrchestrationProposedPlan {
  return {
    createdAt: '2026-05-28T00:00:02.000Z',
    id: 'plan-1',
    implementationSessionId: null,
    implementedAt: null,
    planMarkdown: PLAN_MARKDOWN,
    sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb',
    turnId: 'turn-1',
    updatedAt: '2026-05-28T00:00:02.000Z',
    ...overrides,
  } as OrchestrationProposedPlan
}
