import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from evidence import digest
from run import save_comparison

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

    def test_scenario_verified_needs_a_named_scenario(self):
        self.finding.update(status="verified", evidence_level="scenario-verified",
                            execution_evidence=["checked by hand in the browser"])
        self.save_finding()
        self.assert_invalid("must name scripts/agent/scenarios")

    def test_scenario_verified_needs_the_scenario_file(self):
        self.finding.update(status="verified", evidence_level="scenario-verified",
                            execution_evidence=["scripts/agent/scenarios/archive-idle.ts"])
        self.save_finding()
        self.assert_invalid("missing scenario scripts/agent/scenarios/archive-idle.ts")

    def test_existing_scenario_verifies_finding(self):
        scenarios = self.root / "scripts/agent/scenarios"
        scenarios.mkdir(parents=True)
        (scenarios / "archive-idle.ts").write_text("export {}\n")
        self.finding.update(status="verified", evidence_level="scenario-verified",
                            execution_evidence=["scenario scripts/agent/scenarios/archive-idle.ts passed"])
        self.save_finding()
        self.assertIn("0 unverified", checker.check(self.root))

    def test_runtime_label_alone_cannot_verify_finding(self):
        self.finding.update(status="verified", evidence_level="runtime-compared",
                            execution_evidence=["some-test.ts"])
        self.save_finding()
        self.assert_invalid("missing runtime_comparison")

    def comparison(self):
        (self.root / "scenario.py").write_text("print('archive')\n")
        scenario = {"id": "archive", "runner": "scenario.py", "command": ["python3", "scenario.py"],
                    "cases": ["archive-idle"]}
        comparison = save_comparison(
            self.root, "evidence", "LIFE-01", PIN, scenario,
            [{"path": "scenario.py", "sha256": digest(self.root / "scenario.py")}],
            {"cases": [{"id": "archive-idle", "upstream": {"archived": True}, "local": {"archived": True}}],
             "negativeControls": [{"id": "archive-without-persistence", "result": "rejected", "caseId": "archive-idle", "output": {"archived": False}}]},
        )
        self.finding.update(
            status="verified", evidence_level="runtime-compared",
            execution_evidence=["evidence/comparison.json"], runtime_comparison=comparison,
        )

    def test_validated_cases_still_do_not_claim_whole_application_parity(self):
        self.comparison()
        self.save_finding()
        result = checker.check(self.root)
        self.assertIn("0 unverified", result)
        self.assertIn("recorded case agreement only", result)

    def test_empty_existing_artifacts_cannot_verify_finding(self):
        self.comparison()
        (self.root / "evidence/comparison.json").write_text("{}")
        self.save_finding()
        self.assert_invalid("Unsupported comparison report schema")

    def test_comparison_requires_current_pin_and_existing_artifacts(self):
        self.comparison()
        valid = copy.deepcopy(self.finding)
        cases = (
            ("upstream_commit", "b" * 40, "stale comparison pin"),
            ("upstream_artifact", "missing.json", "Missing comparison artifact"),
            ("upstream_artifact", "../outside.json", "escapes repository"),
            ("upstream_artifact", "/tmp/outside.json", "repository-relative"),
            ("local_artifact", "evidence/upstream.json", "Duplicate comparison artifacts"),
            ("result", "different", "did not match"),
        )
        for field, value, error in cases:
            with self.subTest(field=field, value=value):
                self.finding = copy.deepcopy(valid)
                self.finding["runtime_comparison"][field] = value
                self.save_finding()
                self.assert_invalid(error)

    def rewrite_report(self, change):
        path = self.root / "evidence/comparison.json"
        report = json.loads(path.read_text())
        change(report)
        path.write_text(json.dumps(report))

    def test_false_report_metadata_fails(self):
        self.comparison()
        self.save_finding()
        path = self.root / "evidence/comparison.json"
        original = path.read_text()
        cases = (
            (lambda report: report.update(upstreamCommit="b" * 40), "Stale comparison report pin"),
            (lambda report: report.update(subject="LIFE-02"), "subject mismatch"),
            (lambda report: report.update(cases=[]), "Missing comparison case results"),
            (lambda report: report["cases"][0].update(result="skipped"), "failed or skipped"),
            (lambda report: report["cases"][0].update(id="invented"), "case coverage mismatch"),
            (lambda report: report.update(negativeControls=[]), "Missing negative controls"),
            (lambda report: report["negativeControls"][0].update(result="matched"), "not rejected"),
            (lambda report: report["negativeControls"][0].update(output={"archived": True}), "matches the upstream observation"),
            (lambda report: report["negativeControls"][0].update(caseId="invented"), "unknown case"),
            (lambda report: report["negativeControls"][0].pop("output"), "omitted its observation"),
            (lambda report: report.update(sources=[]), "Missing source snapshots"),
            (lambda report: report["scenario"].update(command=["python3", "other.py", "scenario.py"]), "command entry point"),
        )
        for change, error in cases:
            with self.subTest(error=error):
                path.write_text(original)
                self.rewrite_report(change)
                self.assert_invalid(error)

    def test_changed_observation_fails_even_when_hash_is_updated(self):
        self.comparison()
        self.save_finding()
        path = self.root / "evidence/local.json"
        artifact = json.loads(path.read_text())
        artifact["cases"][0]["output"] = {"archived": False}
        path.write_text(json.dumps(artifact))
        self.assert_invalid("Artifact content changed")
        self.rewrite_report(lambda report: report["artifacts"]["local"].update(sha256=digest(path)))
        self.assert_invalid("observed outputs differ")

    def test_boolean_and_number_observations_are_not_equivalent(self):
        self.comparison()
        self.save_finding()
        path = self.root / "evidence/local.json"
        artifact = json.loads(path.read_text())
        artifact["cases"][0]["output"] = {"archived": 1}
        path.write_text(json.dumps(artifact))
        self.rewrite_report(lambda report: report["artifacts"]["local"].update(sha256=digest(path)))
        self.assert_invalid("observed outputs differ")

    def test_changed_runner_invalidates_recorded_comparison(self):
        self.comparison()
        self.save_finding()
        (self.root / "scenario.py").write_text("print('changed behavior')\n")
        self.assert_invalid("Artifact content changed: scenario.py")

    def test_observation_case_coverage_is_checked_independently(self):
        self.comparison()
        self.save_finding()
        path = self.root / "evidence/local.json"
        artifact = json.loads(path.read_text())
        artifact["cases"][0]["id"] = "wrong-case"
        path.write_text(json.dumps(artifact))
        self.rewrite_report(lambda report: report["artifacts"]["local"].update(sha256=digest(path)))
        self.assert_invalid("Observation case coverage mismatch")

    def test_report_cannot_substitute_another_artifact(self):
        self.comparison()
        self.save_finding()
        self.rewrite_report(lambda report: report["artifacts"].update(local=report["artifacts"]["upstream"]))
        self.assert_invalid("artifact reference mismatch")

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
