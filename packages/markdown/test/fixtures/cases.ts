import { CASE_SOURCE_HASHES } from './hashes'

export type Expectation = {
  readonly tag: string
  readonly count: number
  readonly texts?: readonly string[]
  readonly attributes?: readonly Readonly<Record<string, string | null>>[]
}
export type Checkpoint = {
  readonly name: string
  readonly offset: number
  readonly live: boolean
  readonly expected: readonly Expectation[]
  readonly textIncludes?: readonly string[]
  readonly textExcludes?: readonly string[]
}
export type MarkdownCase = {
  readonly id: string
  readonly source: string
  readonly sha256: string
  readonly tags: readonly string[]
  readonly expected: readonly Expectation[]
  readonly checkpoints: readonly Checkpoint[]
  readonly profile: 'chat' | 'gfm' | 'commonmark'
  readonly split: 'development'
  readonly provenance: { readonly kind: 'owned'; readonly license: 'MIT'; readonly author: string }
}

function e(
  tag: string,
  count: number,
  texts?: readonly string[],
  attributes?: readonly Readonly<Record<string, string | null>>[],
): Expectation {
  return { tag, count, texts, attributes }
}

function cp(
  name: string,
  prefix: string,
  expected: readonly Expectation[],
  textIncludes?: readonly string[],
  textExcludes?: readonly string[],
): Checkpoint {
  return { name, offset: prefix.length, live: true, expected, textIncludes, textExcludes }
}

function c(
  id: string,
  source: string,
  tags: readonly string[],
  expected: readonly Expectation[],
  checkpoints: readonly Checkpoint[] = [],
  profile: MarkdownCase['profile'] = 'gfm',
): MarkdownCase {
  return {
    id,
    source,
    tags,
    expected,
    checkpoints,
    profile,
    sha256: CASE_SOURCE_HASHES[id] ?? 'MISSING',
    split: 'development',
    provenance: { kind: 'owned', license: 'MIT', author: 'Fregat contributors' },
  }
}

const V = ['visual']
const W = ['visual', 'webkit-critical']
const NESTED_EMPHASIS_CHECKPOINT = cp('inside-start', '**outside *inside', [
  e('strong', 1, ['outside inside']),
  e('em', 1, ['inside']),
])

