import { expectTypeOf } from 'vitest'
import type * as v from 'valibot'
import type {
  WorkspaceEditPrepareRequest,
  WorkspaceEditRecoverRequest,
  WorkspaceEditReleaseRequest,
  WorkspaceEditResult,
  WorkspaceEditTransitionRequest,
  WorkspacePersistenceOperation,
  WorkspaceResourcePrecondition,
} from '@workspace/contracts'
import type {
  WorkspaceEditPrepareBody,
  WorkspaceEditRecoverBody,
  WorkspaceEditReleaseBody,
  WorkspaceEditTransitionBody,
  workspaceEditResultSchema,
  workspacePersistenceOperationSchema,
} from '../contracts'

type Operation = v.InferOutput<typeof workspacePersistenceOperationSchema>
type Precondition = Extract<Operation, { kind: 'delete' }>['expected']

expectTypeOf<WorkspaceEditPrepareBody>().toExtend<WorkspaceEditPrepareRequest>()
expectTypeOf<WorkspaceEditTransitionBody>().toExtend<WorkspaceEditTransitionRequest>()
expectTypeOf<WorkspaceEditRecoverBody>().toExtend<WorkspaceEditRecoverRequest>()
expectTypeOf<WorkspaceEditReleaseBody>().toExtend<WorkspaceEditReleaseRequest>()
expectTypeOf<Operation>().toExtend<WorkspacePersistenceOperation>()
expectTypeOf<Precondition>().toExtend<WorkspaceResourcePrecondition>()
expectTypeOf<v.InferOutput<typeof workspaceEditResultSchema>>().toExtend<WorkspaceEditResult>()
