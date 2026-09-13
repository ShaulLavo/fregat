import { defineConfig } from 'astro/config'

// served from github pages at https://shaullavo.github.io/fregat/
export default defineConfig({
  site: 'https://shaullavo.github.io',
  base: '/fregat',
  devToolbar: { enabled: false },
})
