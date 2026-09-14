#!/usr/bin/env bun
// Copies pstack skills from the reference clone into ~/.agents/skills with the
// Cursor-specific phrasing replaced. Prints the lines it could not map so a
// human finishes them. Rerunnable after an upstream pull.
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'

const source = process.argv[2] ?? '/work/projects/references/pstack'
const target = join(homedir(), '.agents', 'skills')
const agentsTarget = join(homedir(), '.claude', 'agents')

const skills = [
  'poteto-mode',
  'create-verification-skill',
  'maintain-verification-skill',
  'arena',
  'swarm',
  'reflect',
  'how',
  'why',
  'architect',
  'interrogate',
  'blast-radius',
  'figure-it-out',
  'no-comments',
  'show-me-your-work',
  'typescript-best-practices',
]

type Rule = readonly [RegExp, string]

const rules: readonly Rule[] = [
  [/\.cursor\/skills\//g, '.agents/skills/'],
  [/~\/\.cursor\/projects\/\*\//g, '~/.claude/projects/*/'],
  [
    /~\/\.cursor\/projects\/<slug>\/agent-transcripts\/<uuid>\/<uuid>\.jsonl/g,
    '~/.claude/projects/<slug>/<uuid>.jsonl',
  ],
  [
    /the active workspace's `agent-transcripts\/` directory \(the system prompt names (?:the|this) path; do not glob across `~\/\.cursor\/projects\/\*\/`[^)]*\)/g,
    "the workspace's transcript directory, `~/.claude/projects/<slug>/` where `<slug>` is the workspace path with each `/` turned into `-`",
  ],
  [/`agent-transcripts\/`/g, '`~/.claude/projects/<slug>/`'],
  [/`subagent_type: generalPurpose`/g, 'a general-purpose subagent'],
  [/`generalPurpose`/g, 'a general-purpose subagent'],
  [/subagent_type: `generalPurpose`/g, 'a general-purpose subagent'],
  [/`AskQuestion`/g, '`AskUserQuestion`'],
  [/the `Task` tool/g, 'the `Agent` tool'],
  [/`Task` calls?/g, '`Agent` call'],
  [/every `Task` call/g, 'every `Agent` call'],
  [/Cursor's built-in \*\*babysit\*\* skill/g, 'the **Babysit** playbook'],
  [/Cursor's `\/loop` command \(a built-in, not a pstack skill\)/g, 'the `/loop` command'],
  [
    /Drive a long or stubborn hunt with Cursor's `\/loop` command\./g,
    'Drive a long or stubborn hunt with `/loop`.',
  ],
  [/the `deslop` skill from the `cursor-team-kit` plugin \(`\/deslop`\)/g, 'the **unslop** skill'],
  [/`\/deslop` the diff before commit;/g, 'apply the **unslop** skill to the diff before commit;'],
  [
    /the \*\*create-skill\*\* skill \(Cursor's built-in for authoring SKILL\.md files\)/g,
    'the **authoring-a-skill** playbook',
  ],
  [
    /Use the \*\*create-skill\*\* skill \(Cursor's built-in for authoring SKILL\.md files\)\./g,
    'Follow the shape of an existing skill in `~/.agents/skills`: YAML frontmatter with `name` and `description`, then short imperative sections.',
  ],
  [/Cursor's built-in `create-skill` skill/g, 'the **authoring-a-skill** playbook'],
  [
    /hand to `create-skill` and run its description-optimization loop/g,
    'rewrite the description so the trigger phrases appear in it, then test it with a fresh session',
  ],
  [
    /hand to Cursor's built-in `create-skill` skill and run its draft \/ test \/ iterate loop/g,
    'draft it, test it in a fresh session, iterate',
  ],
  [
    /`new skill via create-skill: <kebab-name>`: hand creation to `create-skill`\. Do not invent the shape ad hoc\./g,
    '`new skill: <kebab-name>`: create it in the shape of an existing skill.',
  ],
  [/a Cursor restart/g, 'a session restart'],
  [/"restart Cursor"/g, '"restart the session"'],
  [/After a Cursor restart:/g, 'After a session restart:'],
  [
    /`control-cli` \(CLIs and TUIs\) and `control-ui` \(browser \/ Electron \/ web UIs\)/g,
    'the project verification skill (`verify-platform` here)',
  ],
  [
    /`cursor-team-kit` publishes the project verification skill \(`verify-platform` here\)/g,
    'the project publishes it as `verify-platform`',
  ],
  [
    /\(`control-cli` or `control-ui` from `cursor-team-kit` as the change demands\)/g,
    '(the `verify-platform` skill)',
  ],
  [
    /`control-ui` or `control-cli` runtime verification \(from `cursor-team-kit`\)/g,
    '`verify-platform` runtime verification',
  ],
  [/the `control-ui` skill from the `cursor-team-kit` plugin/g, 'the `verify-platform` skill'],
  [/the `control-cli` skill from the `cursor-team-kit` plugin/g, 'the `verify-platform` skill'],
  [/via the matching control skill/g, 'via the `verify-platform` skill'],
  [/via the control skill/g, 'via the `verify-platform` skill'],
  [/the matching control skill/g, 'the `verify-platform` skill'],
  [
    /on the matching surface via the `verify-platform` skill/g,
    'on the real surface via the `verify-platform` skill',
  ],
  [/using your configured [a-z-]+ model \(default `[^`]+`\)/g, 'on a strong code model'],
  [/\(defaults? `[^`]+`(?:, `[^`]+`)*\)/g, ''],
  [/the project publishes it as `verify-platform`\. /g, ''],
  [
    /Shipping UI \/ IDE \/ CLI → the `verify-platform` skill\. /g,
    'Shipping UI / IDE / CLI → the `verify-platform` skill. ',
  ],
  [/`\.cursor\/worktrees\/myrepo\/x`/g, '`.claude/worktrees/myrepo/x`'],
  [
    /Bugbot or the agentic security review commented/g,
    'A review bot (Bugbot, CodeRabbit, the like) commented',
  ],
  [/`configurable via `\/setup-pstack`; /g, ''],
]

// Whole-line rewrites where the Cursor or Graphite dependency is the sentence itself.
const lineRules: readonly Rule[] = [
  [
    /^- Any PR-status request → the \*\*Babysit\*\* playbook \(`playbooks\/babysit\.md`\), and not Cursor's built-in babysit skill, whose description matches the same words\. /m,
    '- Any PR-status request → the **Babysit** playbook (`playbooks/babysit.md`). ',
  ],
  [
    /^\*\*Use `subagent_type: "poteto-agent"`[^\n]*$/m,
    '**Use `subagent_type: "poteto-agent"` for any subagent you spawn inside a playbook step** (code-writing delegates, ad-hoc helpers). Routed workflow skills (`how`, `why`, `interrogate`, `reflect`, `swarm`) set their own subagent shape; respect what the skill prescribes.',
  ],
  [
    /^\*\*Defaults for every `Agent` call\.\*\*[^\n]*$/m,
    '**Defaults for every `Agent` call.** Run it in the background, give it file pointers rather than inlined context, and pick the agent by the work: an `Explore` agent for read-only search, a general-purpose agent for edits, `poteto-agent` inside a playbook step. Hard changes (cross-cutting design, gnarly concurrency, subtle algorithms) get the strongest reasoning available; a precisely specified sequence of edits can go to a faster model.',
  ],
  [
    /^- \*\*Shipping\.\*\* The half after Babysit\.[^\n]*$/m,
    '- **Shipping.** The half after Babysit. Independently verifying a green stack, then landing the contiguous verified run with `gh pr merge --auto`. `playbooks/shipping.md`.',
  ],
  [
    /^- \*\*Autopilot-stack\.\*\*[^\n]*$/m,
    '- **Autopilot-stack.** A queue of changes built and verified with full autonomy, delivered as one linear reviewed chain of PRs the operator lands herself ("autopilot-stack", "stack them, don\'t ship", "build the stack, I\'ll land it"). `playbooks/autopilot-stack.md`.',
  ],
  [
    /One Cursor cloud agent per PR owns build, gt registration,/g,
    'One subagent per PR (`isolation: "worktree"`, or `"remote"` when the machine is not needed) owns build, opening its PR with `gh pr create`,',
  ],
  [
    /One Cursor cloud agent per PR owns its change end to end: build, `gt` registration of its own PR,/g,
    'One subagent per PR (`isolation: "worktree"`, or `"remote"` when the machine is not needed) owns its change end to end: build, opening its own PR with `gh pr create` against the right base,',
  ],
  [
    /Every PR is still gt-registered; the Graphite-metadata rule is about the UI, not stacks\. /g,
    '',
  ],
  [
    /one linear Graphite stack she reviews and lands herself/g,
    'one linear chain of PRs she reviews and lands herself',
  ],
  [
    /appends the PR to the one linear Graphite stack,/g,
    "appends the PR to the one linear chain (each PR based on the previous one's branch),",
  ],
  [
    /Stack mechanics follow Graphite \(`gt`\), with the division of labor the cloud environment forces\. /g,
    'Stack mechanics are plain `git` branches and `gh pr edit --base`. ',
  ],
  [
    /The root owns stack topology and registers each append locally: `gt track -p <current-tip>`, then `gt submit --no-interactive --stack` from the tip\. `gt submit` walks from trunk, and a cloud agent must never pull branches below its own into that walk; when instructed, it may set its bottom PR's base directly instead\./g,
    "The root owns stack topology: it sets each new PR's base to the current tip with `gh pr edit --base` and never rewrites branches below it.",
  ],
  [
    /by restacking the chain \(`gt restack`, `gt sync`\)/g,
    'by rebasing the chain bottom-up onto trunk',
  ],
  [/reviewable bottom-up in the Graphite UI,/g, 'reviewable bottom-up on GitHub,'],
  [
    /riding a cloud-sleeper wake chain \(a sleeping cloud agent that re-arms its own wake\)\. Each tick probes liveness via a cloud-agent status \/ liveness probe,/g,
    'on a `/loop` wakeup. Each tick probes liveness through the task list,',
  ],
  [
    /^\*\*You own the merge frontier\.[^\n]*$/m,
    '**You own the merge frontier. Declare a mode, clear one PR at a time, stop where the human\'s call begins.** For "babysit this", "get it green", "all green", "merge-ready", "watch CI", "address the review-bot comments", or "check on PR X". Step 1 owns the request-to-mode mapping. A request to land or ship is `playbooks/shipping.md`, which begins where this playbook ends.',
  ],
  [
    /No `gt submit --stack`, no restack, no force-push from inside a babysit\./g,
    'No rebase of the chain, no base retargeting, no force-push from inside a babysit.',
  ],
  [
    /Do not arm merge-when-ready or run `gt merge` or `gh pr merge` unless/g,
    'Do not arm auto-merge or run `gh pr merge` unless',
  ],
  [
    /Status comes from the mode's watcher at `scripts\/watch-pr\/watch-pr`\. Run it directly\./g,
    "Status comes from the mode's watcher at `~/.agents/skills/poteto-mode/scripts/watch-pr/watch-pr` (a Bun script over `gh`). Run it directly.",
  ],
  [
    /A subagent that opens a PR runs `interrogate`, `\/deslop`, and `\/no-comments`,/g,
    'A subagent that opens a PR runs `interrogate`, the **unslop** skill, and `/no-comments`,',
  ],
  [
    /For stacked PRs, use whatever stacking tool your team uses; the principle is small, ordered slices with the stack visible to reviewers\./g,
    'For stacked PRs, each branch is based on the previous one and `gh pr create --base <parent-branch>` makes the chain visible to reviewers.',
  ],
  [
    /^- \*\*Worker \/ verifier\.\*\* Always `environment: "cloud"` unless the task needs this machine:[^\n]*$/m,
    '- **Worker / verifier.** `isolation: "remote"` unless the task needs this machine: `verify-platform` runtime verification, reading local transcripts under `~/.claude/projects/<slug>/`, local IDE state, auth that exists only here. Remote agents cannot read the local store, so their briefs inline what they need or point at repo paths. Prefer fewer, broader workers; one writer per worktree or branch (principle-separate-before-serializing-shared-state). Run a unit\'s verifier on a different model from its worker when the environment offers one.',
  ],
  [
    /so a completion flood cannot wipe AskQuestion state/g,
    'so a completion flood cannot wipe pending-question state',
  ],
  [/FORBIDDEN    no gt, no rebase,/g, 'FORBIDDEN    no base retargeting, no rebase,'],
  [
    /Recompute `frontier\.json` from `gt` after every merge and stack mutation because GitHub base refs drift mid-restack while gt tracking is authoritative:/g,
    'Recompute `frontier.json` from `gh pr list --json number,baseRefName,headRefName,headRefOid,mergedAt` after every merge and stack mutation:',
  ],
  [
    /Resolve it where gt knows the stack, normally the stacker's clone; a checkout whose gt metadata never saw the submits reports no PRs and the command errors rather than guessing\./g,
    'Resolve it from GitHub, never from a local guess.',
  ],
  [
    /Exactly one stacker per stack may run `gt`, serialized within its stack; record the holder in the standing orders\. Restacks run in cloud; a local restack at this scale takes the laptop down\./g,
    'Exactly one stacker per stack may rebase or retarget bases, serialized within its stack; record the holder in the standing orders.',
  ],
  [/Workers never rebase and never run `gt`\./g, 'Workers never rebase and never retarget a base.'],
  [/the cloud agent's status in the Cursor dashboard/g, 'the task list'],
  [
    /^This is the half after `playbooks\/babysit\.md`\.[^\n]*$/m,
    'This is the half after `playbooks/babysit.md`. Babysit makes a stack mergeable. Shipping decides what is actually safe to merge and lets GitHub auto-merge drain it in order. Green is not safe, and the gap between those two words is where this playbook lives.',
  ],
  [
    /each a Cursor cloud agent, each exercising the real surface \(`control-ui` or `control-cli` from `cursor-team-kit` as the change demands\)/g,
    'each in its own worktree, each exercising the real surface through the `verify-platform` skill',
  ],
  [
    /^4\. \*\*Arm merge-when-ready through Graphite, and pass `--always`\.\*\*[^\n]*\n   ```bash\n   gt submit[^\n]*\n   ```/m,
    "4. **Arm auto-merge on the bottom PR only.** `gh pr merge <n> --auto --squash` (or the repo's merge method) on the lowest verified PR. Confirm with `gh pr view <n> --json autoMergeRequest` that it took; a silent no-op reads exactly like success.",
  ],
  [
    /^5\. \*\*Never enable GitHub auto-merge on a stack\.\*\*[^\n]*$/m,
    '5. **Never arm auto-merge above the bottom.** Every child targets its unprotected parent branch and already reads `CLEAN`, so GitHub would merge children into parents immediately and collapse the stack into itself. Arm one PR at a time: when the bottom merges, retarget the next PR to trunk with `gh pr edit --base main`, wait for its checks, then arm it. If a previous agent armed a child, disarm with `gh pr merge <n> --disable-auto` and confirm the field is back off.',
  ],
  [
    /^6\. \*\*Do not read `autoMergeRequest` as proof that MWR is armed\.\*\*[^\n]*$/m,
    "6. **Read `autoMergeRequest` only for the PR you armed.** A child's field stays off until it is retargeted and armed itself, so an unarmed reading upstack is meaningless.",
  ],
  [
    /^7\. \*\*Once the queue is draining, stop touching the stack\.\*\*[^\n]*$/m,
    '7. **Once the queue is draining, stop touching the stack.** No rebase, no speculative pushes, no base retargeting except the one step 5 prescribes after each merge. Independent work gets re-parented onto trunk and shipped on its own.',
  ],
  [
    /Bases retarget and `graphite-base\/\*` refs get cut as each PR merges; that is Graphite working, not damage\. /g,
    '',
  ],
  [
    /and `gt ls -s`, upper-stack diffs, or PR context shows/g,
    'and upper-stack diffs or PR context show',
  ],
  [
    /^- Pass `model:` explicitly per the configured roles \(defaults[^\n]*$/m,
    '- Pick the strongest reasoning available for judgment; a faster model is fine for precisely specified edits.',
  ],
  [
    /^- `\/deslop` over each diff before commit\. the \*\*unslop\*\* skill over any prose surface\./m,
    '- The **unslop** skill over each diff before commit and over any prose surface.',
  ],
  [
    /^3\. Pick the runners\. Use `arena runners` from `~\/\.cursor\/rules\/pstack-models\.mdc` when present\. Otherwise default to one each on[^\n]*$/m,
    '3. Pick the runners. Default to four, as diverse as the environment allows: different model families first, different reasoning tiers otherwise. Fewer runners with real diversity beat more identical ones.',
  ],
  [
    /Spawn all N subagents in one message with `run_in_background: true`, each with/g,
    'Spawn all N subagents in one message, in the background, each with',
  ],
  [
    /^After all Phase B candidates complete, choose one model from the `arena cross-judge pool` in `~\/\.cursor\/rules\/pstack-models\.mdc` when present\. Otherwise use[^\n]*$/m,
    'After all Phase B candidates complete, pick a judge on the strongest reasoning model available, preferably one that did not produce a candidate.',
  ],
  [
    /^4\. Pick the worker model from `swarm workers` in `~\/\.cursor\/rules\/pstack-models\.mdc` when present\. Otherwise use `grok-4\.6-fast-xhigh`\. For a model race, name each arm's model up front\./m,
    "4. Pick the worker model: a fast model for mechanical slices, a strong one for judgment. For a model race, name each arm's model up front.",
  ],
  [
    /^Spawn all N workers in one message with a general-purpose subagent, `environment: "cloud"`, `run_in_background: true`, and the configured model\. Use `environment: "local"` only when the worker needs access to something on the user's computer\./m,
    'Spawn all N workers in one message as general-purpose subagents in the background, `isolation: "remote"` unless a worker needs something on this machine, in which case `isolation: "worktree"`.',
  ],
  [
    /^When a worker must start from a non-default pushed branch, pass `cloud_base_branch`\.\n?/m,
    '',
  ],
  [
    /^ls -t <agent-transcripts>\/\*\.jsonl <agent-transcripts>\/\*\/\*\.jsonl <agent-transcripts>\/\*\/subagents\/\*\.jsonl 2>\/dev\/null \| head -10$/m,
    'ls -t ~/.claude/projects/<slug>/*.jsonl 2>/dev/null | head -10',
  ],
  [
    /^One message, three `Agent` call, a general-purpose subagent, explicit `model:` on each, agent mode \(`readonly: false`\)\.[^\n]*$/m,
    'One message, three `Agent` calls, general-purpose subagents, each on the strongest reasoning available and as diverse as the environment allows. The prompt forbids file writes; the parent applies edits.',
  ],
  [
    /^One `Agent` call, a general-purpose subagent, on a strong code model, agent mode \(`readonly: false`\)\.[^\n]*$/m,
    "One `Agent` call, a general-purpose subagent on a strong reasoning model. Use `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. The synthesizer returns a structured Accepted / Rejected / Backlog list.",
  ],
  [/, or plugin-installed paths under `~\/\.cursor\/plugins[^)]*\)/g, ')'],
  [/propose `new skill via create-skill:` only when/g, 'propose `new skill:` only when'],
  [/<draft a new skill via create-skill>/g, '<draft a new skill>'],
  [/<new skill via create-skill: <kebab-name>>/g, '<new skill: <kebab-name>>'],
  [/\(open files, recent edits, cursor location\)/g, '(open files, recent edits)'],
  [
    /^Before spawning investigators, list the available MCPs from the Cursor environment\.[^\n]*$/m,
    'Before spawning investigators, list the MCP tools available in this session (the deferred-tool listing, or `ToolSearch`).',
  ],
  [
    /^Launch all reviewers in a single message using the Task tool\.[^\n]*\n\n\| Subagent \| Default model \|\n\|[^\n]*\n(?:\| Reviewer [A-D] \| `[^`]+` \|\n)+\nFor each reviewer:\n- `subagent_type`: a general-purpose subagent\n- `model`: [^\n]*\n- `readonly`: `true`\n\nIf a model slug is rejected[^\n]*$/m,
    'Launch all reviewers in a single message, one subagent per reviewer, 3-4 reviewers by default (label them Reviewer A/B/C/D).\n\nMaximize diversity across reviewers with whatever the environment offers: different model families first, different models or reasoning tiers otherwise. Identical models running independently still diversify blind spots, but cross-family diversity is the strongest signal.\n\nEach reviewer is read-only and must not edit files.',
  ],
]

const leftover =
  /cursor|graphite|\bgt\b|grok|sol-max|gpt-5|claude-[a-z0-9.-]+|opus|generalPurpose|subagent_type: generalPurpose|readonly:|run_in_background|cursor-team-kit|control-ui|control-cli|setup-pstack|pstack-models|environment: "cloud"|cloud_base_branch|agent-transcripts|deslop|create-skill|AskQuestion\b/i

async function portSkill(name: string) {
  const from = join(source, 'skills', name)
  const to = join(target, name)
  await rm(to, { force: true, recursive: true })
  await cp(from, to, { recursive: true })
  const unmapped: string[] = []
  for (const file of await walk(to)) {
    if (!file.endsWith('.md')) continue
    const original = await readFile(file, 'utf8')
    const ported = [...rules, ...lineRules].reduce(
      (text, [pattern, replacement]) => text.replace(pattern, replacement),
      original,
    )
    await writeFile(file, ported)
    for (const [index, line] of ported.split('\n').entries()) {
      if (leftover.test(line))
        unmapped.push(`${relative(target, file)}:${index + 1}: ${line.trim().slice(0, 160)}`)
    }
  }
  return unmapped
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else files.push(path)
  }
  return files
}

async function portAgent() {
  await mkdir(agentsTarget, { recursive: true })
  const body = await readFile(join(source, 'agents', 'poteto-agent.md'), 'utf8')
  const ported = body
    .replace(
      /^---[\s\S]*?---\n/,
      `---\nname: poteto-agent\ndescription: Routing target for /poteto-mode and any request for poteto's style. Resume an existing poteto-agent for the conversation rather than spawning a sibling. Reads the poteto-mode skill's SKILL.md in full before any work, including its inline Principles index.\n---\n`,
    )
    .replace(
      /Substituting `generalPurpose` skips that read and drifts\./g,
      'A general-purpose subagent skips that read and drifts.',
    )
  await writeFile(join(agentsTarget, 'poteto-agent.md'), ported)
}

const report: string[] = []
for (const name of skills) report.push(...(await portSkill(name)))
await portAgent()
await stat(join(target, 'poteto-mode', 'SKILL.md'))
console.log(`ported ${skills.length} skills and poteto-agent`)
console.log(
  report.length
    ? `\nunmapped lines (${report.length}):\n${report.join('\n')}`
    : '\nno unmapped lines',
)
