import { onTestFinished } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { readyForScreenshot, requiredElement } from '../../../../test/factories/markdown-browser'

test('delayed HTML highlighting cannot be accepted before the supported fence settles', async () => {
  const host = document.createElement('main')
  host.style.color = 'rgb(0, 0, 0)'
  host.style.display = 'block'
  host.style.minHeight = '1px'
  host.style.width = '720px'
  host.innerHTML = `
    <div data-markdown="code-block" data-language="html">
      <pre data-markdown="code-block-body"><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>
    </div>
    <div data-markdown="code-block" data-language="unknown-language">
      <pre data-markdown="code-block-body"><code>plain text</code></pre>
    </div>
    <div data-markdown="code-block" data-language="html">
      <pre data-markdown="code-block-body"><code></code></pre>
    </div>
    <div data-markdown="code-block" data-language="html" data-incomplete="true">
      <pre data-markdown="code-block-body"><code>&lt;partial</code></pre>
    </div>
  `
  document.body.append(host)
  onTestFinished(() => host.remove())

  let settled = false
  const ready = readyForScreenshot(host).then(() => {
    settled = true
  })
  await new Promise<void>((resolve) => window.setTimeout(resolve, 100))
  expect(settled).toBe(false)

  const body = requiredElement(
    host,
    '[data-markdown="code-block"] [data-markdown="code-block-body"]',
  )
  const code = requiredElement(body, 'code')
  const token = document.createElement('span')
  token.style.color = 'rgb(86, 156, 214)'
  token.textContent = '<script>alert(1)</script>'
  code.replaceChildren(token)

  await ready
  expect(settled).toBe(true)
})
