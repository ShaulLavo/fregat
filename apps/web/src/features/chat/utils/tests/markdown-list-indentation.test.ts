import { createMarkdownSession } from '@workspace/markdown/utils/session'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
} from '@workspace/markdown/utils/tree-sitter-session'

import { remarkNormalizeListItemIndentation } from '../markdown-list-indentation'
import { expect, test } from '../../../../../test/fixtures'

const sources = [
  '**production**\n\n-       **aligned** bullet\n\n[docs](https://example.com)',
  '-       **aligned** bullet\n        second line\n',
  '> -       **aligned** bullet\n>         second line\n',
  '-\t\t**aligned** bullet\n',
  '-       **aligned** bullet\r\n        second line\r\n',
]

test.each([false, true])(
  'recovered list prose keeps authored source coordinates, native=%s',
  async (native) => {
    if (native) await initializeTreeSitterMarkdown()
    const createSession = native ? createTreeSitterMarkdownSession : createMarkdownSession
    for (const source of sources) {
      const session = createSession({ remarkPlugins: [remarkNormalizeListItemIndentation] })
      const blocks = session.update(source, { heal: false })
      const elements = blocks.flatMap((block) => descendants(block.nodes))
      const emphasis = elements.filter((node) => node.type === 'strong').at(-1)
      expect(emphasis?.position?.start.offset).toBe(source.indexOf('**aligned**'))
      expect(emphasis?.position?.end.offset).toBe(
        source.indexOf('**aligned**') + '**aligned**'.length,
      )
      expect(elements.some((node) => node.type === 'code')).toBe(false)
      const appended = session.update(source + '\n\nTail', { heal: true })
      expect(
        appended
          .flatMap((block) => descendants(block.nodes))
          .filter((node) => node.type === 'strong')
          .at(-1)?.position,
      ).toEqual(emphasis?.position)
    }
  },
)

type Position = NonNullable<
  ReturnType<
    ReturnType<typeof createMarkdownSession>['update']
  >[number]['nodes'][number]['position']
>
type Node = {
  readonly type: string
  readonly position?: Position
  readonly children?: readonly Node[]
}

function descendants(nodes: readonly Node[]): Node[] {
  return nodes.flatMap((node) => [node].concat(node.children ? descendants(node.children) : []))
}
