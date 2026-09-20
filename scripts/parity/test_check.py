import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("parity_check", Path(__file__).with_name("check.py"))
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)
PIN = "a" * 40


class RecordTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.directory = self.root / "plans/126-t3code-alignment"
        self.directory.mkdir(parents=True)
        for report in checker.REPORTS:
            (self.directory / report).write_text("")
        (self.directory / "lifecycle.md").write_text("### LIFE-01: Archive policy\n")
        self.finding = {
            "id": "LIFE-01", "title": "Archive policy", "report": "lifecycle.md",
            "wave": "1", "status": "in-progress", "evidence_level": "source-derived",
            "acceptance": "archive remains authoritative", "execution_evidence": [],
        }
        self.inventory = {
            "upstream_commit": PIN,
            "upstream_contracts": {"contract.ts": ["Archive"]},
            "upstream_contract_blobs": {"contract.ts": "b" * 40},
            "upstream_rpc_methods": ["orchestration.dispatch"],
            "upstream_type_discriminants": ["file", "thread.archive"],
            "platform_command_discriminants": ["session.archive"],
        }
        self.write("inventory.json", self.inventory)
        self.write("coverage.json", {"contracts": {
            "contract.ts": {"findings": ["LIFE-01"], "review_state": "domain-assigned"}
        }})
        self.save_finding()

    def write(self, name, value):
        (self.directory / name).write_text(json.dumps(value))

    def save_finding(self):
        self.write("ledger.json", {"findings": [self.finding]})

    def assert_invalid(self, message):
        with self.assertRaisesRegex(checker.InvalidRecord, message):
            checker.check(self.root)

    def test_incomplete_records_pass_without_becoming_verified(self):
        before = (self.directory / "ledger.json").read_bytes()
        result = checker.check(self.root)
        self.assertIn("1 unverified", result)
        self.assertIn("Behavioral parity remains unproven", result)
        self.assertIn("not a command inventory", result)
        self.assertEqual(before, (self.directory / "ledger.json").read_bytes())

    def test_missing_contract_assignment_fails(self):
        self.write("coverage.json", {"contracts": {}})
        self.assert_invalid("Contract coverage")

    def test_duplicate_rpc_method_fails(self):
        self.inventory["upstream_rpc_methods"] *= 2
        self.write("inventory.json", self.inventory)
        self.assert_invalid("Duplicate upstream_rpc_methods")

    def test_missing_ledger_finding_fails(self):
        self.write("ledger.json", {"findings": []})
        self.assert_invalid("Ledger/report")

    def test_stale_title_fails(self):
        self.finding["title"] = "Old archive policy"
        self.save_finding()
        self.assert_invalid("stale title")

    def test_source_derived_evidence_cannot_verify_finding(self):
        self.finding.update(status="verified", execution_evidence=["some-test.ts"])
        self.save_finding()
        self.assert_invalid("requires runtime-compared")

    def test_runtime_label_alone_cannot_verify_finding(self):
        self.finding.update(status="verified", evidence_level="runtime-compared",
                            execution_evidence=["some-test.ts"])
        self.save_finding()
        self.assert_invalid("missing runtime_comparison")

    def comparison(self):
        for name in ("upstream.json", "local.json", "comparison.json"):
            (self.root / name).write_text("{}")
        self.finding.update(
            status="verified", evidence_level="runtime-compared",
            execution_evidence=["comparison.json"],
            runtime_comparison={
                "upstream_commit": PIN, "result": "matched",
                "upstream_artifact": "upstream.json", "local_artifact": "local.json",
                "comparison_artifact": "comparison.json",
            },
        )

    def test_artifact_references_still_do_not_claim_parity(self):
        self.comparison()
        self.save_finding()
        result = checker.check(self.root)
        self.assertIn("0 unverified", result)
        self.assertIn("Artifact references do not establish semantic equivalence", result)

    def test_comparison_requires_current_pin_and_existing_artifacts(self):
        self.comparison()
        valid = copy.deepcopy(self.finding)
        cases = (
            ("upstream_commit", "b" * 40, "stale comparison pin"),
            ("upstream_artifact", "missing.json", "Missing comparison artifact"),
            ("upstream_artifact", "../outside.json", "escapes repository"),
            ("upstream_artifact", "/tmp/outside.json", "repository-relative"),
            ("local_artifact", "upstream.json", "Duplicate comparison artifacts"),
            ("result", "different", "did not match"),
        )
        for field, value, error in cases:
            with self.subTest(field=field, value=value):
                self.finding = copy.deepcopy(valid)
                self.finding["runtime_comparison"][field] = value
                self.save_finding()
                self.assert_invalid(error)

    def test_stale_fixture_pin_fails(self):
        fixtures = self.root / "test/parity/t3code"
        fixtures.mkdir(parents=True)
        (fixtures / "archive.json").write_text(json.dumps({
            "upstreamCommit": "b" * 40, "sources": {"archive": "source.ts:1"},
            "evidence": "source-derived; no live upstream comparison",
        }))
        self.assert_invalid("stale fixture pin")

    def test_fixture_cannot_claim_runtime_comparison_without_artifacts(self):
        fixtures = self.root / "test/parity/t3code"
        fixtures.mkdir(parents=True)
        fixture = {
            "upstreamCommit": PIN, "sources": {"archive": "source.ts:1"},
            "evidence": "runtime-compared",
        }
        (fixtures / "archive.json").write_text(json.dumps(fixture))
        self.assert_invalid("missing runtime_comparison")

    def test_source_fixture_is_counted_without_promoting_finding(self):
        fixtures = self.root / "test/parity/t3code"
        fixtures.mkdir(parents=True)
        (fixtures / "archive.json").write_text(json.dumps({
            "upstreamCommit": PIN, "sources": {"archive": "source.ts:1"},
            "evidence": "source-derived; no live upstream comparison",
        }))
        result = checker.check(self.root)
        self.assertIn("1 provenance-stamped fixtures", result)
        self.assertIn("1 unverified", result)


if __name__ == "__main__":
    unittest.main()
