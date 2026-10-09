import path from 'node:path'

import { compileTui, tuiSources } from './compiler.ts'

Bun.plugin({
  name: 'tui-react-compiler',
  setup(build) {
    build.onLoad({ filter: tuiSources }, async ({ path: file }) => {
      const result = await compileTui(file, await Bun.file(file).text())
      const contents = result.map
        ? `${result.code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(result.map)).toString('base64')}`
        : result.code
      return { contents, loader: 'js', resolveDir: path.dirname(file) }
    })
  },
})
