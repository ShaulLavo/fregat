import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_PROVIDER_INSTANCE_ID,
  DEFAULT_RUNTIME_MODE,
  sessionIdSchema,
  approvalRequestIdSchema,
  chatAgentSchema,
  chatAgentToolSchema,
  turnIdSchema,
  type ProviderInstanceId,
} from '@workspace/contracts'
import * as v from 'valibot'
import { readFsLogs } from 'evlog/fs'
import { CodexProviderAdapter } from '../codex'
import { createNativeSessionProjection } from '../../../orchestration/tests/factories/native-session'
import { SESSION_ID } from '../../../orchestration/tests/factories/projection'
import { codexHistoryResponseSchema } from '../utils/codex-history'
import type { ProviderRuntimeEvent, ProviderTurnInput } from '../../types'
import {
  flushObservability,
  initializeObservability,
  resetObservabilityForTests,
} from '../../../observability/runtime'

const fakeCodexScript = `#!/usr/bin/env node
const readline = require('node:readline');

if (process.argv[2] === '--version') {
  console.error('snapshot should use app-server initialize for version');
  process.exit(72);
}

if (process.argv[2] !== 'app-server') {
  console.error('unsupported fake codex command');
  process.exit(1);
}

if (process.env.PLATFORM_FAKE_CODEX_MODE === 'delayed-exit') process.on('SIGTERM', () => setTimeout(() => process.exit(0), 100));

let threadStartCount = 0;
let turnStartCount = 0;
let lastSessionStartParams = null;

// One JSON line per app-server event a test needs to see from the outside: the
// working directory each process was spawned in, and the params of every
// request whose payload is the thing under test.
const spawnLogPath = process.env.PLATFORM_FAKE_CODEX_SPAWN_LOG;
function record(entry) {
  if (!spawnLogPath) return;
  require('node:fs').appendFileSync(spawnLogPath, JSON.stringify(entry) + '\\n');
}
record({ cwd: process.cwd(), event: 'spawn' });

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}

function fail(id, message) {
  send({ id, error: { message } });
}

function fakeSession(turns = []) {
  return {
    cliVersion: '9.9.9',
    createdAt: 0,
    cwd: '/Users/shaul/Desktop/platform',
    ephemeral: false,
    id: 'provider-thread-1',
    modelProvider: 'openai',
    preview: 'Say hello',
    source: 'appServer',
    status: { type: 'idle' },
    turns,
    updatedAt: 0,
  };
}

function fakeTurn(status = 'completed', items = []) {
  return {
    id: 'provider-turn-' + Math.max(turnStartCount, 1),
    items,
    status,
  };
}

function fakeModel() {
  return {
    defaultReasoningEffort: 'medium',
    description: 'Fake Codex model',
    displayName: 'GPT-5.5',
    hidden: false,
    id: 'gpt-5.5',
    isDefault: true,
    model: 'gpt-5.5',
    supportedReasoningEfforts: [
      { description: 'Fastest responses', reasoningEffort: 'low' },
      { description: 'Balanced', reasoningEffort: 'medium' },
      { description: 'Deeper reasoning', reasoningEffort: 'high' },
      { description: 'Even deeper reasoning', reasoningEffort: 'xhigh' },
      { description: 'Maximum reasoning depth', reasoningEffort: 'max' },
      { description: 'Maximum reasoning with delegation', reasoningEffort: 'ultra' },
      { description: 'An effort level this schema predates', reasoningEffort: 'hyperdrive' },
    ],
  };
}

function fakeModelWithoutReasoningEfforts() {
  return { ...fakeModel(), supportedReasoningEfforts: [] };
}

function sendReasoningEvents() {
  send({
    method: 'item/started',
    params: {
      threadId: 'provider-thread-1',
      turnId: fakeTurn().id,
      startedAtMs: 1770000000000,
      item: {
        id: 'reasoning-1',
        type: 'reasoning',
        summary: [],
        content: [],
      },
    },
  });
  send({
    method: 'item/reasoning/summaryPartAdded',
    params: {
      threadId: 'provider-thread-1',
      turnId: fakeTurn().id,
      itemId: 'reasoning-1',
      summaryIndex: 0,
    },
  });
  send({
    method: 'item/reasoning/summaryTextDelta',
    params: {
      threadId: 'provider-thread-1',
      turnId: fakeTurn().id,
      itemId: 'reasoning-1',
      delta: 'Inspecting the repo.',
      summaryIndex: 0,
    },
  });
  send({
    method: 'item/completed',
    params: {
      threadId: 'provider-thread-1',
      turnId: fakeTurn().id,
      completedAtMs: 1770000001000,
      item: {
        id: 'reasoning-1',
        type: 'reasoning',
        summary: ['Inspecting the repo.'],
        content: [],
      },
    },
  });
}

function sendAgentMessageItemCompleted(itemId, text) {
  send({
    method: 'item/completed',
    params: {
      threadId: 'provider-thread-1',
      turnId: fakeTurn().id,
      completedAtMs: process.env.PLATFORM_FAKE_CODEX_MODE?.startsWith('native-projection') ? Date.now() : 1770000002000,
      item: {
        id: itemId,
        type: 'agentMessage',
        text,
      },
    },
  });
}

function assertStartParams(message) {
  if (message.params.cwd !== process.env.PLATFORM_FAKE_CODEX_PROJECT) {
    fail(message.id, 'cwd was not normalized');
    return false;
  }
  if (message.params.model !== 'codex') {
    fail(message.id, 'model mismatch');
    return false;
  }
  if (message.params.approvalPolicy !== 'never') {
    fail(message.id, 'approval policy mismatch');
    return false;
  }
  if (message.params.sandbox !== 'danger-full-access') {
    fail(message.id, 'sandbox mismatch');
    return false;
  }
  if (message.params.serviceTier !== undefined && message.params.serviceTier !== 'fast') {
    fail(message.id, 'thread service tier mismatch');
    return false;
  }
  return true;
}

function assertTurnParams(message) {
  if (message.params.model !== 'codex') {
    fail(message.id, 'turn model mismatch');
    return false;
  }
  if (message.params.approvalPolicy !== 'never') {
    fail(message.id, 'turn approval policy mismatch');
    return false;
  }
  if (message.params.sandboxPolicy?.type !== 'dangerFullAccess') {
    fail(message.id, 'turn sandbox policy mismatch');
    return false;
  }
  if (message.params.serviceTier !== undefined && message.params.serviceTier !== 'fast') {
    fail(message.id, 'turn service tier mismatch');
    return false;
  }

  const input = Array.isArray(message.params.input) ? message.params.input : [];
  const image = input.find((item) => item.type === 'image');
  if (!image) return true;

  if (image.url !== 'data:image/png;base64,abc') {
    fail(message.id, 'image data URL was not passed to Codex');
    return false;
  }
  if (message.params.effort !== 'high') {
    fail(message.id, 'reasoning effort mismatch');
    return false;
  }
  if (message.params.serviceTier !== 'fast') {
    fail(message.id, 'fast mode mismatch');
    return false;
  }
  return true;
}

function sendChildEvents() {
  const child = { threadId: 'child-thread-1', turnId: 'child-turn-1' };
  const command = { id: 'child-command-1', type: 'commandExecution', command: 'rg absent missing', status: 'inProgress' };
  send({ method: 'item/started', params: { ...child, item: command } });
  send({ method: 'thread/status/changed', params: { ...child, status: { type: 'active', activeFlags: ['waitingOnApproval'] } } });
  send({ method: 'item/started', params: { threadId: 'provider-thread-1', turnId: fakeTurn().id, item: { id: 'spawn-1', type: 'subAgentActivity', agentThreadId: 'child-thread-1', agentPath: '/root/review', kind: 'started' } } });
  send({ method: 'thread/started', params: { thread: { ...fakeSession(), id: child.threadId, source: { subAgent: { thread_spawn: { parent_thread_id: 'provider-thread-1', agent_nickname: 'Reviewer', agent_role: 'explorer' } } } } } });
  send({ method: 'item/completed', params: { ...child, item: { ...command, status: 'failed', exitCode: 2, aggregatedOutput: 'rg: missing: No such file or directory' } } });
  send({ method: 'thread/tokenUsage/updated', params: { ...child, tokenUsage: { total: { totalTokens: 123, inputTokens: 100, outputTokens: 23 } } } });
  send({ method: 'thread/settings/updated', params: { ...child, threadSettings: { model: 'gpt-5.5', effort: 'high' } } });
  send({ method: 'thread/compacted', params: child });
  send({ method: 'item/agentMessage/delta', params: { ...child, itemId: 'child-message-1', delta: 'CHILD PRIVATE DELTA' } });
  send({ method: 'item/reasoning/summaryTextDelta', params: { ...child, itemId: 'child-reasoning-1', delta: 'Child thinking', summaryIndex: 0 } });
  send({ method: 'warning', params: { ...child, message: 'Child diagnostic remains observable' } });
  send({ id: 801, method: 'item/commandExecution/requestApproval', params: { ...child, itemId: command.id, command: command.command } });
  if (process.env.PLATFORM_FAKE_CODEX_MODE !== 'child-input-response') send({ method: 'serverRequest/resolved', params: { ...child, requestId: 801, decision: 'accept' } });
  send({ id: 802, method: 'item/tool/requestUserInput', params: { ...child, itemId: 'question-1', questions: [{ id: 'choice', header: 'Choice', question: 'Pick one', options: [{ label: 'One', description: 'First' }] }] } });
  if (process.env.PLATFORM_FAKE_CODEX_MODE !== 'child-input-response') send({ method: 'serverRequest/resolved', params: { ...child, requestId: 802 } });
  send({ method: 'error', params: { ...child, willRetry: true, error: { message: 'Retrying child' } } });
  send({ method: 'turn/completed', params: { threadId: child.threadId, turn: { id: child.turnId, status: 'completed', items: [] } } });
  send({ method: 'item/completed', params: { ...child, item: { id: 'late-child-command', type: 'commandExecution', command: 'pwd', status: 'completed', exitCode: 0 } } });
  send({ method: 'item/completed', params: { threadId: 'provider-thread-1', turnId: fakeTurn().id, item: { id: 'self-activity', type: 'subAgentActivity', agentThreadId: 'provider-thread-1', agentPath: '/root', kind: 'interacted' } } });
}

function sendOldTurnCompletion() {
  send({ method: 'turn/completed', params: { threadId: 'provider-thread-1', turn: { ...fakeTurn('completed'), id: 'provider-turn-1' } } });
}

function handleSteerStopSequence(message) {
  if (message.method === 'turn/start') {
    record({ event: 'turn/start' });
    turnStartCount += 1;
    const turn = fakeTurn('inProgress');
    if (turnStartCount === 1) {
      send({ method: 'turn/started', params: { threadId: 'child-thread-1', turn: { id: 'child-turn-1', status: 'inProgress', items: [] } } });
    }
    if (turnStartCount > 1) sendOldTurnCompletion();
    send({ method: 'turn/started', params: { threadId: 'provider-thread-1', turn } });
    if (turnStartCount > 1) sendOldTurnCompletion();
    send({ id: message.id, result: { turn } });
    return true;
  }
  if (message.method === 'turn/steer') {
    record({ event: 'turn/steer', params: message.params });
    send({ id: message.id, result: { turnId: fakeTurn().id } });
    return true;
  }
  if (message.method === 'turn/interrupt') {
    record({ event: 'turn/interrupt', params: message.params });
    send({ id: message.id, result: {} });
    send({ method: 'turn/completed', params: {
      threadId: message.params.threadId,
      turn: { id: message.params.turnId, status: 'interrupted', items: [] },
    } });
    return true;
  }
  return false;
}

function handle(message) {
  const mode = process.env.PLATFORM_FAKE_CODEX_MODE;
  const nativeProjection = mode === 'native-projection' || mode === 'native-projection-final-only';
  if (mode === 'steer-stop-late-completion' && handleSteerStopSequence(message)) return;
  if (!message.method && (message.id === 801 || message.id === 802)) {
    record({ event: 'server-response', ...message });
    return;
  }
  if (message.method === 'initialize') {
    send({
      id: message.id,
      result: {
        codexHome: '/Users/shaul/.codex',
        platformFamily: 'unix',
        platformOs: 'macos',
        userAgent: 'Codex Desktop/9.9.9 fake-test',
      },
    });
    return;
  }
  if (message.method === 'initialized') {
    return;
  }
  if (message.method === 'account/read') {
    send({ id: message.id, result: { account: { type: 'apiKey' }, requiresOpenaiAuth: false } });
    return;
  }
  if (message.method === 'model/list') {
    const model = mode === 'no-reasoning-efforts' ? fakeModelWithoutReasoningEfforts() : fakeModel();
    send({
      id: message.id,
      result: { data: [model], nextCursor: null },
    });
    return;
  }
  if (message.method === 'thread/start') {
    threadStartCount += 1;
    lastSessionStartParams = message.params;
    if (mode !== 'echo-mode-params' && !assertStartParams(message)) return;
    if (mode === 'stderr-diagnostics') {
      process.stderr.write('2026-09-07T05:01:30.819533Z ERROR codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit\\n');
    }
    if (mode === 'malformed-thread-start') {
      send({ id: message.id, result: { thread: {} } });
      return;
    }
    send({
      method: 'thread/started',
      params: { thread: fakeSession() },
    });
    send({
      id: message.id,
      result: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        cwd: '/Users/shaul/Desktop/platform',
        model: 'gpt-5.5',
        modelProvider: 'openai',
        sandbox: { type: 'dangerFullAccess' },
        thread: fakeSession(),
      },
    });
    return;
  }
  if (message.method === 'turn/start') {
    turnStartCount += 1;
    record({ event: 'turn/start' });
    if (mode !== 'echo-mode-params' && !assertTurnParams(message)) return;
    if (mode === 'hold-turn-start') return;
    process.stderr.write('2026-05-28T00:00:00Z INFO codex: harmless diagnostic\\n');
    if (mode === 'stderr-diagnostics') {
      process.stderr.write('2026-09-07T05:01:31Z ERROR codex_api::transport: failed to connect to websocket\\n');
      process.stderr.write('Authentication required: sign in again\\n');
    }
    if (mode === 'child-agents' || nativeProjection || mode === 'hold-native-turn') {
      send({ method: 'turn/started', params: { threadId: 'child-thread-1', turn: { id: 'child-turn-1', status: 'inProgress', items: [] } } });
    }
    send({
      method: 'turn/started',
      params: { threadId: 'provider-thread-1', turn: fakeTurn('inProgress') },
    });
    if (mode === 'child-agents' || mode === 'child-input-response' || nativeProjection) sendChildEvents();
    if (nativeProjection) {
      send({ method: 'turn/completed', params: { threadId: 'child-thread-1', turn: { id: 'child-turn-1', status: 'completed', items: [] } } });
    }
    if (mode === 'hold-native-turn') {
      send({ id: message.id, result: { turn: fakeTurn('inProgress') } });
      return;
    }
    if (mode === 'echo-mode-params') {
      const collaborationMode = message.params.collaborationMode ?? null;
      sendAgentMessageItemCompleted(
        'item-1',
        JSON.stringify({
          approvalsReviewer: message.params.approvalsReviewer ?? null,
          developerInstructions: collaborationMode?.settings?.developer_instructions ?? null,
          mode: collaborationMode?.mode ?? null,
          reasoningEffort: collaborationMode?.settings?.reasoning_effort ?? null,
          settingsModel: collaborationMode?.settings?.model ?? null,
          threadApprovalsReviewer: lastSessionStartParams?.approvalsReviewer ?? null,
          threadEphemeral: lastSessionStartParams?.ephemeral ?? null,
          threadPersistsExtendedHistory:
            lastSessionStartParams?.persistExtendedHistory ?? null,
          threadStarts: threadStartCount,
          turnDeveloperInstructions: message.params.developerInstructions ?? null,
        })
      );
      send({
        method: 'turn/completed',
        params: { threadId: 'provider-thread-1', turn: fakeTurn('completed') },
      });
      send({ id: message.id, result: { turn: fakeTurn('completed') } });
      return;
    }
    if (mode === 'echo-turn-params') {
      sendAgentMessageItemCompleted(
        'item-1',
        JSON.stringify({
          effort: message.params.effort ?? null,
          serviceTier: message.params.serviceTier ?? null,
        })
      );
      send({
        method: 'turn/completed',
        params: { threadId: 'provider-thread-1', turn: fakeTurn('completed') },
      });
      send({ id: message.id, result: { turn: fakeTurn('completed') } });
      return;
    }
    if (mode === 'root-status-and-failure') {
      send({ method: 'thread/status/changed', params: { threadId: 'provider-thread-1', status: { type: 'idle' } } });
      send({ method: 'item/completed', params: { threadId: 'provider-thread-1', turnId: fakeTurn().id, item: { id: 'root-failed-command', type: 'commandExecution', command: 'rg missing', status: 'failed', exitCode: 2 } } });
    }
    if (mode === 'reasoning-events') {
      sendReasoningEvents();
    }
    if (mode === 'retryable-error') {
      send({
        method: 'error',
        params: {
          threadId: 'provider-thread-1',
          turnId: fakeTurn().id,
          willRetry: true,
          error: { message: 'Connection interrupted. Retrying the request.' },
        },
      });
    }
    if (mode === 'token-usage') {
      send({
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: 'provider-thread-1',
          turnId: fakeTurn().id,
          tokenUsage: {
            last: {
              cachedInputTokens: 400,
              inputTokens: 1200,
              outputTokens: 300,
              reasoningOutputTokens: 100,
              totalTokens: 1600,
            },
            modelContextWindow: 272000,
            total: {
              cachedInputTokens: 800,
              inputTokens: 2400,
              outputTokens: 600,
              reasoningOutputTokens: 200,
              totalTokens: 3200,
            },
          },
        },
      });
    }
    if (mode === 'unknown-raw-item') {
      send({
        method: 'rawResponseItem/completed',
        params: {
          threadId: 'provider-thread-1',
          turnId: fakeTurn().id,
          item: { type: 'future_tool_call', id: 'raw-item-1' },
        },
      });
    }
    if (mode === 'malformed-delta') {
      send({
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'provider-thread-1',
          turnId: fakeTurn().id,
          itemId: 'item-1',
          delta: 123,
        },
      });
      send({ id: message.id, result: { turn: fakeTurn('inProgress') } });
      return;
    }
    if (mode === 'multi-agent-items') {
      send({
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'provider-thread-1',
          turnId: fakeTurn().id,
          itemId: 'item-1',
          delta: 'First item',
        },
      });
      sendAgentMessageItemCompleted('item-1', 'First item');
      send({
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'provider-thread-1',
          turnId: fakeTurn().id,
          itemId: 'item-2',
          delta: 'Second item',
        },
      });
      sendAgentMessageItemCompleted('item-2', 'Second item');
      send({
        method: 'turn/completed',
        params: { threadId: 'provider-thread-1', turn: fakeTurn('completed') },
      });
      send({ id: message.id, result: { turn: fakeTurn('completed') } });
      return;
    }
    if (mode !== 'native-projection-final-only') {
    send({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'provider-thread-1',
        turnId: fakeTurn().id,
        itemId: 'item-1',
        delta: 'Hello from app-server',
      },
    });
    }
    sendAgentMessageItemCompleted('item-1', 'Hello from app-server');
    send({
      method: 'turn/completed',
      params: { threadId: 'provider-thread-1', turn: fakeTurn('completed') },
    });
    send({ id: message.id, result: { turn: fakeTurn('completed') } });
    return;
  }
  if (message.method === 'turn/steer') {
    record({ event: 'turn/steer', params: message.params });
    send({ id: message.id, result: { turnId: fakeTurn().id } });
    sendAgentMessageItemCompleted('steered-message', 'Corrected reply');
    send({ method: 'turn/completed', params: { threadId: 'provider-thread-1', turn: fakeTurn('completed') } });
    return;
  }
  if (message.method === 'turn/interrupt') {
    record({ event: 'turn/interrupt', params: message.params });
    if (mode === 'hold-native-turn' && message.params.threadId === 'child-thread-1') {
      fail(message.id, 'Child already ended');
      return;
    }
    send({ id: message.id, result: {} });
    if (mode === 'hold-native-turn') {
      send({ method: 'turn/completed', params: { threadId: 'provider-thread-1', turn: fakeTurn('interrupted') } });
    }
    return;
  }
  if (message.method === 'skills/list') {
    record({ cwds: message.params && message.params.cwds, event: 'skills/list' });
    if (mode === 'skills-unavailable') {
      fail(message.id, 'unsupported method: skills/list');
      return;
    }
    // Real Codex answers one entry per requested cwd and falls back to its own
    // process directory when the list is empty.
    const listed = (message.params && message.params.cwds) || [process.cwd()];
    const parseFailure = {
      message: 'invalid YAML: name: invalid type: sequence, expected a string',
      path: listed[0] + '/.codex/skills/broken/SKILL.md',
    };
    if (mode === 'skills-all-broken') {
      send({
        id: message.id,
        result: { data: [{ cwd: listed[0], errors: [parseFailure], skills: [] }] },
      });
      return;
    }
    send({
      id: message.id,
      result: {
        data: [
          {
            cwd: listed[0],
            errors: mode === 'skills-partly-broken' ? [parseFailure] : [],
            skills: [
              {
                description: 'Project scoped skill',
                enabled: true,
                name: 'proj-skill',
                path: listed[0] + '/.codex/skills/proj-skill/SKILL.md',
                scope: 'repo',
              },
              {
                description: 'Turned off in the skills config',
                enabled: false,
                name: 'retired',
                path: '/home/skills/retired/SKILL.md',
                scope: 'user',
              },
              {
                description: 'No usable name',
                enabled: true,
                name: '   ',
                path: listed[0] + '/.codex/skills/nameless/SKILL.md',
                scope: 'repo',
              },
            ],
          },
          {
            cwd: '/another/project',
            errors: [],
            skills: [
              {
                description: 'Same skill, second directory',
                enabled: true,
                name: 'proj-skill',
                path: '/another/project/.codex/skills/proj-skill/SKILL.md',
                scope: 'repo',
              },
            ],
          },
        ],
      },
    });
    return;
  }
  if (message.method === 'thread/read') {
    if (process.env.PLATFORM_FAKE_CODEX_MODE === 'history') {
      record({ event: 'thread/read', ...message.params });
      send({ id: message.id, result: { thread: {
        ...fakeSession(),
        id: message.params.threadId,
        cwd: process.env.PLATFORM_FAKE_CODEX_PROJECT,
        turns: [{ ...fakeTurn('completed', [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: 'First paragraph' }, { type: 'text', text: 'Second paragraph' }, { type: 'image', url: 'image-url' }] },
          { id: 'reasoning-1', type: 'reasoning', summary: ['private reasoning'], content: [] },
          { id: 'new-tool-1', type: 'futureTool', unknownPayload: {} },
          { id: 'answer-1', type: 'agentMessage', text: 'The answer' },
        ]), startedAt: 1770000000, completedAt: 1770000001 }],
      } } });
      return;
    }
    send({
      id: message.id,
      result: {
        thread: fakeSession([
          fakeTurn('completed', [{ id: 'item-1', type: 'agentMessage', text: 'hello' }]),
        ]),
      },
    });
    return;
  }
  if (message.method === 'thread/list') {
    record({ event: 'thread/list', ...message.params });
    const offset = Number(message.params.cursor ?? 0);
    const all = [0, 1, 2].map((index) => ({
      ...fakeSession(),
      id: 'a6035591-a607-4a70-bc57-9b59f595b66' + index,
      cwd: message.params.cwd,
      name: 'Imported ' + index,
      updatedAt: 1770000000 - index,
    }));
    const data = all.slice(offset, offset + message.params.limit);
    const next = offset + data.length;
    send({ id: message.id, result: { data, nextCursor: next < all.length ? String(next) : null } });
    return;
  }
  if (message.method === 'thread/rollback') {
    if (message.params.numTurns !== 1) {
      fail(message.id, 'rollback numTurns mismatch');
      return;
    }
    send({
      id: message.id,
      result: {
        thread: fakeSession(),
      },
    });
    return;
  }
  fail(message.id, 'unsupported method: ' + message.method);
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  handle(JSON.parse(line));
});

setInterval(() => {}, 1000);
`

