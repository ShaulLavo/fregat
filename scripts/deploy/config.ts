import path from 'node:path'

import { serverPort, serverUnit } from './systemd/promote'

export const checkoutRoot = path.resolve(import.meta.dirname, '../..')
// Layout: releases/<stamp>-<commit>-<slug>/ holds web/, server/, build-config.json and live-check.json.
// current -> the served release. pending -> a release `deploy --server` staged; the unit's
// ExecStartPre (bin/promote.ts, installed from systemd/promote.ts) renames it over current on the
// next start, which only a Restart click, a crash or `systemctl start` causes. Both are symlinks.
export const productionRoot = '/work/platform-production'
export const releasesRoot = path.join(productionRoot, 'releases')
export const currentLink = path.join(productionRoot, 'current')
export const pendingLink = path.join(productionRoot, 'pending')

export const meshHost = 'omarchy'
export const meshOrigin = 'https://omarchy.mesh.shaulavo.dev'
export const meshRoute = '/platform'
export const webBase = `${meshRoute}/`
export const meshUrl = `${meshOrigin}${webBase}`

export { serverPort, serverUnit }
export const tuiOrigin = 'platform-tui://local'

export const unitTemplate = path.join(import.meta.dirname, 'systemd', serverUnit)
export const promoteSource = path.join(import.meta.dirname, 'systemd', 'promote.ts')
export const installedPromote = path.join(productionRoot, 'bin', 'promote.ts')
