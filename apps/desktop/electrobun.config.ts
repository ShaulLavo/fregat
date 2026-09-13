import type { ElectrobunConfig } from 'electrobun'

export default {
  app: {
    name: 'Platform',
    identifier: 'dev.platform.desktop',
    version: '0.0.1',
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    // v2 defaults to Cottontail (JSC). The shell spawns apps/server on its own
    // process.execPath, so the main process must stay Bun or bun:sqlite breaks.
    mainProcess: 'bun',
    bun: {
      entrypoint: 'src/bun/index.ts',
    },
    mac: {
      bundleCEF: true,
      defaultRenderer: 'cef',
    },
    win: {
      bundleCEF: true,
      defaultRenderer: 'cef',
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: 'cef',
    },
    views: {
      preload: {
        entrypoint: 'src/preload/index.ts',
      },
    },
  },
} satisfies ElectrobunConfig