let fakeCodexLock: Promise<void> = Promise.resolve()

const RUNTIME_MODES = ['approval-required', 'auto-accept-edits', 'full-access'] as const

type FakeCodexContext = { readonly projectPath: string; readonly spawnLogPath: string }

type FakeCodexLogEntry = {
  readonly cwd?: string
  readonly cwds?: readonly string[] | null
  readonly event:
    | 'skills/list'
    | 'spawn'
    | 'turn/start'
    | 'turn/steer'
    | 'turn/interrupt'
    | 'server-response'
    | 'thread/list'
    | 'thread/read'
}

type EchoedModeParams = {
  approvalsReviewer: string | null
  developerInstructions: string | null
  mode: string | null
  reasoningEffort: string | null
  settingsModel: string | null
  threadApprovalsReviewer: string | null
  threadEphemeral: boolean | null
  threadPersistsExtendedHistory: boolean | null
  threadStarts: number
  turnDeveloperInstructions: string | null
}

describe('CodexProviderAdapter', () => {
  it('rejects malformed imported conversation text', () => {
    expect(
      v.safeParse(codexHistoryResponseSchema, {
        thread: {
          id: 'a6035591-a607-4a70-bc57-9b59f595b661',
          cwd: '/workspace',
          turns: [{ id: 'turn-1', items: [{ id: 'message-1', type: 'agentMessage', text: 42 }] }],
        },
      }).success,
    ).toBe(false)
  })

  it('imports local conversation metadata with cursor paging and reads text without resuming', async () => {
    await withFakeCodex(
      async ({ projectPath, spawnLogPath }) => {
        const adapter = new CodexProviderAdapter()
        const sessions = await adapter.discoverSessions({ cwd: projectPath, limit: 1, offset: 1 })
        expect(sessions).toEqual([
          {
            sessionId: 'a6035591-a607-4a70-bc57-9b59f595b661',
            cwd: projectPath,
            title: 'Imported 1',
            sourceUpdatedAt: '2026-02-02T02:39:59.000Z',
            gitBranch: null,
          },
        ])
        const sessionId = v.parse(sessionIdSchema, 'a6035591-a607-4a70-bc57-9b59f595b661')
        expect(await adapter.readSessionHistory({ sessionId, cwd: projectPath })).toEqual([
          {
            sourceId: 'provider-turn-1:user-1',
            role: 'user',
            text: 'First paragraph\n\nSecond paragraph',
            createdAt: '2026-02-02T02:40:00.000Z',
          },
          {
            sourceId: 'provider-turn-1:answer-1',
            role: 'assistant',
            text: 'The answer',
            createdAt: '2026-02-02T02:40:01.000Z',
          },
        ])
        const entries = await readFakeCodexLog(spawnLogPath)
        expect(entries.filter((entry) => entry.event === 'thread/list')).toEqual([
          expect.objectContaining({
            cwd: projectPath,
            limit: 1,
            sourceKinds: ['cli', 'vscode', 'appServer'],
            archived: false,
          }),
          expect.objectContaining({ cwd: projectPath, cursor: '1', limit: 1 }),
        ])
        expect(entries.filter((entry) => entry.event === 'thread/read')).toEqual([
          expect.objectContaining({ threadId: sessionId, includeTurns: true }),
        ])
        expect(await adapter.listActiveRuntimes()).toEqual([])
      },
      { mode: 'history' },
    )
  })

  it('starts a new process when the caller chooses a new runtime epoch', async () => {
    await withFakeCodex(async ({ spawnLogPath }) => {
      const adapter = new CodexProviderAdapter()
      const events: ProviderRuntimeEvent[] = []
      collectAdapterEvents(adapter, events)
      const first = providerTurnInput()
      try {
        await adapter.sendTurn(first)
        await adapter.sendTurn({
          ...first,
          turnId: v.parse(turnIdSchema, 'turn-epoch-2'),
          runtimeEpoch: 'replacement-epoch',
        })
        await settleRuntimeEvents()
        expect(await countFakeCodexSpawns(spawnLogPath)).toBe(2)
        expect(
          events
            .filter((event) => event.type === 'runtime.started')
            .map((event) => event.runtimeEpoch),
        ).toEqual([first.runtimeEpoch, 'replacement-epoch'])
      } finally {
        await adapter.stopAll()
      }
    })
  })

  it('keeps runtime ownership until the actual child exit acknowledgement', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const input = providerTurnInput()
        await adapter.startRuntime({ ...input })
        const stopping = adapter.stopRuntime({ sessionId: input.sessionId })
        expect(await adapter.hasRuntime({ sessionId: input.sessionId })).toBe(true)
        await stopping
        expect(await adapter.hasRuntime({ sessionId: input.sessionId })).toBe(false)
      },
      { mode: 'delayed-exit' },
    )
  })

  it('uses the app-server protocol and keeps early turn notifications', async () => {
    await withFakeCodex(async () => {
      const adapter = new CodexProviderAdapter()
      const events: ProviderRuntimeEvent[] = []
      const input = providerTurnInput()
      collectAdapterEvents(adapter, events)

      const snapshot = await adapter.snapshot()
      await adapter.sendTurn(input)
      await settleRuntimeEvents()
      const sessions = await adapter.listActiveRuntimes()
      const hasRuntime = await adapter.hasRuntime({ sessionId: input.sessionId })
      await adapter.stopRuntime({ sessionId: input.sessionId })
      const hasRuntimeAfterStop = await adapter.hasRuntime({ sessionId: input.sessionId })

      expect(adapter.capabilities).toEqual({
        listCommands: true,
        sessionModelSwitch: 'in-session',
      })
      expect(snapshot).toMatchObject({
        installed: true,
        status: 'ready',
        version: '9.9.9',
      })
      expect(snapshot.models[0]).toMatchObject({ slug: 'gpt-5.5' })
      // Efforts newer than the pinned protocol schema (`max`, `ultra`) and one
      // it has never heard of must reach the snapshot instead of emptying it.
      expect(snapshot.models[0]?.capabilities).toEqual({
        defaultReasoningEffort: 'medium',
        reasoningEfforts: [
          { description: 'Fastest responses', effort: 'low' },
          { description: 'Balanced', effort: 'medium' },
          { description: 'Deeper reasoning', effort: 'high' },
          { description: 'Even deeper reasoning', effort: 'xhigh' },
          { description: 'Maximum reasoning depth', effort: 'max' },
          { description: 'Maximum reasoning with delegation', effort: 'ultra' },
          { description: 'An effort level this schema predates', effort: 'hyperdrive' },
        ],
      })
      expect(hasRuntime).toBe(true)
      expect(hasRuntimeAfterStop).toBe(false)
      expect(sessions).toContainEqual(
        expect.objectContaining({
          model: 'codex',
          providerConversationMarker: 'provider-thread-1',
          status: 'ready',
          sessionId: input.sessionId,
        }),
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          itemId: 'item-1',
          payload: expect.objectContaining({
            delta: 'Hello from app-server',
            streamKind: 'assistant_text',
          }),
          sessionId: input.sessionId,
          turnId: input.turnId,
          type: 'content.delta',
        }),
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          itemId: 'item-1',
          payload: expect.objectContaining({
            detail: 'Hello from app-server',
            itemType: 'assistant_message',
            status: 'completed',
          }),
          sessionId: input.sessionId,
          turnId: input.turnId,
          type: 'item.completed',
        }),
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          payload: { state: 'completed' },
          sessionId: input.sessionId,
          turnId: input.turnId,
          type: 'turn.completed',
        }),
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          payload: { state: 'ready' },
          sessionId: input.sessionId,
          type: 'runtime.state.changed',
        }),
      )
    })
  })

  it('closing a session rejects a turn before Codex maps its provider turn id', async () => {
    await withFakeCodex(
      async ({ spawnLogPath }) => {
        const adapter = new CodexProviderAdapter()
        const input = providerTurnInput()
        const outcome = adapter.sendTurn(input).then(
          () => null,
          (error: unknown) => error,
        )

        await waitForFakeCodexEvent(spawnLogPath, 'turn/start')
        expect(await adapter.hasRuntime({ sessionId: input.sessionId })).toBe(true)
        await adapter.stopRuntime({ sessionId: input.sessionId })

        expect(await outcome).toBeInstanceOf(Error)
        expect(await adapter.hasRuntime({ sessionId: input.sessionId })).toBe(false)
      },
      { mode: 'hold-turn-start' },
    )
  })

  it('passes image data URLs and Codex model options to turn/start', async () => {
    await withFakeCodex(async () => {
      const adapter = new CodexProviderAdapter()
      const input = providerTurnInput()
      input.attachments = [
        {
          dataUrl: 'data:image/png;base64,abc',
          id: 'image-1',
          mimeType: 'image/png',
          name: 'screenshot.png',
          sizeBytes: 3,
          type: 'image',
        } as ProviderTurnInput['attachments'][number],
      ]
      input.modelSelection = {
        model: 'codex',
        options: {
          fastMode: true,
          reasoningEffort: 'high',
        },
        providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID as ProviderInstanceId,
      }

      await adapter.sendTurn(input)
      await adapter.stopAll()

      expect(await adapter.hasRuntime({ sessionId: input.sessionId })).toBe(false)
    })
  })

  it('relays the selected reasoning effort to turn/start verbatim', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const events: ProviderRuntimeEvent[] = []
        // `ultra` is past the end of the pinned protocol enum, so it also proves
        // no allowlist between the selection and the CLI silently downgrades it.
        const selected = providerTurnInput()
        selected.modelSelection = {
          model: 'codex',
          options: { reasoningEffort: 'ultra' },
          providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID as ProviderInstanceId,
        }
        const unselected = providerTurnInput()
        unselected.turnId = v.parse(turnIdSchema, 'turn-2')
        collectAdapterEvents(adapter, events)

        await adapter.sendTurn(selected)
        await settleRuntimeEvents()
        await adapter.sendTurn(unselected)
        await settleRuntimeEvents()
        await adapter.stopAll()

        const echoes = events.filter(
          (event) =>
            event.type === 'item.completed' && event.payload.itemType === 'assistant_message',
        )
        expect(echoes).toMatchObject([
          { payload: { detail: '{"effort":"ultra","serviceTier":null}' } },
          { payload: { detail: '{"effort":null,"serviceTier":null}' } },
        ])
      },
      { mode: 'echo-turn-params' },
    )
  })

  it('switches a live session into plan mode without restarting the Codex thread', async () => {
    await withFakeCodex(
      async ({ spawnLogPath }) => {
        const adapter = new CodexProviderAdapter()
        const events: ProviderRuntimeEvent[] = []
        const defaultTurn = providerTurnInput()
        const planTurn = providerTurnInput()
        planTurn.interactionMode = 'plan'
        planTurn.turnId = v.parse(turnIdSchema, 'turn-2')
        collectAdapterEvents(adapter, events)

        await adapter.sendTurn(defaultTurn)
        await settleRuntimeEvents()
        await adapter.sendTurn(planTurn)
        await settleRuntimeEvents()
        const sessions = await adapter.listActiveRuntimes()
        const spawns = await countFakeCodexSpawns(spawnLogPath)
        await adapter.stopAll()

        const [first, second] = echoedModeParams(events)
        expect(first?.mode).toBe('default')
        expect(first?.settingsModel).toBe('codex')
        expect(first?.developerInstructions).toContain('Collaboration Mode: Default')
        // No effort was selected, so Codex keeps the model's own default.
        expect(first?.reasoningEffort).toBeNull()
        // Codex ignores a top-level `developerInstructions` on turn/start; the
        // collaboration mode is the only channel that carries them.
        expect(first?.turnDeveloperInstructions).toBeNull()
        expect(second?.mode).toBe('plan')
        expect(second?.developerInstructions).toContain('Collaboration Mode: Plan')
        expect(second?.developerInstructions).toContain('Your output is a plan')
        // One app-server process and one thread/start across both turns: the
        // mode switch reconfigured the live session instead of replacing it and
        // dropping the conversation Codex holds.
        expect(spawns).toBe(1)
        expect(second?.threadStarts).toBe(1)
        expect(sessions).toHaveLength(1)
      },
      { mode: 'echo-mode-params' },
    )
  })

  it('disables provider transcript persistence only for ephemeral sessions', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const events: ProviderRuntimeEvent[] = []
        const normalTurn = providerTurnInput()
        const ephemeralTurn = providerTurnInput()
        ephemeralTurn.ephemeral = true
        ephemeralTurn.turnId = v.parse(turnIdSchema, 'turn-2')
        collectAdapterEvents(adapter, events)

        await adapter.sendTurn(normalTurn)
        await settleRuntimeEvents()
        await adapter.sendTurn(ephemeralTurn)
        await settleRuntimeEvents()
        await adapter.stopAll()

        const [normal, ephemeral] = echoedModeParams(events)
        expect(normal?.threadEphemeral).toBeNull()
        expect(normal?.threadPersistsExtendedHistory).toBe(true)
        expect(ephemeral?.threadEphemeral).toBe(true)
        expect(ephemeral?.threadPersistsExtendedHistory).toBe(false)
      },
      { mode: 'echo-mode-params' },
    )
  })

  it('sends approvalsReviewer on every turn so a mode switch cannot inherit it', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const events: ProviderRuntimeEvent[] = []
        const turns = RUNTIME_MODES.map((runtimeMode, index) => {
          const turn = providerTurnInput()
          turn.runtimeMode = runtimeMode
          turn.turnId = v.parse(turnIdSchema, `turn-${index + 1}`)
          return turn
        })
        collectAdapterEvents(adapter, events)

        for (const turn of turns) {
          await adapter.sendTurn(turn)
          await settleRuntimeEvents()
        }
        await adapter.stopAll()

        // Every runtime mode we ship reviews with the user. What matters is that
        // the field is spelled out each time: omit it and Codex keeps whichever
        // reviewer the session was last configured with.
        const echoes = echoedModeParams(events)
        expect(echoes.map((echo) => echo.approvalsReviewer)).toEqual(['user', 'user', 'user'])
        expect(echoes.map((echo) => echo.threadApprovalsReviewer)).toEqual(['user', 'user', 'user'])
      },
      { mode: 'echo-mode-params' },
    )
  })

  it('asks skills/list for the project directory instead of spawning inside it', async () => {
    await withFakeCodex(async ({ projectPath, spawnLogPath }) => {
      const adapter = new CodexProviderAdapter()

      await adapter.listCommands({ cwd: projectPath })
      const entries = await readFakeCodexLog(spawnLogPath)

      // The directory travels in the request, so the shared spawn helper stays
      // as narrow as every live session needs it to be: the app-server runs
      // where the server runs and still answers for the project.
      expect(entries.map((entry) => entry.cwds)).toContainEqual([projectPath])
      expect(entries.filter((entry) => entry.event === 'spawn').map((entry) => entry.cwd)).toEqual([
        process.cwd(),
      ])
    })
  })

  it('discovers skills in the project directory and offers no slash commands', async () => {
    await withFakeCodex(async ({ projectPath }) => {
      const adapter = new CodexProviderAdapter()

      const catalog = await adapter.listCommands({ cwd: projectPath })

      // Codex has no prompt or command listing at all, so the empty half of the
      // catalog is the honest answer rather than a read this skipped.
      expect(catalog.commands).toEqual([])
      // Skills come back scoped to the requested directory, which is how
      // `<cwd>/.codex/skills` is reachable at all. A disabled skill stays in the
      // list as unavailable, a nameless one is dropped, and the same name listed
      // for a second directory collapses into the first.
      expect(catalog.skills).toEqual([
        {
          description: 'Project scoped skill',
          enabled: true,
          name: 'proj-skill',
          path: `${projectPath}/.codex/skills/proj-skill/SKILL.md`,
          scope: 'repo',
        },
        {
          description: 'Turned off in the skills config',
          enabled: false,
          name: 'retired',
          path: '/home/skills/retired/SKILL.md',
          scope: 'user',
        },
      ])
    })
  })

  it('fails the skill read loudly and leaves the provider snapshot intact', async () => {
    await withFakeCodex(
      async ({ projectPath }) => {
        const adapter = new CodexProviderAdapter()

        await expect(adapter.listCommands({ cwd: projectPath })).rejects.toThrow('skills/list')
        const snapshot = await adapter.snapshot()

        // Discovery runs in its own app-server process precisely so a Codex
        // that cannot list skills still reports its account and models.
        expect(snapshot).toMatchObject({ installed: true, status: 'ready' })
        expect(snapshot.models[0]).toMatchObject({ slug: 'gpt-5.5' })
      },
      { mode: 'skills-unavailable' },
    )
  })

  it('refuses to call a directory of unreadable skills an empty catalog', async () => {
    await withFakeCodex(
      async ({ projectPath }) => {
        const adapter = new CodexProviderAdapter()

        // Every skill in the directory failed to parse. Answering with an empty
        // list would reach the composer as "this project has no skills", which
        // is the lie the loud failure path exists to prevent.
        await expect(adapter.listCommands({ cwd: projectPath })).rejects.toThrow(
          'Codex skills/list read no skills and 1 failed',
        )
        await expect(adapter.listCommands({ cwd: projectPath })).rejects.toThrow(
          '.codex/skills/broken/SKILL.md',
        )
      },
      { mode: 'skills-all-broken' },
    )
  })

  it('keeps the readable skills and puts the unreadable ones on the wide event', async () => {
    await withFakeCodex(
      async ({ projectPath }) => {
        const logDir = await realpath(await mkdtemp(path.join(tmpdir(), 'platform-codex-logs-')))
        initializeObservability({
          NODE_ENV: 'production',
          OBSERVABILITY_CONSOLE: 'false',
          OBSERVABILITY_DIR: logDir,
          OBSERVABILITY_ENABLED: 'true',
        })
        const adapter = new CodexProviderAdapter()

        try {
          const catalog = await adapter.listCommands({ cwd: projectPath })
          const event = await codexPipelineWarningEvent(
            logDir,
            'chat.pipeline.provider_commands.codex_skills',
          )

          // One broken file does not hide the 2 that parsed, and the failure is
          // still on the record with the path that caused it.
          expect(catalog.skills.map((skill) => skill.name)).toEqual(['proj-skill', 'retired'])
          expect(event).toMatchObject({
            cwd: projectPath,
            skillCount: 2,
            skillErrorCount: 1,
          })
          expect(JSON.stringify(event?.skillErrors)).toContain('.codex/skills/broken/SKILL.md')
          expect(JSON.stringify(event?.skillErrors)).toContain('invalid YAML')
        } finally {
          await resetObservabilityForTests()
          await rm(logDir, { force: true, recursive: true })
        }
      },
      { mode: 'skills-partly-broken' },
    )
  })

  it('reports no capabilities for a model that advertises no reasoning efforts', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const snapshot = await adapter.snapshot()

        expect(snapshot.models[0]).toMatchObject({ slug: 'gpt-5.5' })
        expect(snapshot.models[0]?.capabilities).toBeNull()
      },
      { mode: 'no-reasoning-efforts' },
    )
  })

  it.for([
    { delivery: 'streaming', mode: 'native-projection' },
    { delivery: 'buffered', mode: 'native-projection' },
    { delivery: 'streaming', mode: 'native-projection-final-only' },
  ] as const)(
    'projects a native Codex child session for browser handoff ($delivery, $mode)',
    async ({ delivery, mode }, { onTestFinished }) => {
      await withFakeCodex(
        async () => {
          const adapter = new CodexProviderAdapter()
          onTestFinished(() => adapter.stopAll())
          const input = {
            ...providerTurnInput(),
            sessionId: v.parse(sessionIdSchema, SESSION_ID),
            messageText: 'Review the workspace and report what you find.',
          }
          const projection = createNativeSessionProjection(input, delivery)
          onTestFinished(projection.close)
          const failures: unknown[] = []
          const assistantEvents: string[] = []
          adapter.subscribeEvents((event) => {
            if (event.type === 'content.delta' && event.payload.streamKind === 'assistant_text')
              assistantEvents.push(event.type)
            if (event.type === 'item.completed' && event.payload.itemType === 'assistant_message')
              assistantEvents.push(event.type)
            void projection.ingestion.ingest(event).catch((error) => failures.push(error))
          })
          await adapter.sendTurn(input)
          await projection.ingestion.drain()
          expect(failures).toEqual([])
          expect(assistantEvents).toEqual(
            mode === 'native-projection-final-only'
              ? ['item.completed']
              : ['content.delta', 'item.completed'],
          )
          const snapshot = projection.snapshot()
          const payloadSchema = v.object({
            agent: chatAgentSchema,
            tool: v.optional(chatAgentToolSchema),
          })
          const progress = snapshot.session.activities.flatMap((activity, index) => {
            if (activity.kind !== 'task.progress') return []
            const parsed = v.safeParse(payloadSchema, activity.payload)
            return parsed.success ? [{ index, ...parsed.output }] : []
          })
          const state = progress.find((row) => !row.tool)
          const tools = progress.filter((row) => row.tool)
          expect(tools.map((row) => row.tool?.itemType)).toEqual([
            'command_execution',
            'command_execution',
          ])
          expect(state).toMatchObject({ agent: { nickname: 'Reviewer', status: 'idle' } })
          expect(state?.index).toBeLessThan(tools[0]?.index ?? 0)
          expect(state?.agent.revision).toBeGreaterThan(tools[1]?.agent.revision ?? 0)
          expect(tools[0]?.agent.status).toBe('waiting')
          expect(snapshot.session.latestTurn?.state).toBe('completed')
          expect(snapshot.session.messages.map((message) => message.role)).toEqual([
            'user',
            'assistant',
          ])
          expect(
            snapshot.session.messages.find((message) => message.role === 'assistant'),
          ).toMatchObject({
            text: 'Hello from app-server',
            streaming: false,
          })
          const snapshotPath = process.env.PLATFORM_CHAT_PARITY_SNAPSHOT
          if (!snapshotPath || delivery !== 'streaming' || mode !== 'native-projection') return
          await mkdir(path.dirname(snapshotPath), { recursive: true })
          await writeFile(
            snapshotPath,
            JSON.stringify(
              {
                ...snapshot.session,
                proposedPlans: snapshot.proposedPlans,
                turnDiffSummaries: snapshot.checkpoints,
              },
              null,
              2,
            ),
          )
        },
        { mode },
      )
    },
  )

  it('keeps native child tools, lifecycle, tokens and pending requests under their owning parent turn', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const events: ProviderRuntimeEvent[] = []
        const input = providerTurnInput()
        collectAdapterEvents(adapter, events)
        await adapter.sendTurn(input)
        await settleRuntimeEvents()
        await adapter.stopAll()

        const tasks = events.filter(
          (event) => event.type === 'task.started' || event.type === 'task.progress',
        )
        expect(tasks.length).toBeGreaterThan(5)
        expect(tasks.map((event) => event.agent?.revision)).toEqual(
          tasks.map((_, index) => index + 1),
        )
        expect(
          tasks.every(
            (event) => event.turnId === input.turnId && event.agent?.threadId === 'child-thread-1',
          ),
        ).toBe(true)
        expect(tasks).toContainEqual(
          expect.objectContaining({
            type: 'task.progress',
            payload: expect.objectContaining({
              tool: expect.objectContaining({
                itemId: 'child-command-1',
                status: 'failed',
                data: expect.objectContaining({ exitCode: 2 }),
              }),
            }),
          }),
        )
        expect(tasks).toContainEqual(
          expect.objectContaining({
            agent: expect.objectContaining({
              nickname: 'Reviewer',
              role: 'explorer',
              model: 'gpt-5.5',
              effort: 'high',
            }),
            payload: expect.objectContaining({
              usage: { totalTokens: 123, inputTokens: 100, outputTokens: 23 },
            }),
          }),
        )
        expect(tasks.at(-1)).toMatchObject({
          agent: { status: 'idle' },
          payload: { tool: { itemId: 'late-child-command' } },
        })
        expect(events.filter((event) => event.type === 'turn.started')).toHaveLength(1)
        expect(events.filter((event) => event.type === 'turn.completed')).toMatchObject([
          { turnId: input.turnId, payload: { state: 'completed' } },
        ])
        expect(events.filter((event) => event.type === 'conversation.token-usage.updated')).toEqual(
          [],
        )
        expect(events.filter((event) => event.type === 'conversation.started')).toHaveLength(1)
        expect(events.filter((event) => event.type === 'content.delta')).toMatchObject([
          { turnId: input.turnId, payload: { delta: 'Hello from app-server' } },
        ])
        expect(events.some((event) => event.type === 'runtime.error')).toBe(false)
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'runtime.warning',
            agent: expect.objectContaining({ threadId: 'child-thread-1' }),
            payload: expect.objectContaining({ message: 'Child diagnostic remains observable' }),
          }),
        )
        const opened = events.find((event) => event.type === 'request.opened')
        const resolved = events.find((event) => event.type === 'request.resolved')
        expect(opened).toMatchObject({
          turnId: input.turnId,
          agent: { threadId: 'child-thread-1' },
        })
        expect(resolved).toMatchObject({
          requestId: opened?.requestId,
          turnId: input.turnId,
          agent: { threadId: 'child-thread-1' },
        })
        const question = events.find((event) => event.type === 'user-input.requested')
        expect(events.find((event) => event.type === 'user-input.resolved')).toMatchObject({
          requestId: question?.requestId,
          turnId: input.turnId,
          agent: { threadId: 'child-thread-1' },
        })
      },
      { mode: 'child-agents' },
    )
  })

  it('preserves native root idle status and failed tool verdicts', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const input = providerTurnInput()
        const events: ProviderRuntimeEvent[] = []
        collectAdapterEvents(adapter, events)
        await adapter.sendTurn(input)
        await settleRuntimeEvents()
        await adapter.stopAll()
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'conversation.state.changed',
            payload: expect.objectContaining({ state: 'idle' }),
          }),
        )
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'item.completed',
            itemId: 'root-failed-command',
            turnId: input.turnId,
            payload: expect.objectContaining({ status: 'failed' }),
          }),
        )
      },
      { mode: 'root-status-and-failure' },
    )
  })

  it('answers child approvals and questions using the original native request ids and Codex answer objects', async () => {
    await withFakeCodex(
      async ({ spawnLogPath }) => {
        const adapter = new CodexProviderAdapter()
        const input = providerTurnInput()
        const responses: Promise<void>[] = []
        adapter.subscribeEvents((event) => {
          if (event.type === 'request.opened' && event.requestId)
            responses.push(
              adapter.respondApproval({
                sessionId: input.sessionId,
                requestId: v.parse(approvalRequestIdSchema, event.requestId),
                decision: 'accept',
              }),
            )
          if (event.type === 'user-input.requested' && event.requestId)
            responses.push(
              adapter.respondUserInput({
                sessionId: input.sessionId,
                requestId: v.parse(approvalRequestIdSchema, event.requestId),
                answers: { choice: 'One', files: ['a.ts', 'b.ts'] },
              }),
            )
        })
        await adapter.sendTurn(input)
        await Promise.all(responses)
        await waitForFakeCodexEvent(spawnLogPath, 'server-response')
        await adapter.stopAll()
        const entries = await readFakeCodexLog(spawnLogPath)
        expect(entries.filter((entry) => entry.event === 'server-response')).toMatchObject([
          { id: 801, result: { decision: 'accept' } },
          {
            id: 802,
            result: {
              answers: { choice: { answers: ['One'] }, files: { answers: ['a.ts', 'b.ts'] } },
            },
          },
        ])
      },
      { mode: 'child-input-response' },
    )
  })

  it('steers only the current parent turn without creating a second turn', async () => {
    await withFakeCodex(
      async ({ spawnLogPath }) => {
        const adapter = new CodexProviderAdapter()
        const input = providerTurnInput()
        const started = Promise.withResolvers<void>()
        adapter.subscribeEvents((event) => {
          if (event.type === 'turn.started') started.resolve()
        })
        const running = adapter.sendTurn(input)
        await started.promise
        await expect(
          adapter.steerTurn({
            ...input,
            turnId: v.parse(turnIdSchema, 'wrong-turn'),
            messageText: 'Wrong target',
          }),
        ).rejects.toThrow('requested turn')
        await adapter.steerTurn({
          ...input,
          messageText: 'Focus on the second file',
          attachments: [],
        })
        await running
        await adapter.stopAll()
        const requests = await readFakeCodexLog(spawnLogPath)
        expect(requests.filter((entry) => entry.event === 'turn/start')).toHaveLength(1)
        expect(requests.find((entry) => entry.event === 'turn/steer')).toMatchObject({
          params: {
            threadId: 'provider-thread-1',
            expectedTurnId: 'provider-turn-1',
            input: [{ type: 'text', text: 'Focus on the second file' }],
          },
        })
      },
      { mode: 'hold-native-turn' },
    )
  })

  it('interrupts an unregistered live child and still reaches the parent when that child has ended', async () => {
    await withFakeCodex(
      async ({ spawnLogPath }) => {
        const adapter = new CodexProviderAdapter()
        const input = providerTurnInput()
        const started = Promise.withResolvers<void>()
        adapter.subscribeEvents((event) => {
          if (event.type === 'turn.started') started.resolve()
        })
        const running = adapter.sendTurn(input)
        await started.promise
        await adapter.interruptTurn(input)
        await running
        await adapter.stopAll()
        const requests = await readFakeCodexLog(spawnLogPath)
        expect(requests.filter((entry) => entry.event === 'turn/interrupt')).toMatchObject([
          { params: { threadId: 'child-thread-1', turnId: 'child-turn-1' } },
          { params: { threadId: 'provider-thread-1', turnId: 'provider-turn-1' } },
        ])
      },
      { mode: 'hold-native-turn' },
    )
  })

  it('keeps a later turn running after steering, Stop and delayed duplicate old completion', async ({
    onTestFinished,
  }) => {
    await withFakeCodex(
      async ({ spawnLogPath }) => {
        const adapter = new CodexProviderAdapter()
        onTestFinished(() => adapter.stopAll())
        const events: ProviderRuntimeEvent[] = []
        collectAdapterEvents(adapter, events)
        const first = providerTurnInput()
        const firstRun = adapter.sendTurn(first)
        void firstRun.catch(() => {})
        await expect
          .poll(() => events.filter((event) => event.type === 'turn.started'))
          .toHaveLength(1)
        await adapter.steerTurn({ ...first, messageText: 'Focus on the second file' })
        const firstRequests = await readFakeCodexLog(spawnLogPath)
        expect(firstRequests.filter((entry) => entry.event === 'turn/start')).toHaveLength(1)
        expect(firstRequests.find((entry) => entry.event === 'turn/steer')).toMatchObject({
          params: { threadId: 'provider-thread-1', expectedTurnId: 'provider-turn-1' },
        })
        await adapter.interruptTurn(first)
        await firstRun
        const second = { ...first, turnId: v.parse(turnIdSchema, 'turn-2') }
        const secondRun = adapter.sendTurn(second)
        void secondRun.catch(() => {})
        await expect
          .poll(() => events.filter((event) => event.type === 'turn.started'))
          .toMatchObject([
            { turnId: first.turnId, providerRefs: { providerTurnId: 'provider-turn-1' } },
            { turnId: second.turnId, providerRefs: { providerTurnId: 'provider-turn-2' } },
          ])
        await adapter.steerTurn({ ...second, messageText: 'Keep working on this turn' })
        expect(
          events.filter((event) => event.type === 'runtime.state.changed').at(-1),
        ).toMatchObject({
          turnId: second.turnId,
          payload: { state: 'running' },
        })
        expect(events.filter((event) => event.type === 'turn.completed')).toMatchObject([
          { turnId: first.turnId, payload: { state: 'interrupted' } },
        ])
        expect(events.filter((event) => event.type === 'assistant.complete')).toHaveLength(0)
        await adapter.interruptTurn(second)
        await secondRun
        await adapter.stopAll()
        const requests = await readFakeCodexLog(spawnLogPath)
        expect(requests.filter((entry) => entry.event === 'turn/start')).toHaveLength(2)
        expect(requests.filter((entry) => entry.event === 'turn/steer')).toMatchObject([
          { params: { threadId: 'provider-thread-1', expectedTurnId: 'provider-turn-1' } },
          { params: { threadId: 'provider-thread-1', expectedTurnId: 'provider-turn-2' } },
        ])
        expect(requests.filter((entry) => entry.event === 'turn/interrupt')).toMatchObject([
          { params: { threadId: 'child-thread-1', turnId: 'child-turn-1' } },
          { params: { threadId: 'provider-thread-1', turnId: 'provider-turn-1' } },
          { params: { threadId: 'provider-thread-1', turnId: 'provider-turn-2' } },
        ])
        expect(events.filter((event) => event.type === 'turn.completed')).toMatchObject([
          { turnId: first.turnId, payload: { state: 'interrupted' } },
          { turnId: second.turnId, payload: { state: 'interrupted' } },
        ])
      },
      { mode: 'steer-stop-late-completion' },
    )
  })

  it('streams Codex reasoning notifications as thinking progress', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const events: ProviderRuntimeEvent[] = []
        const input = providerTurnInput()
        collectAdapterEvents(adapter, events)

        await adapter.sendTurn(input)
        await settleRuntimeEvents()
        await adapter.stopAll()

        const progressEvents = events.filter((event) => event.type === 'task.progress')
        expect(progressEvents).toEqual([
          expect.objectContaining({
            payload: expect.objectContaining({
              description: 'Thinking',
              summary: 'Thinking',
              taskId: 'reasoning:reasoning-1',
            }),
            sessionId: input.sessionId,
            turnId: input.turnId,
            type: 'task.progress',
          }),
          expect.objectContaining({
            payload: expect.objectContaining({
              description: 'Inspecting the repo.',
              summary: 'Inspecting the repo.',
              taskId: 'reasoning:reasoning-1',
            }),
            sessionId: input.sessionId,
            turnId: input.turnId,
            type: 'task.progress',
          }),
        ])
      },
      { mode: 'reasoning-events' },
    )
  })

  it('shows retryable Codex errors as warnings while the turn continues to completion', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const events: ProviderRuntimeEvent[] = []
        const input = providerTurnInput()
        collectAdapterEvents(adapter, events)

        await adapter.sendTurn(input)
        await settleRuntimeEvents()
        await adapter.stopAll()

        expect(events).toContainEqual(
          expect.objectContaining({
            payload: expect.objectContaining({
              detail: expect.objectContaining({ willRetry: true }),
              message: 'Connection interrupted. Retrying the request.',
            }),
            sessionId: input.sessionId,
            turnId: input.turnId,
            type: 'runtime.warning',
          }),
        )
        expect(events.some((event) => event.type === 'runtime.error')).toBe(false)
        expect(events).toContainEqual(
          expect.objectContaining({
            payload: { state: 'completed' },
            turnId: input.turnId,
            type: 'turn.completed',
          }),
        )
      },
      { mode: 'retryable-error' },
    )
  })

  it('logs background Codex diagnostics without chat rows and preserves actionable stderr', async ({
    onTestFinished,
  }) => {
    const logDir = await mkdtemp('/work/tmp/platform-codex-stderr-')
    initializeObservability({
      NODE_ENV: 'production',
      OBSERVABILITY_CONSOLE: 'false',
      OBSERVABILITY_DIR: logDir,
      OBSERVABILITY_ENABLED: 'true',
    })
    onTestFinished(async () => {
      await resetObservabilityForTests()
      await rm(logDir, { force: true, recursive: true })
    })

    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        onTestFinished(() => adapter.stopAll())
        const events: ProviderRuntimeEvent[] = []
        collectAdapterEvents(adapter, events)
        await adapter.sendTurn(providerTurnInput())
        await settleRuntimeEvents()
        await adapter.stopAll()

        const warnings = events.flatMap((event) =>
          event.type === 'runtime.warning' ? [event.payload.message] : [],
        )
        expect(warnings).toEqual(
          expect.arrayContaining([
            '2026-09-07T05:01:31Z ERROR codex_api::transport: failed to connect to websocket',
            'Authentication required: sign in again',
          ]),
        )
        expect(warnings.some((warning) => warning.includes('codex_models_manager'))).toBe(false)
        expect(
          await codexPipelineWarningEvent(logDir, 'chat.pipeline.codex_process.stderr'),
        ).toMatchObject({
          diagnostic:
            '2026-09-07T05:01:30.819533Z ERROR codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit',
          processId: expect.any(Number),
        })
      },
      { mode: 'stderr-diagnostics' },
    )
  })

  it('reads token usage from the tokenUsage notification field', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const events: ProviderRuntimeEvent[] = []
        const input = providerTurnInput()
        collectAdapterEvents(adapter, events)

        await adapter.sendTurn(input)
        await settleRuntimeEvents()
        await adapter.stopAll()

        const usageEvents = events.filter(
          (event) => event.type === 'conversation.token-usage.updated',
        )
        expect(usageEvents).toEqual([
          expect.objectContaining({
            payload: {
              usage: {
                cachedInputTokens: 400,
                compactsAutomatically: true,
                inputTokens: 1200,
                maxTokens: 272000,
                outputTokens: 300,
                reasoningOutputTokens: 100,
                totalProcessedTokens: 3200,
                usedTokens: 1600,
              },
            },
            sessionId: input.sessionId,
            type: 'conversation.token-usage.updated',
          }),
        ])
      },
      { mode: 'token-usage' },
    )
  })

  it('preserves Codex assistant item boundaries for separate agent messages', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const events: ProviderRuntimeEvent[] = []
        const input = providerTurnInput()
        collectAdapterEvents(adapter, events)

        await adapter.sendTurn(input)
        await settleRuntimeEvents()
        await adapter.stopAll()

        const assistantDeltas = events.filter(
          (event) =>
            event.type === 'content.delta' && event.payload.streamKind === 'assistant_text',
        )
        const assistantCompletions = events.filter(
          (event) =>
            event.type === 'item.completed' && event.payload.itemType === 'assistant_message',
        )

        expect(assistantDeltas).toMatchObject([
          {
            itemId: 'item-1',
            payload: { delta: 'First item', streamKind: 'assistant_text' },
            type: 'content.delta',
          },
          {
            itemId: 'item-2',
            payload: { delta: 'Second item', streamKind: 'assistant_text' },
            type: 'content.delta',
          },
        ])
        expect(assistantCompletions).toMatchObject([
          { itemId: 'item-1', type: 'item.completed' },
          { itemId: 'item-2', type: 'item.completed' },
        ])
      },
      { mode: 'multi-agent-items' },
    )
  })

  it('fails rollback requests without an active session', async () => {
    const adapter = new CodexProviderAdapter()
    const input = providerTurnInput()

    await expect(
      adapter.rollbackSession({ numTurns: 1, sessionId: input.sessionId }),
    ).rejects.toThrow('Codex thread/rollback requires an active session')
    await expect(
      adapter.rollbackSession({ numTurns: 0, sessionId: input.sessionId }),
    ).rejects.toThrow('Codex thread rollback requires numTurns')
  })

  it('rejects malformed app-server responses with protocol errors', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const input = providerTurnInput()

        await expect(adapter.sendTurn(input)).rejects.toThrow(
          'Codex app-server protocol error for thread/start response',
        )
      },
      { mode: 'malformed-thread-start' },
    )
  })

  it('completes turns when unused raw notifications contain unfamiliar items', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const events: ProviderRuntimeEvent[] = []
        collectAdapterEvents(adapter, events)

        try {
          await adapter.sendTurn(providerTurnInput())
          expect(events).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ type: 'content.delta' }),
              expect.objectContaining({ type: 'turn.completed' }),
            ]),
          )
        } finally {
          await adapter.stopAll()
        }
      },
      { mode: 'unknown-raw-item' },
    )
  })

  it('rejects malformed app-server notifications with protocol errors', async () => {
    await withFakeCodex(
      async () => {
        const adapter = new CodexProviderAdapter()
        const input = providerTurnInput()

        await expect(adapter.sendTurn(input)).rejects.toThrow(
          'Codex app-server protocol error for item/agentMessage/delta notification',
        )
        await adapter.stopAll()
      },
      { mode: 'malformed-delta' },
    )
  })
})

