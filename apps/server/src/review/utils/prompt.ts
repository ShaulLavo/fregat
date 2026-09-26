import type { AgentReviewTarget } from '@workspace/contracts'

const RUBRIC = [
  'Report only problems the author would want to fix before merging: incorrect behaviour, crashes,',
  'security holes, data loss, broken contracts, missing error handling that matters. Leave out style,',
  'naming and formatting. Each finding gets a short title, a body that explains the problem and why it',
  'is one, a priority from 0 (must fix) to 3 (minor), a confidence from 0 to 1, and the smallest line',
  'range in the changed file that shows it, counted in the new version of the file.',
  'Set overall_correctness to "patch is correct" or "patch is incorrect" and explain it in',
  'overall_explanation. An empty findings list is a valid answer.',
].join('\n')

/** A review of a patch the reviewer receives in full; it runs in an empty directory. */
export function patchReviewPrompt(target: AgentReviewTarget, patch: string) {
  return [
    `Review the following ${patchTargetLabel(target)}.`,
    RUBRIC,
    'For code_location.absolute_file_path give the file path exactly as the patch names it after `b/`.',
    '',
    '```diff',
    patch.trimEnd(),
    '```',
  ].join('\n')
}

/** A review the reviewer reads from the checkout itself, read-only. */
export function checkoutReviewPrompt(target: AgentReviewTarget) {
  return [
    `Review ${checkoutTargetLabel(target)} in this repository. Read the diff with git, and read the`,
    'surrounding code as you need it. Change nothing.',
    RUBRIC,
    'For code_location.absolute_file_path give the absolute path of the file.',
  ].join('\n')
}

function patchTargetLabel(target: AgentReviewTarget) {
  if (target.kind === 'turn') return 'changes an agent made in one turn'
  return 'uncommitted changes'
}

function checkoutTargetLabel(target: AgentReviewTarget) {
  if (target.kind === 'branch') return `the changes on this branch since it left \`${target.baseBranch}\` (\`git diff ${target.baseBranch}...HEAD\`)`
  if (target.kind === 'commit') return `commit \`${target.sha}\` (\`git show ${target.sha}\`)`
  return 'the uncommitted changes'
}
