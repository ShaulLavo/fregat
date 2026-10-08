import {
  createTypeScriptLspPlugin,
  type TypeScriptLspStatus,
} from '@singapore-editor/typescript-lsp'

const textbufferSources = import.meta.glob(
  ['../../../packages/textbuffer/src/**/*.ts', '!../../../packages/textbuffer/src/**/*.test.ts'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
)

export function createLanguageService(onStatusChange: (status: TypeScriptLspStatus) => void) {
  const plugin = createTypeScriptLspPlugin({ onStatusChange })
  plugin.setWorkspaceFiles(
    Object.entries(textbufferSources).map(([name, text]) => ({
      path: '/node_modules/@singapore-editor/textbuffer/' + name.split('/src/')[1],
      text: text as string,
    })),
  )
  return plugin
}