async function withFakeCodex(
  run: (context: FakeCodexContext) => Promise<void>,
  options: { readonly mode?: string } = {},
) {
  const previousLock = fakeCodexLock
  let releaseLock: () => void = () => {}
  fakeCodexLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  await previousLock

  // Resolved through symlinks (`/var` -> `/private/var` on macOS) so a test can
  // compare `projectPath` against the working directory the child reports.
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'platform-fake-codex-')))
  const binaryPath = path.join(directory, 'codex')
  const projectPath = path.join(directory, 'project')
  const spawnLogPath = path.join(directory, 'spawns.log')
  const previousBinary = process.env.PLATFORM_CODEX_BINARY
  const previousMode = process.env.PLATFORM_FAKE_CODEX_MODE
  const previousProject = process.env.PLATFORM_FAKE_CODEX_PROJECT
  await writeFile(binaryPath, fakeCodexScript)
  await writeFile(spawnLogPath, '')
  await mkdir(projectPath)
  await chmod(binaryPath, 0o755)
  process.env.PLATFORM_CODEX_BINARY = binaryPath
  process.env.PLATFORM_FAKE_CODEX_PROJECT = projectPath
  process.env.PLATFORM_FAKE_CODEX_SPAWN_LOG = spawnLogPath
  if (options.mode) process.env.PLATFORM_FAKE_CODEX_MODE = options.mode

  try {
    await run({ projectPath, spawnLogPath })
  } finally {
    restoreCodexBinary(previousBinary)
    restoreFakeCodexMode(previousMode)
    if (previousProject === undefined) delete process.env.PLATFORM_FAKE_CODEX_PROJECT
    else process.env.PLATFORM_FAKE_CODEX_PROJECT = previousProject
    delete process.env.PLATFORM_FAKE_CODEX_SPAWN_LOG
    await rm(directory, { force: true, recursive: true })
    releaseLock()
  }
}

