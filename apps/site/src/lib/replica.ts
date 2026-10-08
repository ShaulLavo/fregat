import agents from '../replicas/agents.html?raw'
import fanOut from '../replicas/fan-out.html?raw'
import review from '../replicas/review.html?raw'
import undo from '../replicas/undo.html?raw'
import update from '../replicas/update.html?raw'

// Each replica is plain markup for one scripted story. `{i:name}` and `{i:name:sm}` stand for
// icons from the page's sprite (components/Icons.astro).
const REPLICAS = { agents, 'fan-out': fanOut, review, undo, update } as const

export type ReplicaName = keyof typeof REPLICAS

export function replicaHtml(name: ReplicaName): string {
  return REPLICAS[name].replace(/\{i:([\w-]+)(?::(sm))?\}/g, (_, icon: string, size?: string) => {
    const className = size === 'sm' ? 'i sm' : 'i'
    return `<svg class="${className}" aria-hidden="true"><use href="#i-${icon}"/></svg>`
  })
}