export const MARKDOWN_CASES: readonly MarkdownCase[] = [
  c(
    'plain-paragraph',
    'One small answer.',
    W,
    [e('p', 1, ['One small answer.'])],
    [cp('partial-word', 'One small', [e('p', 1, ['One small'])])],
    'commonmark',
  ),
  c(
    'two-paragraphs',
    'First paragraph.\n\nSecond paragraph.',
    W,
    [e('p', 2, ['First paragraph.', 'Second paragraph.'])],
    [cp('second-start', 'First paragraph.\n\nSecond', [e('p', 2, ['First paragraph.', 'Second'])])],
    'commonmark',
  ),
  c(
    'soft-line-break',
    'first line\nsecond line',
    W,
    [e('p', 1, ['first line\nsecond line']), e('br', 0)],
    [cp('second-line-start', 'first line\nsecond', [e('p', 1, ['first line\nsecond'])])],
    'commonmark',
  ),
  c(
    'hard-space-break',
    'first line  \nsecond line',
    W,
    [e('p', 1, ['first line\nsecond line']), e('br', 1)],
    [cp('before-hard-break', 'first line', [e('p', 1, ['first line'])])],
    'commonmark',
  ),
  c(
    'hard-backslash-break',
    'first\\\nsecond',
    V,
    [e('p', 1, ['first\nsecond']), e('br', 1)],
    [cp('before-backslash', 'first', [e('p', 1, ['first'])])],
    'commonmark',
  ),
  c(
    'atx-heading',
    '# Build status\n\nEverything passed.',
    W,
    [e('h1', 1, ['Build status']), e('p', 1, ['Everything passed.'])],
    [cp('heading-text', '# Build', [e('h1', 1, ['Build'])])],
    'commonmark',
  ),
  c(
    'heading-levels',
    '## Summary\n\n### Details\n\n#### Notes',
    V,
    [e('h2', 1, ['Summary']), e('h3', 1, ['Details']), e('h4', 1, ['Notes'])],
    [cp('first-heading', '## Summary', [e('h2', 1, ['Summary'])])],
    'commonmark',
  ),
  c(
    'setext-heading',
    'Summary\n=======\n\nDetails',
    V,
    [e('h1', 1, ['Summary']), e('p', 1, ['Details'])],
    [cp('before-underline', 'Summary', [e('p', 1, ['Summary'])])],
    'commonmark',
  ),
  c(
    'setext-second-level',
    'Summary\n-------\n\nDetails',
    V,
    [e('h2', 1, ['Summary']), e('p', 1, ['Details'])],
    [cp('before-underline', 'Summary', [e('p', 1, ['Summary'])])],
    'commonmark',
  ),
  c(
    'heading-trailing-marker',
    '### Summary ###',
    V,
    [e('h3', 1, ['Summary'])],
    [cp('before-closer', '### Summary', [e('h3', 1, ['Summary'])])],
    'commonmark',
  ),
  c(
    'strong-emphasis',
    'Read **the result** now.',
    W,
    [e('p', 1, ['Read the result now.']), e('strong', 1, ['the result'])],
    [
      cp(
        'unfinished-strong',
        'Read **the result',
        [e('strong', 1, ['the result'])],
        ['Read the result'],
        ['**'],
      ),
    ],
    'commonmark',
  ),
  c(
    'italic-emphasis',
    'Read *the result* now.',
    V,
    [e('em', 1, ['the result'])],
    [cp('unfinished-emphasis', 'Read *the result', [e('em', 1, ['the result'])], undefined, ['*'])],
    'commonmark',
  ),
  c(
    'nested-emphasis',
    '**outside *inside* outside**',
    W,
    [e('strong', 1, ['outside inside outside']), e('em', 1, ['inside'])],
    [NESTED_EMPHASIS_CHECKPOINT],
    'commonmark',
  ),
  c(
    'triple-emphasis',
    '***important***',
    V,
    [e('em', 1, ['important']), e('strong', 1, ['important'])],
    [cp('triple-open', '***important', [e('em', 1, ['important']), e('strong', 1, ['important'])])],
    'commonmark',
  ),
  c(
    'underscore-emphasis',
    '_calm_ and __clear__',
    V,
    [e('em', 1, ['calm']), e('strong', 1, ['clear'])],
    [cp('underscore-open', '_calm', [e('em', 1, ['calm'])])],
    'commonmark',
  ),
  c(
    'intraword-underscore',
    'file_name_value stays literal',
    V,
    [e('p', 1, ['file_name_value stays literal']), e('em', 0)],
    [cp('identifier-prefix', 'file_name', [e('p', 1, ['file_name']), e('em', 0)])],
    'commonmark',
  ),
  c(
    'strikethrough',
    'Keep ~~old value~~ new value.',
    V,
    [e('del', 1, ['old value'])],
    [cp('unfinished-strike', 'Keep ~~old value', [e('del', 1, ['old value'])], undefined, ['~~'])],
  ),
  c(
    'escaped-markers',
    '\\*literal\\* and \\_literal\\_',
    V,
    [e('p', 1, ['*literal* and _literal_']), e('em', 0)],
    [cp('escaped-opener', '\\*literal', [e('p', 1, ['*literal']), e('em', 0)])],
    'commonmark',
  ),
  c(
    'decoded-entities',
    'A &amp; B &lt; C &#65; &#x1F680;',
    V,
    [e('p', 1, ['A & B < C A 🚀'])],
    [cp('complete-entity', 'A &amp;', [e('p', 1, ['A &'])])],
    'commonmark',
  ),
  c(
    'inline-code',
    'Use `git status` now.',
    W,
    [e('p', 1, ['Use git status now.']), e('code', 1, ['git status'])],
    [cp('unfinished-code', 'Use `git status', [e('code', 1, ['git status'])])],
    'commonmark',
  ),
  c(
    'inline-code-backticks',
    'Use ``a ` b`` here.',
    V,
    [e('code', 1, ['a ` b'])],
    [cp('before-code', 'Use ', [e('p', 1, ['Use'])])],
    'commonmark',
  ),
  c(
    'inline-code-newline',
    '`a\nb`',
    V,
    [e('code', 1, ['a b'])],
    [cp('code-first-line', '`a', [e('code', 1, ['a'])])],
    'commonmark',
  ),
  c(
    'inline-code-padding',
    '` padded ` and `  `',
    V,
    [e('code', 2, ['padded', '  '])],
    [cp('padded-open', '` padded', [e('code', 1, [' padded'])])],
    'commonmark',
  ),
  c(
    'direct-link',
    'Read [the guide](https://example.com/guide).',
    W,
    [e('a', 1, ['the guide'], [{ href: 'https://example.com/guide' }])],
    [
      cp('open-destination', 'Read [the guide](https://exa', [
        e('a', 1, ['the guide'], [{ href: null, 'data-incomplete': 'true' }]),
      ]),
    ],
    'commonmark',
  ),
  c(
    'link-title',
    '[guide](https://example.com "Read the guide")',
    V,
    [e('a', 1, ['guide'], [{ href: 'https://example.com', title: 'Read the guide' }])],
    [
      cp(
        'link-label',
        '[guide',
        [e('a', 1, ['guide'], [{ href: null, 'data-incomplete': 'true' }])],
        ['guide'],
      ),
    ],
    'commonmark',
  ),
  c(
    'link-emphasis',
    '[**important** guide](https://example.com)',
    V,
    [
      e('a', 1, ['important guide'], [{ href: 'https://example.com' }]),
      e('strong', 1, ['important']),
    ],
    [
      cp('strong-label', '[**important** guide](https://exa', [
        e('a', 1, ['important guide'], [{ href: null }]),
        e('strong', 1, ['important']),
      ]),
    ],
    'commonmark',
  ),
  c(
    'link-parentheses',
    '[balanced](https://example.com/a_(b))',
    V,
    [e('a', 1, ['balanced'], [{ href: 'https://example.com/a_(b)' }])],
    [
      cp('nested-destination', '[balanced](https://example.com/a_(b', [
        e('a', 1, ['balanced'], [{ href: null }]),
      ]),
    ],
    'commonmark',
  ),
  c(
    'reference-late',
    'Read [guide][docs].\n\n[docs]: https://example.com/docs "Docs"',
    V,
    [e('a', 1, ['guide'], [{ href: 'https://example.com/docs', title: 'Docs' }])],
    [
      cp('before-definition', 'Read [guide][docs].', [
        e('a', 0),
        e('p', 1, ['Read [guide][docs].']),
      ]),
    ],
    'commonmark',
  ),
  c(
    'collapsed-reference',
    '[docs][]\n\n[docs]: /guide',
    V,
    [e('a', 1, ['docs'], [{ href: '/guide' }])],
    [cp('unresolved-reference', '[docs][]', [e('a', 0), e('p', 1, ['[docs][]'])])],
    'commonmark',
  ),
  c(
    'shortcut-reference',
    '[docs]\n\n[docs]: /guide',
    V,
    [e('a', 1, ['docs'], [{ href: '/guide' }])],
    [cp('shortcut-label', '[docs]', [e('a', 0), e('p', 1, ['[docs]'])])],
    'commonmark',
  ),
  c(
    'duplicate-reference',
    '[docs]\n\n[docs]: /first\n[docs]: /second',
    V,
    [e('a', 1, ['docs'], [{ href: '/first' }])],
    [
      cp('first-definition', '[docs]\n\n[docs]: /first\n', [
        e('a', 1, ['docs'], [{ href: '/first' }]),
      ]),
    ],
    'commonmark',
  ),
  c(
    'autolink-angle',
    '<https://example.com/path>',
    V,
    [e('a', 1, ['https://example.com/path'], [{ href: 'https://example.com/path' }])],
    [cp('before-angle-link', '<https:', [e('a', 0)])],
    'commonmark',
  ),
  c(
    'autolink-gfm',
    'Visit https://example.com/path.',
    V,
    [e('a', 1, ['https://example.com/path'], [{ href: 'https://example.com/path' }])],
    [cp('plain-intro', 'Visit ', [e('p', 1, ['Visit']), e('a', 0)])],
  ),
  c(
    'email-autolink',
    'Contact <hello@example.com>.',
    V,
    [e('a', 1, ['hello@example.com'], [{ href: 'mailto:hello@example.com' }])],
    [cp('email-intro', 'Contact ', [e('p', 1, ['Contact'])])],
    'commonmark',
  ),
  c(
    'image-alt-title',
    'Before ![a small plot](https://example.com/plot.png "Result") after.',
    V,
    [
      e(
        'img',
        1,
        [''],
        [{ src: 'https://example.com/plot.png', alt: 'a small plot', title: 'Result' }],
      ),
    ],
    [cp('before-image', 'Before ', [e('img', 0), e('p', 1, ['Before'])])],
    'commonmark',
  ),
  c(
    'image-empty-alt',
    '![](https://example.com/image.png)',
    V,
    [e('img', 1, [''], [{ alt: '', src: 'https://example.com/image.png' }])],
    [cp('image-marker', '!', [e('img', 0)])],
    'commonmark',
  ),
  c(
    'unordered-list',
    '- first\n- second\n- third',
    W,
    [e('ul', 1), e('li', 3, ['first', 'second', 'third'])],
    [cp('second-item', '- first\n- second', [e('ul', 1), e('li', 2, ['first', 'second'])])],
    'commonmark',
  ),
  c(
    'ordered-start',
    '7. seventh\n8. eighth',
    W,
    [e('ol', 1, undefined, [{ start: '7' }]), e('li', 2, ['seventh', 'eighth'])],
    [
      cp('first-numbered-item', '7. seventh', [
        e('ol', 1, undefined, [{ start: '7' }]),
        e('li', 1, ['seventh']),
      ]),
    ],
    'commonmark',
  ),
  c(
    'ordered-one',
    '1. first\n2. second',
    V,
    [e('ol', 1, undefined, [{ start: null }]), e('li', 2, ['first', 'second'])],
    [cp('first-item', '1. first', [e('li', 1, ['first'])])],
    'commonmark',
  ),
  c(
    'loose-list',
    '- first\n\n- second',
    V,
    [e('ul', 1), e('li', 2, ['\nfirst\n', '\nsecond\n']), e('p', 2, ['first', 'second'])],
    [cp('first-loose-item', '- first\n\n', [e('li', 1, ['first'])])],
    'commonmark',
  ),
  c(
    'nested-list',
    '- parent\n  - child\n  - sibling\n- next',
    V,
    [e('ul', 2), e('li', 4, ['parent\n\nchild\nsibling\n\n', 'child', 'sibling', 'next'])],
    [cp('parent-only', '- parent', [e('ul', 1), e('li', 1, ['parent'])])],
    'commonmark',
  ),
  c(
    'task-list',
    '- [ ] pending\n- [x] done',
    V,
    [
      e('li', 2, [' pending', ' done']),
      e(
        'input',
        2,
        ['', ''],
        [
          { checked: null, disabled: '', type: 'checkbox' },
          { checked: '', disabled: '', type: 'checkbox' },
        ],
      ),
    ],
    [
      cp('task-before-second', '- [ ] pending', [
        e('input', 1, undefined, [{ checked: null, disabled: '' }]),
      ]),
    ],
  ),
  c(
    'quoted-paragraph',
    '> A quoted reply.\n> Another line.',
    W,
    [e('blockquote', 1), e('p', 1, ['A quoted reply.\nAnother line.'])],
    [
      cp('quote-first-line', '> A quoted reply.', [
        e('blockquote', 1),
        e('p', 1, ['A quoted reply.']),
      ]),
    ],
    'commonmark',
  ),
  c(
    'nested-quote',
    '> outer\n>\n> > inner',
    V,
    [e('blockquote', 2), e('p', 2, ['outer', 'inner'])],
    [cp('outer-only', '> outer', [e('blockquote', 1), e('p', 1, ['outer'])])],
    'commonmark',
  ),
  c(
    'quote-list',
    '> - first\n> - second',
    V,
    [e('blockquote', 1), e('ul', 1), e('li', 2, ['first', 'second'])],
    [cp('first-quoted-item', '> - first', [e('blockquote', 1), e('li', 1, ['first'])])],
    'commonmark',
  ),
  c(
    'thematic-break',
    'Before\n\n---\n\nAfter',
    V,
    [e('hr', 1), e('p', 2, ['Before', 'After'])],
    [cp('before-break', 'Before\n\n', [e('hr', 0), e('p', 1, ['Before'])])],
    'commonmark',
  ),
  c(
    'fenced-typescript',
    '```ts\nconst answer = 42\n```',
    V,
    [e('pre', 1), e('code', 1, ['const answer = 42\n'], [{ class: 'language-ts' }])],
    [
      cp('open-fence', '```ts\nconst answer =', [
        e('code', 1, ['const answer =\n'], [{ class: 'language-ts', 'data-incomplete': 'true' }]),
      ]),
    ],
    'commonmark',
  ),
  c(
    'fenced-whitespace',
    '```\n  a\n\n\tb  \n```',
    V,
    [e('code', 1, ['  a\n\n\tb  \n'])],
    [
      cp('code-first-line', '```\n  a\n', [
        e('code', 1, ['  a\n'], [{ 'data-incomplete': 'true' }]),
      ]),
    ],
    'commonmark',
  ),
  c(
    'tilde-fence',
    '~~~python\nprint("ok")\n~~~',
    V,
    [e('code', 1, ['print("ok")\n'], [{ class: 'language-python' }])],
    [
      cp('tilde-open', '~~~python\nprint(', [
        e('code', 1, ['print(\n'], [{ 'data-incomplete': 'true' }]),
      ]),
    ],
    'commonmark',
  ),
  c(
    'unknown-fence-language',
    '```unlisted-language\na < b\n```',
    V,
    [e('code', 1, ['a < b\n'], [{ class: 'language-unlisted-language' }])],
    [
      cp('unknown-open', '```unlisted-language\na <', [
        e('code', 1, ['a <\n'], [{ 'data-incomplete': 'true' }]),
      ]),
    ],
    'commonmark',
  ),
  c(
    'fence-metadata',
    '```ts title="src/a.ts"\nlet value = 1\n```',
    V,
    [e('code', 1, ['let value = 1\n'], [{ 'data-meta': 'title="src/a.ts"' }])],
    [
      cp('metadata-open', '```ts title="src/a.ts"\nlet', [
        e('code', 1, ['let\n'], [{ 'data-meta': 'title="src/a.ts"', 'data-incomplete': 'true' }]),
      ]),
    ],
    'chat',
  ),
  c(
    'fence-literal-markdown',
    '```text\n**bold** [link](x)\n```',
    V,
    [e('code', 1, ['**bold** [link](x)\n']), e('strong', 0), e('a', 0)],
    [cp('literal-code', '```text\n**bold**', [e('code', 1, ['**bold**\n']), e('strong', 0)])],
    'commonmark',
  ),
  c(
    'fence-literal-html',
    '```html\n<script>alert(1)</script>\n```',
    ['safe'],
    [e('code', 1, ['<script>alert(1)</script>\n']), e('script', 0)],
  ),
  c(
    'indented-code',
    '    first\n    second',
    ['code'],
    [e('code', 1, ['first\nsecond\n'])],
    [],
    'commonmark',
  ),
  c(
    'tab-indented-code',
    '\tfirst\n\tsecond',
    ['code', 'unicode'],
    [e('code', 1, ['first\nsecond\n'])],
    [],
    'commonmark',
  ),
  c(
    'long-fence-closer',
    '````js\na ``` b\n````',
    ['code'],
    [e('code', 1, ['a ``` b\n'])],
    [],
    'commonmark',
  ),
  c(
    'unclosed-fence-complete',
    '```js\nconst value =',
    ['code'],
    [e('code', 1, ['const value =\n'], [{ 'data-incomplete': null }])],
    [],
    'commonmark',
  ),
  c(
    'simple-table',
    '| Name | Value |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |',
    V,
    [e('table', 1), e('th', 2, ['Name', 'Value']), e('td', 4, ['alpha', '1', 'beta', '2'])],
    [
      cp('before-separator', '| Name | Value |\n', [e('table', 0)]),
      cp('first-row', '| Name | Value |\n| --- | --- |\n| alpha | 1 |\n', [
        e('table', 1),
        e('td', 2, ['alpha', '1']),
      ]),
    ],
  ),
  c('aligned-table', '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |', V, [
    e(
      'th',
      3,
      ['Left', 'Center', 'Right'],
      [{ align: 'left' }, { align: 'center' }, { align: 'right' }],
    ),
    e('td', 3, ['a', 'b', 'c']),
  ]),
  c('table-empty-cells', '| A | B |\n| --- | --- |\n| | value |\n| other | |', V, [
    e('td', 4, ['', 'value', 'other', '']),
  ]),
  c('table-escaped-pipe', '| A | B |\n| --- | --- |\n| x\\|y | z |', V, [e('td', 2, ['x|y', 'z'])]),
  c('table-inline-code', '| Code | Meaning |\n| --- | --- |\n| `a\\|b` | **both** |', V, [
    e('td', 2, ['a|b', 'both']),
    e('code', 1, ['a|b']),
    e('strong', 1, ['both']),
  ]),
  c(
    'table-short-row',
    '| A | B | C |\n| --- | --- | --- |\n| value |',
    ['table'],
    [e('td', 3, ['value', '', ''])],
  ),
  c(
    'table-extra-cell',
    '| A | B |\n| --- | --- |\n| first | second | discarded |',
    ['table'],
    [e('td', 2, ['first', 'second'])],
  ),
  c(
    'table-thirteen-columns',
    '| A | B | C | D | E | F | G | H | I | J | K | L | M |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |',
    V,
    [
      e('th', 13, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']),
      e('td', 13, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']),
    ],
  ),
  c('html-details', '<details><summary>More</summary>\n\nHidden **answer**.\n\n</details>', V, [
    e('details', 1),
    e('summary', 1, ['More']),
    e('strong', 1, ['answer']),
  ]),
  c('html-inline', 'A <kbd>Ctrl</kbd> key.', V, [
    e('p', 1, ['A Ctrl key.']),
    e('kbd', 1, ['Ctrl']),
  ]),
  c(
    'html-fragment',
    '<div id="answer">Result</div>\n\n[Jump](#answer)',
    ['safe', 'fragment'],
    [
      e('div', 1, ['Result'], [{ id: 'user-content-answer' }]),
      e('a', 1, ['Jump'], [{ href: '#user-content-answer' }]),
    ],
  ),
  c(
    'html-name',
    '<img name="getSelection" src="x.png" alt="x">',
    ['safe'],
    [e('img', 1, [''], [{ name: 'user-content-getSelection', src: 'x.png', alt: 'x' }])],
  ),
  c(
    'html-event-handler',
    '<img src="x.png" onerror="alert(1)" alt="safe">',
    ['safe'],
    [e('img', 1, [''], [{ src: 'x.png', alt: 'safe', onerror: null }]), e('script', 0)],
  ),
  c(
    'html-script',
    '<script>alert(1)</script>\n\nVisible',
    ['safe'],
    [e('script', 0), e('p', 1, ['Visible'])],
  ),
  c(
    'html-iframe',
    '<iframe src="https://example.com"></iframe>\n\nVisible',
    ['safe'],
    [e('iframe', 0), e('p', 1, ['Visible'])],
  ),
  c(
    'unsafe-javascript-link',
    '[Run](javascript:alert(1))',
    ['safe'],
    [e('a', 1, ['Run'], [{ href: null }])],
  ),
  c(
    'unsafe-data-link',
    '[Run](data:text/html,hello)',
    ['safe'],
    [e('a', 1, ['Run'], [{ href: null }])],
  ),
  c(
    'unsafe-entity-link',
    '[Run](jav&#x61;script:alert(1))',
    ['safe'],
    [e('a', 1, ['Run'], [{ href: null }])],
  ),
  c(
    'unsafe-html-link',
    '<a href="javascript:alert(1)" onclick="alert(2)">Run</a>',
    ['safe'],
    [e('a', 1, ['Run'], [{ href: null, onclick: null }])],
  ),
  c(
    'raw-forged-incomplete',
    '<pre><code data-incomplete="true">safe</code></pre>',
    ['safe'],
    [e('code', 1, ['safe'], [{ 'data-incomplete': null }])],
  ),
  c(
    'safe-tel-link',
    '[Call](tel:+12345678)',
    ['safe'],
    [e('a', 1, ['Call'], [{ href: 'tel:+12345678' }])],
  ),
  c(
    'safe-mail-link',
    '[Mail](mailto:hello@example.com)',
    ['safe'],
    [e('a', 1, ['Mail'], [{ href: 'mailto:hello@example.com' }])],
  ),
  c(
    'cjk-emphasis',
    '日本語の**強調**です。',
    V.concat(['cjk']),
    [e('strong', 1, ['強調']), e('p', 1, ['日本語の強調です。'])],
    [cp('cjk-open-strong', '日本語の**強調', [e('strong', 1, ['強調'])])],
    'chat',
  ),
  c('cjk-strike', '日本語の~~古い~~です。', V.concat(['cjk']), [e('del', 1, ['古い'])], [], 'chat'),
  c(
    'cjk-autolink',
    '参照 https://example.com。続き',
    V.concat(['cjk']),
    [e('a', 1, ['https://example.com'], [{ href: 'https://example.com' }])],
    [],
    'chat',
  ),
  c(
    'hebrew-rtl',
    'שלום **עולם** וקישור [כאן](https://example.com).',
    W.concat(['rtl']),
    [e('strong', 1, ['עולם']), e('a', 1, ['כאן'], [{ href: 'https://example.com' }])],
    [cp('rtl-open-strong', 'שלום **עולם', [e('strong', 1, ['עולם'])])],
    'commonmark',
  ),
  c(
    'emoji-zwj',
    'Ship 👩🏽‍💻 with **🚀** now.',
    V.concat(['unicode']),
    [e('p', 1, ['Ship 👩🏽‍💻 with 🚀 now.']), e('strong', 1, ['🚀'])],
    [cp('emoji-prefix', 'Ship 👩🏽‍💻', [e('p', 1, ['Ship 👩🏽‍💻'])])],
    'commonmark',
  ),
  c(
    'combining-marks',
    'Cafe\u0301 and **e\u0301** stay exact.',
    V.concat(['unicode']),
    [e('p', 1, ['Cafe\u0301 and e\u0301 stay exact.']), e('strong', 1, ['e\u0301'])],
    [],
    'commonmark',
  ),
  c(
    'crlf-paragraphs',
    'First\r\n\r\nSecond\r\n',
    ['unicode', 'line-endings'],
    [e('p', 2, ['First', 'Second'])],
    [],
    'commonmark',
  ),
  c(
    'bom-source',
    '\uFEFF# Title\n\nText',
    ['unicode'],
    [e('h1', 1, ['Title']), e('p', 1, ['Text'])],
    [],
    'commonmark',
  ),
  c(
    'frontmatter-is-markdown',
    '---\ntitle: Answer\n---\n\nText',
    ['frontmatter'],
    [e('hr', 1), e('h2', 1, ['title: Answer']), e('p', 1, ['Text'])],
    [],
    'chat',
  ),
  c(
    'footnote-reference',
    'Read this[^note].\n\n[^note]: A small note.',
    ['footnote'],
    [e('sup', 1), e('section', 1), e('li', 1)],
    [],
    'gfm',
  ),
  c(
    'math-inline-fallback',
    'Inline $$x + y$$ result.',
    ['math'],
    [e('code', 1, ['x + y'])],
    [],
    'chat',
  ),
  c(
    'math-display-fallback',
    '$$\nx^2 + y^2\n$$',
    ['math'],
    [e('pre', 1), e('code', 1, ['x^2 + y^2'], [{ class: 'language-math' }])],
    [],
    'chat',
  ),
  c(
    'single-dollar-literal',
    'Cost $5 and $10.',
    ['math'],
    [e('p', 1, ['Cost $5 and $10.']), e('code', 0)],
    [],
    'chat',
  ),
  c(
    'malformed-link-literal',
    'Read [broken](not closed',
    ['malformed'],
    [e('a', 0), e('p', 1, ['Read [broken](not closed'])],
    [],
    'commonmark',
  ),
  c(
    'malformed-emphasis-literal',
    'Read **unfinished',
    ['malformed'],
    [e('strong', 0), e('p', 1, ['Read **unfinished'])],
    [],
    'commonmark',
  ),
  c('empty-source', '', ['empty'], [e('p', 0)]),
  c('whitespace-only', ' \n\n\t\n', ['empty'], [e('p', 0), e('code', 0)]),
  c('literal-null', 'a\u0000b', ['unicode'], [e('p', 1, ['a�b'])], [], 'commonmark'),
  c(
    'escaped-brackets',
    '\\[label\\] and \\!\\[image\\]',
    ['escape'],
    [e('p', 1, ['[label] and ![image]']), e('a', 0), e('img', 0)],
    [],
    'commonmark',
  ),
  c(
    'link-entity-title',
    '[A &amp; B](/path "A &amp; B")',
    ['entity'],
    [e('a', 1, ['A & B'], [{ title: 'A & B', href: '/path' }])],
    [],
    'commonmark',
  ),
  c(
    'ordered-interrupt-literal',
    'paragraph\n7. stays in paragraph',
    ['list'],
    [e('ol', 0), e('p', 1, ['paragraph\n7. stays in paragraph'])],
    [],
    'commonmark',
  ),
  c(
    'list-multiple-paragraphs',
    '- first\n\n  continuation\n\n- second',
    ['list'],
    [e('li', 2), e('p', 3, ['first', 'continuation', 'second'])],
    [],
    'commonmark',
  ),
  c(
    'quote-code-fence',
    '> ```js\n> const answer = 1\n> ```',
    ['quote', 'code'],
    [e('blockquote', 1), e('code', 1, ['const answer = 1\n'], [{ class: 'language-js' }])],
    [],
    'commonmark',
  ),
]

export const VISUAL_STORY_IDS: readonly string[] = [
  'plain-paragraph',
  'two-paragraphs',
  'soft-line-break',
  'hard-space-break',
  'atx-heading',
  'heading-levels',
  'strong-emphasis',
  'nested-emphasis',
  'strikethrough',
  'decoded-entities',
  'inline-code',
  'direct-link',
  'reference-late',
  'unordered-list',
  'ordered-start',
  'loose-list',
  'nested-list',
  'task-list',
  'quoted-paragraph',
  'nested-quote',
  'thematic-break',
  'fenced-typescript',
  'fenced-whitespace',
  'fence-metadata',
  'simple-table',
  'aligned-table',
  'table-thirteen-columns',
  'html-details',
  'cjk-emphasis',
  'hebrew-rtl',
  'emoji-zwj',
  'combining-marks',
]

export const WEBKIT_CRITICAL_IDS: readonly string[] = [
  'direct-link',
  'ordered-start',
  'nested-list',
  'fenced-typescript',
  'table-thirteen-columns',
  'html-details',
  'hebrew-rtl',
  'emoji-zwj',
]

export const BASELINE_DEFECTS = [
  {
    fixtureId: 'nested-emphasis',
    checkpointId: NESTED_EMPHASIS_CHECKPOINT.name,
    reason:
      'remend 1.3.1 closes the inner emphasis marker and leaves the outer strong marker visible',
    expected: NESTED_EMPHASIS_CHECKPOINT.expected,
  },
]