/** One line per fake app-server process, so a test can prove a session was reused. */
async function countFakeCodexSpawns(spawnLogPath: string) {
  const entries = await readFakeCodexLog(spawnLogPath)
  return entries.filter((entry) => entry.event === 'spawn').length
}

/** The one wide event the degraded skill read is allowed to produce. */
async function codexPipelineWarningEvent(logDir: string, action: string) {
  await flushObservability()
  const events: Record<string, unknown>[] = []
  for await (const event of readFsLogs({ dir: logDir })) {
    events.push(event as Record<string, unknown>)
  }

  return events.find((event) => event.action === action)
}

async function readFakeCodexLog(spawnLogPath: string) {
  const log = await readFile(spawnLogPath, 'utf8')
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeCodexLogEntry)
}

async function waitForFakeCodexEvent(spawnLogPath: string, event: FakeCodexLogEntry['event']) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const entries = await readFakeCodexLog(spawnLogPath)
    if (entries.some((entry) => entry.event === event)) return

    await new Promise((resolve) => setTimeout(resolve, 2))
  }

  expect.unreachable(`Fake Codex never received ${event}.`)
}

function collectAdapterEvents(adapter: CodexProviderAdapter, events: ProviderRuntimeEvent[]) {
  adapter.subscribeEvents((event) => {
    events.push(event)
  })
}

