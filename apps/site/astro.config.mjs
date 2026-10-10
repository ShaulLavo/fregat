import { defineConfig } from 'astro/config'

export default defineConfig({
  site: process.env.SITE_ORIGIN ?? 'https://shaullavo.github.io',
  base: process.env.SITE_ORIGIN ? '/' : '/fregat',
  devToolbar: { enabled: false },
})
