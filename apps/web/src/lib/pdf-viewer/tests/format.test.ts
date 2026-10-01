import { test, expect } from '../../../../test/fixtures'
import { isPdfFile } from '@/lib/pdf-viewer/format'

test('PDF identity uses the final extension or attachment media type', () => {
  expect(isPdfFile('work/report.PDF')).toBe(true)
  expect(isPdfFile('work/record', 'application/pdf')).toBe(true)
  expect(isPdfFile('record', 'Application/PDF; charset=binary')).toBe(true)
  expect(isPdfFile('work.pdf/record.txt')).toBe(false)
  expect(isPdfFile('report.pdf.txt', 'text/plain')).toBe(false)
  expect(isPdfFile('record', 'application/pdf-example')).toBe(false)
})
