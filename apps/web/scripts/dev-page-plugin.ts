import type { Plugin } from 'vite'

/** Serves dev.html at /dev and every /dev/<tab>; in a release the server does the same. */
export function devPagePlugin(): Plugin {
  return {
    name: 'fregat-dev-page',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        if (pathname === '/dev' || pathname.startsWith('/dev/')) request.url = '/dev.html'
        next()
      })
    },
  }
}
