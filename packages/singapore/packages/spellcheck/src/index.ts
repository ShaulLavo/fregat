export type { SpellcheckChecker } from './controller'
export {
  EDITOR_SPELLCHECK_FEATURE,
  EDITOR_SPELLCHECK_FEATURE_ID,
  type EditorSpellcheckFeature,
  type SpellIssue,
} from './feature'
export { createSpellcheckPlugin, type SpellcheckPluginOptions } from './plugin'
export type { SpellcheckScope } from './proseRanges'
export { SpellcheckService, type SpellcheckServiceOptions } from './service'
export {
  tokenizeSpellWords,
  type SpellTextRange,
  type SpellTokenizeMode,
  type SpellTokenizeOptions,
  type SpellWord,
} from './tokenizer'
