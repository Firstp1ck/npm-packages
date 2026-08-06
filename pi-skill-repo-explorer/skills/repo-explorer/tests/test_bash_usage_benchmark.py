import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPT_PATH = SKILL_DIR / "scripts" / "benchmark_bash_usage.py"
CORPUS_DIR = SKILL_DIR / "tests" / "fixtures" / "bash-usage-corpus"
REPO_DIR = CORPUS_DIR / "repo"
RAW_SECRET = "benchmark-placeholder-value-that-is-sensitive"

spec = importlib.util.spec_from_file_location("repo_explorer_bash_benchmark", SCRIPT_PATH)
benchmark = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = benchmark
assert spec.loader is not None
spec.loader.exec_module(benchmark)


class BashUsageBenchmarkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = benchmark.load_manifest(CORPUS_DIR)
        cls.result = benchmark.run_benchmark(CORPUS_DIR)

    def test_corpus_is_extensive_polyglot_and_declares_34_facts(self):
        expected_tags = {
            "typescript", "javascript", "python", "rust", "go", "configuration",
            "documentation", "ci", "tests", "re_exports", "internal_imports",
            "sensitive_files", "decoys",
        }
        self.assertTrue(expected_tags.issubset(set(self.manifest["coverage_tags"])))
        files = [path for path in REPO_DIR.rglob("*") if path.is_file()]
        relative_paths = {path.relative_to(REPO_DIR).as_posix() for path in files}
        suffixes = {path.suffix for path in files}
        self.assertGreaterEqual(len(files), 35)
        self.assertTrue({".ts", ".js", ".py", ".rs", ".go", ".toml", ".yaml", ".yml", ".md"}.issubset(suffixes))
        self.assertIn(".github/workflows/ci.yml", relative_paths)
        self.assertNotIn("benchmark-sensitive.fixture", relative_paths)
        self.assertNotIn(".env", relative_paths)
        self.assertGreaterEqual(sum(path.startswith("noise/archive/") for path in relative_paths), 6)

        requirements = [fact for scenario in self.manifest["scenarios"] for fact in scenario["required_facts"]]
        self.assertEqual(len(self.manifest["scenarios"]), 7)
        self.assertEqual(len(requirements), 34)
        self.assertEqual({fact["category"] for fact in requirements}, set(benchmark.FACT_CATEGORIES))
        self.assertEqual(len({fact["id"] for fact in requirements}), len(requirements))

    def test_manifest_is_provable_without_fixture_specific_indexer_rules(self):
        index = benchmark.scan_repo(REPO_DIR)
        benchmark.validate_manifest(self.manifest, CORPUS_DIR, index)
        self.assertNotIn(
            "benchmark-sensitive.fixture",
            {str(item["relative_path"]).replace("\\", "/") for item in index["files"]},
        )

    def test_independent_real_pipelines_recover_all_facts_and_gate_direct_coverage(self):
        result = self.result
        self.assertTrue(result["benchmark_passed"])
        for strategy in ("legacy_manual", "native_first"):
            aggregate = result["aggregates"][strategy]
            self.assertEqual(aggregate["coverage_percent"], 100.0)
            self.assertEqual(aggregate["direct_non_evidence_coverage_percent"], 100.0)
            self.assertEqual(aggregate["required_facts"], aggregate["recovered_facts"])
            self.assertEqual(aggregate["scenario_count"], aggregate["valid_handoffs"])
            self.assertEqual(aggregate["scenario_count"], aggregate["correct_scenarios"])
        self.assertTrue(result["invariants"]["both_strategies_have_full_coverage"])
        self.assertTrue(result["invariants"]["both_strategies_have_full_direct_non_evidence_coverage"])

    def test_legacy_helper_stages_are_real_model_events_with_exit_evidence(self):
        expected_bash = 0
        for scenario in self.result["scenarios"]:
            legacy = scenario["strategies"]["legacy_manual"]
            model_events = [event for event in legacy["events"] if event["model_issued"]]
            operations = [event["operation"] for event in model_events]
            expected_prefix = ["refresh_index"]
            if scenario["index_state"] == "missing":
                expected_prefix.append("build_index_fallback")
            expected_prefix.extend(["extract_handoff", "validate_handoff"])
            self.assertEqual(operations[:len(expected_prefix)], expected_prefix)
            self.assertTrue(all(event["tool"] == "bash" for event in model_events))
            self.assertTrue(all(isinstance(event["exit_code"], int) for event in model_events))
            self.assertTrue(all(event["result"] for event in model_events))
            self.assertTrue(all(event["exit_code"] in {0, 1} for event in model_events))
            self.assertEqual(legacy["bash_event_count"], len(model_events))
            expected_bash += len(model_events)
        self.assertEqual(expected_bash, self.result["aggregates"]["legacy_manual"]["bash_event_count"])
        self.assertGreater(expected_bash, 0)

    def test_native_internal_process_events_are_recorded_and_excluded(self):
        for scenario in self.result["scenarios"]:
            native = scenario["strategies"]["native_first"]
            internal = [event for event in native["events"] if not event["model_issued"]]
            self.assertGreaterEqual(len(internal), 3)
            self.assertTrue(all(event["tool"] == "internal_process" for event in internal))
            self.assertTrue(all(event["exit_code"] in {0, 1} for event in internal))
            self.assertEqual(
                native["bash_event_count"],
                sum(event["model_issued"] and event["tool"] == "bash" for event in native["events"]),
            )
            self.assertEqual(native["bash_event_count"], 0)
        self.assertTrue(self.result["invariants"]["native_internal_events_recorded"])
        self.assertTrue(self.result["invariants"]["native_internal_events_excluded_from_bash_count"])

    def test_structurally_valid_empty_native_handoff_fails_without_oracle_recovery(self):
        def empty_handoff(_scenario, handoff):
            sabotaged = copy.deepcopy(handoff)
            for field in ("key_files", "relevant_symbols", "dependency_map", "evidence"):
                sabotaged[field] = []
            sabotaged["errors"] = []
            return sabotaged

        result = benchmark.run_benchmark(CORPUS_DIR, native_handoff_transform=empty_handoff)
        self.assertFalse(result["benchmark_passed"])
        self.assertEqual(result["aggregates"]["legacy_manual"]["coverage_percent"], 100.0)
        self.assertLess(result["aggregates"]["native_first"]["coverage_percent"], 100.0)
        self.assertLess(result["aggregates"]["native_first"]["direct_non_evidence_coverage_percent"], 100.0)
        self.assertFalse(result["reduction"]["correctness_gate_passed"])
        missing = {
            fact
            for scenario in result["scenarios"]
            for fact in scenario["strategies"]["native_first"]["final_coverage"]["missing_fact_ids"]
        }
        self.assertTrue({"ts-controller-file", "ts-login-symbol", "ts-session-import"}.issubset(missing))

    def test_injected_native_bash_followup_is_counted_and_fails_zero_bash_invariant(self):
        def bash_policy(_scenario, _handoff, missing):
            evidence = missing.get("evidence", [])
            return [{"tool": "bash", "category": "evidence", "requirements": evidence}] if evidence else []

        result = benchmark.run_benchmark(CORPUS_DIR, native_followup_policy=bash_policy)
        self.assertGreater(result["aggregates"]["native_first"]["bash_event_count"], 0)
        self.assertFalse(result["invariants"]["improved_has_zero_model_bash"])
        self.assertFalse(result["benchmark_passed"])

    def test_native_followup_policy_fails_closed_on_malformed_handoff_shapes(self):
        scenario = self.manifest["scenarios"][0]
        missing = {"evidence": [
            fact for fact in scenario["required_facts"] if fact["category"] == "evidence"
        ]}
        malformed = {
            "omitted": [],
            "request": {"target_paths": []},
            "key_files": "not-a-list",
        }
        self.assertEqual(benchmark.default_native_followup_policy(scenario, malformed, missing), [])

    def test_followup_visibility_is_policy_controlled(self):
        scenario = self.manifest["scenarios"][0]
        evidence = [fact for fact in scenario["required_facts"] if fact["category"] == "evidence"]
        ledger = benchmark.EventLedger(scenario["id"], "native_first")

        def internal_policy(_scenario, _handoff, _missing):
            return [{
                "tool": "read",
                "category": "evidence",
                "requirements": evidence,
                "model_issued": False,
            }]

        recovered = benchmark._execute_followups(
            "native_first",
            scenario,
            {},
            {"evidence": evidence},
            REPO_DIR,
            ledger,
            internal_policy,
        )
        self.assertEqual(recovered, {item["id"] for item in evidence})
        self.assertTrue(ledger.events)
        self.assertTrue(all(not event["model_issued"] for event in ledger.events))
        self.assertEqual(ledger.bash_count, 0)

    def test_include_evidence_redaction_is_exercised_without_raw_secret(self):
        sensitive_scenario = next(item for item in self.result["scenarios"] if item["id"] == "sensitive-decoy-boundary")
        self.assertTrue(sensitive_scenario["include_evidence"])
        for strategy in ("legacy_manual", "native_first"):
            outcome = sensitive_scenario["strategies"][strategy]
            self.assertIn("security-redaction", outcome["initial_handoff_coverage"]["recovered_fact_ids"])
        encoded = json.dumps(self.result, sort_keys=True)
        markdown = benchmark.render_markdown(self.result)
        self.assertNotIn(RAW_SECRET, encoded)
        self.assertNotIn(RAW_SECRET, markdown)
        self.assertIn("security-redaction", encoded)

        # Exercise the real includeEvidence=true extraction result and inspect its snippet.
        scenario = next(item for item in self.manifest["scenarios"] if item["id"] == "sensitive-decoy-boundary")
        handoff, errors, _ledger = benchmark._execute_pipeline("native_first", scenario, REPO_DIR)
        snippets = "\n".join(item["snippet"] for item in handoff["evidence"])
        self.assertEqual(errors, [])
        self.assertIn("[REDACTED]", snippets)
        self.assertNotIn(RAW_SECRET, snippets)

    def test_result_digest_covers_normalized_result_content(self):
        payload = copy.deepcopy(self.result)
        claimed = payload.pop("result_content_digest_sha256")
        normalized = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        self.assertEqual(claimed, hashlib.sha256(normalized.encode("utf-8")).hexdigest())
        self.assertIn("corpus_config_id", self.result)
        self.assertNotIn("run_id", self.result)

    def test_repeat_runs_and_cli_outputs_are_byte_identical(self):
        first = benchmark.run_benchmark(CORPUS_DIR)
        second = benchmark.run_benchmark(CORPUS_DIR)
        self.assertEqual(first, second)
        self.assertEqual(benchmark.render_markdown(first), benchmark.render_markdown(second))
        encoded = json.dumps(first, sort_keys=True)
        self.assertNotIn(str(CORPUS_DIR.resolve()), encoded)
        self.assertNotIn(str(CORPUS_DIR.resolve()).replace("\\", "/"), encoded)
        self.assertNotIn('"timestamp":', encoded.lower())
        self.assertIn("<CORPUS_ROOT>", encoded)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            outputs = [(root / "one.json", root / "one.md"), (root / "two.json", root / "two.md")]
            exits = []
            for json_path, markdown_path in outputs:
                with contextlib.redirect_stdout(io.StringIO()):
                    exits.append(benchmark.main([
                        "--corpus", str(CORPUS_DIR), "--json-out", str(json_path), "--markdown-out", str(markdown_path)
                    ]))
            self.assertEqual(exits, [0, 0])
            self.assertEqual(outputs[0][0].read_bytes(), outputs[1][0].read_bytes())
            self.assertEqual(outputs[0][1].read_bytes(), outputs[1][1].read_bytes())

    def test_reduction_math_is_guarded_and_correctness_gated(self):
        exact = benchmark.calculate_reduction(10, 2, correctness_gate_passed=True)
        self.assertEqual(exact["reduction_percent"], 80.0)
        self.assertTrue(exact["meets_target"])
        zero = benchmark.calculate_reduction(0, 0, correctness_gate_passed=True)
        self.assertIsNone(zero["reduction_percent"])
        self.assertFalse(zero["reduction_defined"])
        self.assertFalse(zero["meets_target"])
        incorrect = benchmark.calculate_reduction(10, 0, correctness_gate_passed=False)
        self.assertFalse(incorrect["meets_target"])
        with self.assertRaises(benchmark.BenchmarkError):
            benchmark.calculate_reduction(-1, 0, correctness_gate_passed=True)

    def test_unprovable_requirement_fails_closed(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["scenarios"][0]["required_facts"].append(
            {"id": "missing-file", "category": "file", "path": "src/does-not-exist.ts"}
        )
        with self.assertRaisesRegex(benchmark.BenchmarkError, "not provable"):
            benchmark.validate_manifest(manifest, CORPUS_DIR, benchmark.scan_repo(REPO_DIR))


if __name__ == "__main__":
    unittest.main()
