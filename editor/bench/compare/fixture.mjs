const line = 'export const value: number = 123; // deterministic TypeScript fixture\n'

export const corpora = [
  'repeated',
  'realistic',
  'long-line',
  'unicode',
  'malformed',
  'injected',
  'dense-injected',
  'dense-recovery',
  'html',
  'markdown',
]

export function fixture(mib, corpus = 'repeated') {
  const units = mib * 1024 * 1024
  const blocks = {
    repeated: line,
    realistic:
      'export function total(items: readonly { price: number; count: number }[]): number {\n  return items.reduce((sum, item) => sum + item.price * item.count, 0);\n}\n',
    'long-line': 'export const values = [' + '123, '.repeat(209710) + '];\n',
    unicode: 'export const привет = "🙂 café 日本語"; // λ 😀\n',
    malformed: 'export const broken: number = ;\nconst value = (1 + );\n',
    injected: line,
    'dense-injected': '/** @param {string} value description */\nconst pattern = /[a-z]+/;\n',
    'dense-recovery': '/** @param {string} value */\nconst pattern = /[a-z]+/;\n',
    html: '<div class="item">hello &amp; goodbye</div>\n',
    markdown: '# Title\n\nA **bold** paragraph with [a link](https://example.com).\n\n',
  }
  if (!corpora.includes(corpus)) throw new RangeError('Unknown corpus')
  const head =
    {
      injected:
        '/** @param {number} value - Input. */\nexport const pattern = /(?<word>[a-z]+)\\s+\\d+/gu;\n',
      html: '<style>body { color: red; }</style><script>const pattern = /[a-z]+/g;</script>\n',
      markdown:
        '```html\n<style>body { color: red; }</style><script>const pattern = /[a-z]+/g;</script>\n```\n\n',
    }[corpus] ?? ''
  const block = blocks[corpus]
  if (corpus.startsWith('dense-')) {
    const count = Math.floor(units / block.length)
    return block.repeat(count) + ' '.repeat(units - count * block.length)
  }
  const text =
    head +
    block.repeat(Math.ceil((units - head.length) / block.length)).slice(0, units - head.length)
  // Keep the requested UTF-16 length without splitting an astral character at the tail.
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) + ' ' : text
}
