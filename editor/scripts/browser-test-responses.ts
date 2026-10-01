import type { Plugin } from 'vite'

export function browserTestResponses(): Plugin {
  return {
    name: 'editor-test:complete-responses',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        // Chromium retains an allocated body pipe for a 304 until the loader is collected.
        // Repeated worker imports otherwise accumulate native memory throughout the suite.
        delete request.headers['if-none-match']
        delete request.headers['if-modified-since']
        next()
      })
    },
  }
}
