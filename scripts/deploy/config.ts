import path from 'node:path'

export const checkoutRoot = path.resolve(import.meta.dirname, '../..')
export const productionRoot = '/work/platform-production'
export const releasesRoot = path.join(productionRoot, 'releases')
export const currentLink = path.join(productionRoot, 'current')

export const meshHost = 'omarchy'
export const meshOrigin = 'https://omarchy.mesh.shaulavo.dev'
export const meshRoute = '/platform'
export const webBase = `${meshRoute}/`
export const meshUrl = `${meshOrigin}${webBase}`

export const serverPort = 3301
export const serverUnit = 'platform-prod.service'
export const tuiOrigin = 'platform-tui://local'

export const unitTemplate = path.join(import.meta.dirname, 'systemd', serverUnit)
export const liveCheckScript = path.join(import.meta.dirname, 'live-check.mjs')
