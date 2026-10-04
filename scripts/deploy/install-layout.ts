import { currentLink, pendingLink, productionRoot } from './config'
import * as operations from './release-operations'
import { log } from './run'
import type { Checkout } from './release'
import type { Release } from './release-operations'
import path from 'node:path'

export function createRelease(checkout: Checkout, slug: string) {
  return operations.createRelease(productionRoot, checkout.commit, slug)
}

export function currentRelease() {
  return operations.currentRelease(productionRoot)
}

export function pendingRelease() {
  return operations.pendingRelease(productionRoot)
}

export function stagePending(release: Release) {
  const replaced = pendingRelease()
  operations.stagePending(productionRoot, release)
  const note = replaced ? `, replacing ${path.basename(replaced)}` : ''
  log('stage', `${pendingLink} → ${release.name}${note}`)
}

export function removePending() {
  return operations.removePending(productionRoot)
}

export function swapCurrent(release: Release) {
  operations.swapCurrent(productionRoot, release)
  log('swap', `${currentLink} → ${release.name}`)
}

export function pointCurrentAt(directory: string) {
  operations.pointCurrentAt(productionRoot, directory)
  log('swap', `${currentLink} → ${path.basename(directory)}`)
}
