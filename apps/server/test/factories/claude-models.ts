import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeExecutable } from '../../src/provider/adapters/utils/claude-executable'

/**
 * `supportedModels()` rows in the shape CLI 2.1.281 answers with, ids made up so
 * a real model release never touches a test. Families are real: the overlay keys on them.
 */
export const SYNTHETIC_OPUS = 'claude-opus-9'
export const SYNTHETIC_FABLE = 'claude-fable-9-1'
export const SYNTHETIC_SONNET = 'claude-sonnet-9'
export const SYNTHETIC_HAIKU = 'claude-haiku-9-9'

const EFFORT_LEVELS: ModelInfo['supportedEffortLevels'] = ['low', 'medium', 'high', 'xhigh', 'max']

export function claudeModelRows(): ModelInfo[] {
  return [
    opusRow('default', 'Default (recommended)'),
    opusRow('opus[1m]', 'Opus (1M context)'),
    {
      value: `${SYNTHETIC_FABLE}[1m]`,
      resolvedModel: SYNTHETIC_FABLE,
      displayName: 'Fable',
      description: 'Fable 9.1',
      supportsEffort: true,
      supportedEffortLevels: EFFORT_LEVELS,
      supportsAdaptiveThinking: true,
      supportsAutoMode: true,
    },
    {
      value: 'sonnet',
      resolvedModel: SYNTHETIC_SONNET,
      displayName: 'Sonnet',
      description: 'Sonnet 9',
      supportsEffort: true,
      supportedEffortLevels: EFFORT_LEVELS,
      supportsAdaptiveThinking: true,
      supportsAutoMode: true,
    },
    {
      value: 'haiku',
      resolvedModel: `${SYNTHETIC_HAIKU}-20990101`,
      displayName: 'Haiku',
      description: 'Haiku 9.9',
    },
  ]
}

function opusRow(value: string, displayName: string): ModelInfo {
  return {
    value,
    resolvedModel: `${SYNTHETIC_OPUS}[1m]`,
    displayName,
    description: 'Opus 9 with 1M context',
    supportsEffort: true,
    supportedEffortLevels: EFFORT_LEVELS,
    supportsAdaptiveThinking: true,
    supportsFastMode: true,
    supportsAutoMode: true,
  }
}

export const FAKE_CLAUDE_EXECUTABLE: ClaudeExecutable = {
  path: '/opt/claude/bin/claude',
  source: 'installed',
  version: '9.9.9',
}

/** Adapters in tests take this so no test runs `claude --version`. */
export async function resolveFakeClaudeExecutable() {
  return FAKE_CLAUDE_EXECUTABLE
}
