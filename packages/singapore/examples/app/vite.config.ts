import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        collaboration: fileURLToPath(new URL('./collaboration.html', import.meta.url)),
      },
    },
  },
  worker: {
    format: 'es',
  },
})
