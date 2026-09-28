import type { Scenario } from './index'
import { selectors } from '../selectors'
import { inspectTreeOcclusion } from '../tree-occlusion'
import { captureTreeScroll } from '../tree-scroll-frames'

export const treeScrollLive: Scenario = {
  name: 'tree-scroll-live',
  readOnly: true,
  description: 'Inspect native scrolling frames in the file tree already open at an address.',
  inspect: inspectTreeOcclusion,
  async run(page, { evidence, step }) {
    await selectors.folderTree(page).hover()
    await evidence.json(
      'client.json',
      await page.evaluate(`({
      release: document.querySelector('meta[name="platform-release"]')?.content,
      userAgent: navigator.userAgent,
      scrollTimeline: typeof ScrollTimeline,
    })`),
    )
    await step('before')
    await captureTreeScroll(page, evidence)
    await step('after')
  },
}
