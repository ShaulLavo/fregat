import { createMarkdownSession } from '@workspace/markdown/utils/session'
import { expect, test } from '../../../../test/fixtures'
import {
  observeMarkdownDom,
  observeMarkdownSemantics,
} from '../../../../test/factories/markdown-observation'
import {
  createProductionMarkdownProbe,
  outputReceipt,
} from '../../../../test/factories/markdown-production'

function host(html: string) {
  const element = document.createElement('main')
  element.innerHTML = html
  return element
}

test('attribute insertion order leaves production receipts equal', async () => {
  const first = host('<a href="/x" title="x" class="one two">a  b</a>')
  const second = host('<a class="one two" title="x" href="/x">a  b</a>')
  expect(first.firstElementChild?.getAttributeNames()).not.toEqual(
    second.firstElementChild?.getAttributeNames(),
  )
  expect(await outputReceipt(observeMarkdownSemantics(first))).toEqual(
    await outputReceipt(observeMarkdownSemantics(second)),
  )
  expect(JSON.stringify(observeMarkdownDom(first))).toBe(JSON.stringify(observeMarkdownDom(second)))
})

test('derived table align keys also have canonical order', async () => {
  const first = host(
    '<table><tbody><tr><td style="text-align: right" title="x">a</td></tr></tbody></table>',
  )
  const second = host(
    '<table><tbody><tr><td align="right" title="x" style="text-align: right">a</td></tr></tbody></table>',
  )
  expect(await outputReceipt(observeMarkdownSemantics(first))).toEqual(
    await outputReceipt(observeMarkdownSemantics(second)),
  )
})

for (const [name, html] of [
  ['attribute value', '<a href="/y" title="x" class="one two">a  b</a>'],
  ['missing attribute', '<a href="/x" class="one two">a  b</a>'],
  ['empty attribute', '<a href="/x" title="" class="one two">a  b</a>'],
  ['whitespace', '<a href="/x" title="x" class="one two">a b</a>'],
  ['class order', '<a href="/x" title="x" class="two one">a  b</a>'],
  ['ancestor', '<section><a href="/x" title="x" class="one two">a  b</a></section>'],
] as const) {
  test(`production receipt rejects changed ${name}`, async () => {
    const original = host('<a href="/x" title="x" class="one two">a  b</a>')
    expect(await outputReceipt(observeMarkdownSemantics(host(html)))).not.toEqual(
      await outputReceipt(observeMarkdownSemantics(original)),
    )
  })
}

test('production receipt rejects child order with unchanged total text', async () => {
  const first = host('<p><em>x</em><strong>x</strong></p>')
  const second = host('<p><strong>x</strong><em>x</em></p>')
  expect(first.textContent).toBe(second.textContent)
  expect(await outputReceipt(observeMarkdownSemantics(first))).not.toEqual(
    await outputReceipt(observeMarkdownSemantics(second)),
  )
})

test('small real production probe reaches native fonts readiness and receipt serialization', async ({
  onTestFinished,
}) => {
  const element = host('')
  document.body.append(element)
  const probe = createProductionMarkdownProbe({ factory: createMarkdownSession, host: element })
  onTestFinished(async () => {
    await probe.dispose()
    element.remove()
  })
  expect(document.fonts.ready).toBeInstanceOf(Promise)
  const frame = await probe.show('[link](https://example.test/x "title")', false)
  expect(frame.text).toContain('link')
  expect(frame.paintedOutput).toEqual(await outputReceipt(observeMarkdownSemantics(element)))
})

test('observation retains safety-relevant attributes and exact text units', async () => {
  const element = host('')
  const link = document.createElement('a')
  link.setAttribute('onclick', 'untrusted()')
  link.setAttribute('href', 'javascript:untrusted()')
  link.textContent = 'x\ud800\r\n  y'
  element.append(link)
  const observation = observeMarkdownSemantics(element)
  expect(observation.text).toBe('x\ud800\r\n  y')
  expect(observation.elements[0].attributes).toEqual({
    href: 'javascript:untrusted()',
    onclick: 'untrusted()',
  })
  expect(Object.keys(observation.elements[0].attributes)).toEqual(['href', 'onclick'])
})

test('terminal timing mismatch emits one actual observation before rejecting the receipt', async ({
  onTestFinished,
}) => {
  const element = host('')
  document.body.append(element)
  const probe = createProductionMarkdownProbe({ factory: createMarkdownSession, host: element })
  onTestFinished(async () => {
    await probe.dispose()
    element.remove()
  })
  const expected = await probe.show('B', false)
  const samples: import('../../../../test/factories/markdown-production-types').ProductionMismatchSample[] =
    []
  await expect(
    probe.time('A', [], {
      arrival: 'paced',
      arrivalOffsetsMs: [0],
      expected: [expected.paintedOutput],
      onMismatch: async (sample) => {
        samples.push(sample)
      },
    }),
  ).rejects.toThrow('never matched its independent expected projection')
  expect(samples).toHaveLength(1)
  expect(samples[0].actual.text).toContain('A')
  expect(samples[0].actual.elements.length).toBeGreaterThan(0)
  expect(samples[0].actual.paintedOutput.digest).not.toBe(samples[0].expected.digest)
}, 25_000)
