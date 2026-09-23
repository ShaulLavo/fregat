import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import source
from check import InvalidRecord
from evidence import digest
from run import execute, save_comparison

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
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "local.py").write_text("def archive(): return {'archived': True}\n")
        (self.root / "scenario.py").write_text("print('paired archive scenario')\n")

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
        with patch.object(source, "source", return_value=CONTENT):
            return source.check_operations(self.artifact, self.pin, self.upstream, self.local, self.root)

    def assert_invalid(self, message):
        with self.assertRaisesRegex(InvalidRecord, message):
            self.check()

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

    def reviewed(self):
        row = self.artifact["operations"][0]
        row.update(
            review="source-reviewed", reason="Archive entry points and failure behavior reviewed.",
            upstreamAnchors=[{"path": source.COMMAND_PATH, "contains": 'type: Schema.Literal("thread.archive")'}],
            localMapping={
                "entryPoints": [{"path": "local.py", "contains": "def archive()"}],
                "owner": "session lifecycle", "capability": "session archive",
                "defaults": "archive is explicit", "results": "archived event",
                "navigation": "session disappears from active rail", "persistence": "server stores archived flag",
                "negativePaths": "missing session is rejected",
            },
            scenarios=[{"id": "archive", "runner": "scenario.py", "command": ["python3", "scenario.py"],
                        "cases": ["archive-idle"]}],
        )
        return row

    def verified(self):
        row = self.reviewed()
        comparison = save_comparison(
            self.root, "evidence", row["id"], self.pin, row["scenarios"][0],
            [{"path": path, "sha256": digest(self.root / path)} for path in ("scenario.py", "local.py")],
            {"cases": [{"id": "archive-idle", "upstream": True, "local": True}],
             "negativeControls": [{"id": "archive-disabled", "result": "rejected", "caseId": "archive-idle", "output": {"archived": False}}]},
        )
        row.update(review="runtime-verified", runtimeComparisons=[comparison])
        return row

    def test_source_review_maps_behavior_without_claiming_runtime_verification(self):
        row = self.reviewed()
        self.assertEqual(self.check(), 3)
        self.assertEqual(row["review"], "source-reviewed")

    def test_missing_source_anchor_fails(self):
        row = self.reviewed()
        row["upstreamAnchors"][0]["contains"] = "invented upstream function"
        with self.assertRaisesRegex(InvalidRecord, "source anchor absent"):
            self.check()

    def test_missing_local_anchor_fails(self):
        row = self.reviewed()
        row["localMapping"]["entryPoints"][0]["contains"] = "invented local function"
        with self.assertRaisesRegex(InvalidRecord, "source anchor absent"):
            self.check()

    def test_review_requires_behavior_dimensions_and_executable_cases(self):
        row = self.reviewed()
        valid = copy.deepcopy(row)
        changes = (
            (lambda value: value.update(upstreamAnchors=[]), "missing source anchors"),
            (lambda value: value["localMapping"].update(defaults=""), "defaults"),
            (lambda value: value["localMapping"].update(negativePaths=""), "negativePaths"),
            (lambda value: value.update(scenarios=[]), "missing executable scenarios"),
            (lambda value: value["scenarios"][0].update(cases=[]), "missing cases"),
            (lambda value: value["scenarios"][0].update(runner="absent.py"), "Missing comparison artifact"),
            (lambda value: value["scenarios"][0].update(command=["python3", "local.py"]), "invoke its runner"),
        )
        for change, message in changes:
            with self.subTest(message=message):
                row.clear()
                row.update(copy.deepcopy(valid))
                change(row)
                self.assert_invalid(message)

    def test_valid_runtime_comparison_can_close_a_mapped_operation(self):
        self.verified()
        self.assertEqual(self.check(), 3)

    def test_runtime_label_requires_reports(self):
        self.reviewed()["review"] = "runtime-verified"
        with self.assertRaisesRegex(InvalidRecord, "missing runtime comparisons"):
            self.check()

    def test_source_review_cannot_hide_runtime_claims(self):
        self.verified()["review"] = "source-reviewed"
        with self.assertRaisesRegex(InvalidRecord, "source review cannot claim runtime evidence"):
            self.check()

    def test_changed_scenario_requires_new_comparison(self):
        self.verified()["scenarios"][0]["command"].append("--different-mode")
        with self.assertRaisesRegex(InvalidRecord, "executable scenario mismatch"):
            self.check()

    def test_each_scenario_needs_a_comparison(self):
        row = self.verified()
        other = dict(row["scenarios"][0], id="archive-reload")
        row["scenarios"].append(other)
        with self.assertRaisesRegex(InvalidRecord, "runtime scenario coverage mismatch"):
            self.check()

    def test_changed_local_source_invalidates_runtime_evidence(self):
        self.verified()
        (self.root / "local.py").write_text("def archive(): return {'archived': False}\n")
        with self.assertRaisesRegex(InvalidRecord, "Artifact content changed: local.py"):
            self.check()

    def test_runtime_report_must_snapshot_mapped_local_entry_points(self):
        self.verified()
        path = self.root / "evidence/comparison.json"
        report = json.loads(path.read_text())
        report["sources"] = [snapshot for snapshot in report["sources"] if snapshot["path"] != "local.py"]
        path.write_text(json.dumps(report))
        with self.assertRaisesRegex(InvalidRecord, "omits executable or local source"):
            self.check()

    def test_runner_executes_scenario_and_checks_paired_output(self):
        row = self.reviewed()
        script = self.root / "scenario.py"
        script.write_text(
            "import json, os\nfrom local import archive\n"
            "print(json.dumps({'upstreamCommit': os.environ['PARITY_UPSTREAM_COMMIT'], "
            "'cases': [{'id': 'archive-idle', 'upstream': {'archived': True}, 'local': archive()}], "
            "'negativeControls': [{'id': 'archive-disabled', 'result': 'rejected', 'caseId': 'archive-idle', 'output': {'archived': False}}]}))\n"
        )
        payload = execute(self.root, row["scenarios"][0], self.pin, row["id"], 10)
        self.assertEqual(payload["cases"][0]["local"], {"archived": True})
        (self.root / "local.py").write_text("def archive(): return {'archived': False}\n")
        with self.assertRaisesRegex(InvalidRecord, "observed outputs differ"):
            execute(self.root, row["scenarios"][0], self.pin, row["id"], 10)

    def test_runner_rejects_stale_pin_missing_cases_and_surviving_controls(self):
        row = self.reviewed()
        valid = {"upstreamCommit": self.pin, "cases": [{"id": "archive-idle", "upstream": True, "local": True}],
                 "negativeControls": [{"id": "disabled", "result": "rejected", "caseId": "archive-idle", "output": {"archived": False}}]}
        changes = (
            ({"upstreamCommit": "b" * 40}, "stale upstream pin"),
            ({"cases": []}, "no cases"),
            ({"negativeControls": [{"id": "disabled", "result": "survived"}]}, "not rejected"),
        )
        for change, message in changes:
            payload = dict(valid, **change)
            (self.root / "scenario.py").write_text(f"print({json.dumps(payload)!r})\n")
            with self.assertRaisesRegex(InvalidRecord, message):
                execute(self.root, row["scenarios"][0], self.pin, row["id"], 10)


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

    def test_runner_cli_writes_reports_that_close_only_declared_cases(self):
        pin = self.inventory["upstream_commit"]
        upstream = source.pinned_census(self.root, self.inventory)
        local = {"client": ["session.archive"], "internal": ["session.activity.append"]}
        artifact = source.initial_artifact(pin, upstream, local)
        row = artifact["operations"][0]
        scenario = {"id": "archive", "runner": "scenario.py", "command": ["python3", "scenario.py"],
                    "cases": ["archive-idle"]}
        row.update(
            review="source-reviewed", upstreamAnchors=[{"path": source.COMMAND_PATH, "contains": '"thread.archive"'}],
            localMapping={
                "entryPoints": [{"path": "scenario.py", "contains": "json.dumps"}],
                **{field: "bounded test mapping" for field in
                   ("owner", "capability", "defaults", "results", "navigation", "persistence", "negativePaths")},
            }, scenarios=[scenario],
        )
        script = self.root / "scenario.py"
        payload = {"upstreamCommit": pin, "cases": [{"id": "archive-idle", "upstream": True, "local": True}],
                   "negativeControls": [{"id": "disabled", "caseId": "archive-idle", "output": False, "result": "rejected"}]}
        script.write_text(f"import json\nprint(json.dumps({payload!r}))\n")
        inventory_path = self.root / "plans/126-t3code-alignment/inventory.json"
        inventory_path.parent.mkdir(parents=True)
        inventory_path.write_text(json.dumps(self.inventory))
        artifact_path = self.root / source.ARTIFACT
        artifact_path.parent.mkdir(parents=True)
        artifact_path.write_text(json.dumps(artifact))
        command = ["python3", "-B", str(Path(__file__).with_name("run.py")), "--root", str(self.root),
                   "--reference", str(self.root), "--operation", row["id"], "--scenario", "archive"]
        check = subprocess.check_output([*command, "--check"], text=True)
        self.assertIn("Matched 1 case groups", check)
        self.assertFalse((self.root / "evidence").exists())
        comparison = json.loads(subprocess.check_output([*command, "--output", "evidence"], text=True))
        self.assertEqual(json.loads(artifact_path.read_text())["operations"][0]["review"], "source-reviewed")
        row.update(review="runtime-verified", runtimeComparisons=[comparison])
        self.assertEqual(source.check_operations(artifact, pin, upstream, local, self.root, self.root), 4)
        repeat = subprocess.run([*command, "--output", "evidence"], capture_output=True, text=True)
        self.assertNotEqual(repeat.returncode, 0)
        self.assertIn("already exists", repeat.stderr)

    def test_source_review_anchors_read_the_pinned_object(self):
        pin = self.inventory["upstream_commit"]
        (self.root / source.COMMAND_PATH).write_text("changed working tree")
        source.check_anchors([{"path": source.COMMAND_PATH, "contains": '"thread.archive"'}],
                             lambda path: source.source(self.root, pin, path), "archive")


if __name__ == "__main__":
    unittest.main()
