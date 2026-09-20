import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import source
from check import InvalidRecord

CONTENT = '''
const Archive = Schema.Struct({
  type: Schema.Literal("thread.archive"),
});
const Activity = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
});
const Attachment = Schema.Struct({
  type: Schema.Literal("file"),
});
export const ClientOrchestrationCommand = Schema.Union([
  Archive,
]);
const InternalOrchestrationCommand = Schema.Union([
  Activity,
  Activity,
]);
export const ORCHESTRATION_WS_METHODS = {
  dispatch: "orchestration.dispatch",
} as const;
'''


class OperationTests(unittest.TestCase):
    def setUp(self):
        self.upstream = {"rpc": ["orchestration.dispatch"], "commands": source.upstream_commands(CONTENT)}
        self.local = {"client": ["session.archive"], "internal": ["session.activity.append"]}
        self.pin = "a" * 40
        self.artifact = copy.deepcopy(source.initial_artifact(self.pin, self.upstream, self.local))

    def test_classification_uses_union_membership_and_deduplicates_members(self):
        self.assertEqual(self.upstream["commands"], {
            "client": {"Archive": "thread.archive"},
            "internal": {"Activity": "thread.activity.append"},
        })
        self.assertNotIn("file", json.dumps(self.upstream))

    def test_unresolved_union_member_fails_closed(self):
        changed = CONTENT.replace("  Archive,", "  Unknown,")
        with self.assertRaisesRegex(InvalidRecord, "Cannot classify upstream command"):
            source.upstream_commands(changed)

    def test_unhandled_union_syntax_fails_closed(self):
        changed = CONTENT.replace("  Archive,", "  ...OtherCommands,")
        with self.assertRaisesRegex(InvalidRecord, "Unsupported union shape"):
            source.upstream_commands(changed)

    def check(self):
        return source.check_operations(self.artifact, self.pin, self.upstream, self.local)

    def test_unknown_mapping_rows_pass_without_equivalence(self):
        self.assertEqual(self.check(), 3)
        self.assertTrue(all(row["localMapping"] is None for row in self.artifact["operations"]))

    def test_missing_operation_row_fails(self):
        self.artifact["operations"].pop()
        with self.assertRaisesRegex(InvalidRecord, "Missing or unknown operation"):
            self.check()

    def test_new_upstream_operation_fails(self):
        self.upstream["rpc"].append("orchestration.new")
        with self.assertRaisesRegex(InvalidRecord, "Upstream operation census drift"):
            self.check()

    def test_new_local_command_fails(self):
        self.local["client"].append("session.new")
        with self.assertRaisesRegex(InvalidRecord, "Local command census drift"):
            self.check()

    def test_pin_change_fails(self):
        self.artifact["upstreamCommit"] = "b" * 40
        with self.assertRaisesRegex(InvalidRecord, "pin drift"):
            self.check()

    def test_duplicate_row_fails(self):
        self.artifact["operations"].append(copy.deepcopy(self.artifact["operations"][0]))
        with self.assertRaisesRegex(InvalidRecord, "Duplicate operation row"):
            self.check()

    def test_invented_mapping_fails(self):
        self.artifact["operations"][0]["localMapping"] = "same-name-means-same-behavior"
        with self.assertRaisesRegex(InvalidRecord, "cannot claim equivalence"):
            self.check()


class PinnedSourceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        contracts = self.root / "packages/contracts/src"
        contracts.mkdir(parents=True)
        (contracts / "orchestration.ts").write_text(CONTENT)
        (contracts / "rpc.ts").write_text('export const WS_METHODS = {\n  read: "read.get",\n} as const;\n')
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "-qm", "fixture")
        pin = self.git("rev-parse", "HEAD")
        self.inventory = {
            "upstream_commit": pin,
            "upstream_rpc_methods": ["orchestration.dispatch", "read.get"],
            "upstream_contract_blobs": {
                f"packages/contracts/src/{name}.ts": self.git("rev-parse", f"{pin}:packages/contracts/src/{name}.ts")
                for name in ("orchestration", "rpc")
            },
        }

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], text=True).strip()

    def test_reads_pinned_git_objects_instead_of_working_tree(self):
        (self.root / "packages/contracts/src/orchestration.ts").write_text("unrelated working tree")
        census = source.pinned_census(self.root, self.inventory)
        self.assertEqual(census["commands"]["client"], {"Archive": "thread.archive"})

    def test_source_blob_mismatch_fails_even_with_unchanged_method_names(self):
        self.inventory["upstream_contract_blobs"]["packages/contracts/src/rpc.ts"] = "b" * 40
        with self.assertRaisesRegex(InvalidRecord, "Pinned contract source drift"):
            source.pinned_census(self.root, self.inventory)

    def test_changed_rpc_inventory_fails(self):
        self.inventory["upstream_rpc_methods"].append("new.operation")
        with self.assertRaisesRegex(InvalidRecord, "RPC inventory drift"):
            source.pinned_census(self.root, self.inventory)


if __name__ == "__main__":
    unittest.main()
