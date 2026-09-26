import { sql } from 'drizzle-orm'
import type { PlatformDatabase } from '../../client'
import { OrchestrationEventStore } from '../../../orchestration/event-store'
import {
  domainBootstrap,
  domainEvent,
  DOMAIN_AT,
  DOMAIN_IDS,
  DOMAIN_MODEL,
} from '../../../orchestration/tests/factories/session-domain'

export const RETIRED_WORKTREE = 'cffec34e-584c-47ab-b463-970786beb218'

export function seedVersion11Worktrees(database: PlatformDatabase) {
  const events = domainBootstrap()
  const sessionCreated = events[2]
  if (!sessionCreated || sessionCreated.type !== 'session.created')
    throw new TypeError('Missing session fixture')
  events[2] = { ...sessionCreated, payload: { ...sessionCreated.payload, origin: 'discovered' } }
  events.push(
    domainEvent('session.deleted', { sessionId: DOMAIN_IDS.session, deletedAt: DOMAIN_AT }, 4),
    domainEvent(
      'session.deletion-updated',
      {
        sessionId: DOMAIN_IDS.session,
        deletion: {
          deletionSequence: 4,
          providerStop: 'no-binding',
          providerStopError: null,
          blobCleanup: 'completed',
          blobCleanupError: null,
          updatedAt: DOMAIN_AT,
        },
      },
      5,
    ),
    domainEvent(
      'worktree.registered',
      {
        worktreeId: RETIRED_WORKTREE,
        projectId: DOMAIN_IDS.project,
        registrationGeneration: 0,
        canonicalPath: '/retired-fixture',
        path: '/retired-fixture',
        branch: null,
        kind: 'linked',
        ownership: 'external',
        createdAt: DOMAIN_AT,
        updatedAt: DOMAIN_AT,
        retiredAt: null,
      },
      6,
    ),
    domainEvent('worktree.retired', { worktreeId: RETIRED_WORKTREE, retiredAt: DOMAIN_AT }, 7),
    domainEvent(
      'worktree.meta-updated',
      { worktreeId: DOMAIN_IDS.worktree, branch: 'historical-branch', updatedAt: DOMAIN_AT },
      8,
    ),
  )
  new OrchestrationEventStore(database).append(events)
  database.run(
    sql`INSERT INTO projection_projects (project_id,title,repository_key,repository_kind,repository_identity_json,default_model_selection_json,created_at,updated_at) VALUES (${DOMAIN_IDS.project},'Fixture','fixture-repository','directory',${JSON.stringify({ source: 'path', canonical: '/fixture' })},${JSON.stringify(DOMAIN_MODEL)},${DOMAIN_AT},${DOMAIN_AT})`,
  )
  database.run(
    sql`INSERT INTO projection_worktrees (worktree_id,project_id,registration_generation,canonical_path,path,branch,kind,ownership,created_at,updated_at) VALUES (${DOMAIN_IDS.worktree},${DOMAIN_IDS.project},0,'/fixture','/fixture','historical-branch','current','protected',${DOMAIN_AT},${DOMAIN_AT})`,
  )
  database.run(
    sql`INSERT INTO projection_worktrees (worktree_id,project_id,registration_generation,canonical_path,path,kind,ownership,created_at,updated_at,retired_at,retirement_sequence) VALUES (${RETIRED_WORKTREE},${DOMAIN_IDS.project},0,'/retired-fixture','/retired-fixture','linked','external',${DOMAIN_AT},${DOMAIN_AT},${DOMAIN_AT},7)`,
  )
  database.run(
    sql`INSERT INTO projection_sessions (session_id,worktree_id,origin,attention_state,title,runtime_mode,interaction_mode,model_selection_json,created_at,updated_at,deleted_at,deletion_sequence,provider_stop_state,blob_cleanup_state,deletion_updated_at) VALUES (${DOMAIN_IDS.session},${DOMAIN_IDS.worktree},'discovered','settled','Session','full-access','default',${JSON.stringify(DOMAIN_MODEL)},${DOMAIN_AT},${DOMAIN_AT},${DOMAIN_AT},4,'no-binding','completed',${DOMAIN_AT})`,
  )
  database.run(
    sql`INSERT INTO projection_state (projector,last_applied_sequence,updated_at) VALUES ('orchestration',8,${DOMAIN_AT})`,
  )
  database.run(
    sql`INSERT INTO orchestration_command_receipts (command_id,command_type,aggregate_kind,aggregate_id,accepted_at,result_sequence,status,command_json,intent_fingerprint) VALUES ('historical-receipt','worktree.meta.update','worktree',${DOMAIN_IDS.worktree},${DOMAIN_AT},8,'accepted','{}','historical-intent')`,
  )
}

export function resetWorktreeProjections(database: PlatformDatabase) {
  for (const table of [
    'projection_session_messages',
    'projection_session_activities',
    'projection_session_runtime',
    'projection_session_proposed_plans',
    'projection_session_checkpoints',
    'projection_turns',
    'projection_sessions',
    'projection_terminal_leases',
    'projection_worktrees',
    'projection_projects',
    'projection_state',
  ])
    database.run(sql.raw(`DELETE FROM ${table}`))
}
