import type { ProviderSkill } from '@workspace/contracts'

import {
  rankFieldTokens,
  type FieldTokenCalibration,
} from '@/features/chat/utils/field-token-ranker'

// Capped penalties keep every composer tier below the next tier, and every field below the next field.
const CALIBRATION: FieldTokenCalibration = {
  fieldPenaltyStep: 200,
  offsets: { exact: 0, prefix: 20, boundary: 40, includes: 60, fuzzy: 120 },
  boundaryMarkers: ' -_/:.',
  maxPositionPenalty: 8,
  positionPenaltyFactor: 1,
  maxLengthPenalty: 16,
  lengthPenaltyDivisor: 2,
  maxFuzzyPenalty: 60,
  fuzzyIncludesLengthPenalty: false,
}

/** Leading trigger characters are the menu's, not part of what the user typed. */
const TRIGGER_PREFIX = /^[/$]+/

/** The projection this module indexes. `ProviderSlashCommand` satisfies it. */
export type ComposerCommandSearchable = {
  readonly aliases?: readonly string[]
  readonly argumentHint?: string
  readonly description?: string
  readonly name: string
}

/**
 * Ranked `/command` matches. An empty query keeps the provider's own order,
 * which is the order the CLI advertised them in.
 */
export function searchComposerCommands<T extends ComposerCommandSearchable>(
  commands: readonly T[],
  query: string,
  limit = Number.POSITIVE_INFINITY,
): T[] {
  return rankFieldTokens({
    items: commands,
    query: query.replace(TRIGGER_PREFIX, ''),
    fieldsOf: commandSearchFields,
    calibration: CALIBRATION,
    limit,
  })
}

/**
 * Ranked `$skill` matches. Disabled skills are dropped rather than ranked last:
 * committing one would put a name in the prompt the provider will not resolve.
 */
export function searchComposerSkills<T extends ProviderSkill>(
  skills: readonly T[],
  query: string,
  limit = Number.POSITIVE_INFINITY,
): T[] {
  return rankFieldTokens({
    items: skills.filter((skill) => skill.enabled),
    query: query.replace(TRIGGER_PREFIX, ''),
    fieldsOf: skillSearchFields,
    calibration: CALIBRATION,
    limit,
  })
}

function commandSearchFields(command: ComposerCommandSearchable) {
  return [
    command.name,
    (command.aliases ?? []).join(' '),
    command.description,
    command.argumentHint,
  ]
}

function skillSearchFields(skill: ProviderSkill) {
  return [skill.name, skill.description, skill.scope, skill.path]
}
