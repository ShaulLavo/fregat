import { approvalReceiptTitle } from '@/features/chat/utils/approval-presentation'
import { expect, test } from '../../../../../test/fixtures'

test('a receipt names what was decided', () => {
  expect(approvalReceiptTitle({ decision: 'accept' })).toBe('Allowed once')
  expect(approvalReceiptTitle({ decision: 'acceptForSession' })).toBe('Allowed for this session')
  expect(approvalReceiptTitle({ decision: 'acceptAlwaysInProject' })).toBe(
    'Always allowed in this project',
  )
  expect(approvalReceiptTitle({ decision: 'acceptAlways' })).toBe('Always allowed')
  expect(approvalReceiptTitle({ decision: 'decline' })).toBe('Denied')
  expect(approvalReceiptTitle({ decision: 'cancel' })).toBe('Cancelled')
})

test('a request with no decision ended unanswered, and a late answer was not used', () => {
  expect(approvalReceiptTitle({ resolution: 'ended' })).toBe('Ended unanswered')
  expect(approvalReceiptTitle({})).toBe('Ended unanswered')
  expect(approvalReceiptTitle({ decision: 'accept', resolution: 'stale' })).toBe('Answer not used')
})
