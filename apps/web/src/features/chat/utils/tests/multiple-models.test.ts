import type { ModelSelection } from '@workspace/contracts'

import { draftSendTargets, toggledModelSelection } from '@/features/chat/utils/multiple-models'
import { expect, test } from '../../../../../test/fixtures'

const model = (name: string) => ({ model: name, providerInstanceId: 'codex' }) as ModelSelection

test('Shift+select toggles an extra model and never the primary one', () => {
  const primary = model('gpt-5.5')
  const added = toggledModelSelection([], primary, model('gpt-5.5-mini'))
  expect(added).toEqual([model('gpt-5.5-mini')])
  expect(toggledModelSelection(added, primary, model('gpt-5.5-mini'))).toEqual([])
  expect(toggledModelSelection(added, primary, primary)).toEqual(added)
})

test('a draft goes to its primary model first, then each extra once', () => {
  expect(draftSendTargets(model('a'), [model('b'), model('a')])).toEqual([model('a'), model('b')])
})
