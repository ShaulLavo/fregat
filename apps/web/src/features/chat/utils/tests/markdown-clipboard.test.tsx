import { serializeRenderedMarkdownFragment } from '@/features/chat/utils/markdown-clipboard'
import { expect, test } from '../../../../../test/fixtures'

test('a rendered selection copies back as markdown, not flattened text', () => {
  const markdown = serialize(`
    <p>Fix <strong>this</strong> in <code>src/foo.ts</code>:</p>
    <ul><li>first</li><li>second</li></ul>
    <pre data-language="ts"><code class="language-ts">const a = 1</code></pre>
  `)

  expect(markdown).toContain('Fix **this** in `src/foo.ts`:')
  expect(markdown).toContain('- first\n- second')
  expect(markdown).toContain('```ts\nconst a = 1\n```')
})

test('links keep their destination and tables keep their columns', () => {
  const markdown = serialize(`
    <p><a href="https://example.com/guide">the docs</a></p>
    <table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
  `)

  expect(markdown).toContain('[the docs](https://example.com/guide)')
  expect(markdown).toContain('| a | b |')
  expect(markdown).toContain('| --- | --- |')
  expect(markdown).toContain('| 1 | 2 |')
})

test('a file link chip copies as the markdown it was rendered from', () => {
  const markdown = serialize(
    '<p>See <a data-markdown-copy="`src/foo.ts:42`" href="/repo/src/foo.ts">src/foo.ts:42</a></p>',
  )

  expect(markdown).toBe('See `src/foo.ts:42`')
})

test('interface chrome is left out of the copied markdown', () => {
  const markdown = serialize(
    '<div><button type="button">Copy code</button><span aria-hidden="true">icon</span><p>kept</p></div>',
  )

  expect(markdown).toBe('kept')
})

test('an empty copy override drops a header; a class name decides nothing', () => {
  const markdown = serialize(
    '<div data-markdown-copy=""><span>ts</span></div><p class="select-none">kept</p>',
  )

  expect(markdown).toBe('kept')
})

function serialize(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html

  return serializeRenderedMarkdownFragment(container)
}