function echoedModeParams(events: ProviderRuntimeEvent[]) {
  const echoes: EchoedModeParams[] = []
  for (const event of events) {
    if (event.type !== 'item.completed') continue
    if (event.payload.itemType !== 'assistant_message') continue
    echoes.push(JSON.parse(String(event.payload.detail)) as EchoedModeParams)
  }

  return echoes
}

async function settleRuntimeEvents() {
  await Promise.resolve()
  await Promise.resolve()
}

function providerTurnInput(): ProviderTurnInput {
  const sessionId = v.parse(sessionIdSchema, 'ee84050b-1b17-5fe8-9f71-0983f1fceccc')
  const turnId = v.parse(turnIdSchema, 'turn-1')
  const modelSelection = {
    model: 'codex',
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID as ProviderInstanceId,
  }

  return {
    attachments: [],
    cwd: process.env.PLATFORM_FAKE_CODEX_PROJECT ?? process.cwd(),
    interactionMode: DEFAULT_INTERACTION_MODE,
    messageText: 'Say hello',
    modelSelection,
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    sessionId,
    runtimeEpoch: 'runtime-epoch',
    turnId,
  }
}

function restoreCodexBinary(previousBinary: string | undefined) {
  if (previousBinary === undefined) {
    delete process.env.PLATFORM_CODEX_BINARY
    return
  }

  process.env.PLATFORM_CODEX_BINARY = previousBinary
}

function restoreFakeCodexMode(previousMode: string | undefined) {
  if (previousMode === undefined) {
    delete process.env.PLATFORM_FAKE_CODEX_MODE
    return
  }

  process.env.PLATFORM_FAKE_CODEX_MODE = previousMode
}
