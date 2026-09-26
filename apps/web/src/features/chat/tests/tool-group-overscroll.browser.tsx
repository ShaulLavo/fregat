import '@workspace/ui/globals.css'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'

import { ActivityGroupRow } from '@/features/chat/components/activity-group-row'
import { LiveActivityRow } from '@/features/chat/components/live-activity-row'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import { workLogEntry } from '../../../../test/factories/work-log'
import { AppProviders, createTestQueryClient } from '../../../../test/render'

const entries = Array.from({ length: 40 }, (_, index) =>
  workLogEntry({ id: `tool-${index}`, title: `Command ${index}`, outcome: 'succeeded' }),
)

let root: Root | null = null
afterEach(() => {
  flushSync(() => root?.unmount())
  root = null
  useChatWorkLogExpansionStore.setState({ expandedGroupIds: {} })
})

function render(children: React.ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  flushSync(() =>
    root?.render(<AppProviders queryClient={createTestQueryClient()}>{children}</AppProviders>),
  )
}

// Reaching the end of a tool list must not scroll the timeline behind it.
it('keeps the wheel inside an expanded tool group', async () => {
  useChatWorkLogExpansionStore.setState({ expandedGroupIds: { 'tool-0': true } })
  render(
    <>
      <ActivityGroupRow activities={entries} />
      <LiveActivityRow
        activity={{
          entry: entries[0]!,
          label: 'Running',
          active: true,
          activities: entries,
          tail: [],
        }}
        groupId='tool-0'
      />
    </>,
  )
  await expect
    .poll(() => document.querySelectorAll('[data-tool-group-scroll]').length)
    .toBeGreaterThanOrEqual(2)
  for (const region of document.querySelectorAll('[data-tool-group-scroll]')) {
    expect(getComputedStyle(region).overscrollBehaviorY).toBe('contain')
  }
})
