import path from 'node:path'

import { serverPort, serverUnit } from './systemd/promote'
import { readHomeSetting } from '../home-setting'
import { productionStateHome } from '../state-home'
import { createScriptError } from '../structured-errors'

const target = readHomeSetting(productionStateHome, 'developer.deployTarget')

export function requireDeployTarget() {
  if (target) return target
  throw createScriptError(
    'A valid developer.deployTarget is required to install a release or pair this machine.',
    {
      why: 'This machine has no valid local installation target.',
      fix: `Set developer.deployTarget in ${path.join(productionStateHome, 'settings.json')} with productionRoot, meshHost, meshOrigin and meshRoute. See docs/development.md.`,
      internal: { configured: false },
    },
  )
}

export { checkoutRoot } from '../checkout-root'
// Layout: releases/<stamp>-<commit>-<slug>/ holds web/, server/, build-config.json and live-check.json.
// current -> the served release. pending -> a release `install-release --server` staged; the unit's
// ExecStartPre (bin/promote.ts, installed from systemd/promote.ts) renames it over current on the
// next start, which only a Restart click, a crash or `systemctl start` causes. Both are symlinks.
export const productionRoot = target?.productionRoot ?? path.join(productionStateHome, 'production')
export const releasesRoot = path.join(productionRoot, 'releases')
export const currentLink = path.join(productionRoot, 'current')
export const pendingLink = path.join(productionRoot, 'pending')

export const meshHost = target?.meshHost ?? ''
export const meshOrigin = target?.meshOrigin ?? ''
export const meshRoute = target?.meshRoute.replace(/\/$/, '') || '/'
export const webBase = meshRoute === '/' ? '/' : `${meshRoute}/`
export const meshUrl = `${meshOrigin}${webBase}`

export { serverPort, serverUnit }
export const tuiOrigin = 'platform-tui://local'

export const unitTemplate = path.join(import.meta.dirname, 'systemd', serverUnit)
export const installedPromote = path.join(productionRoot, 'bin', 'promote.ts')
