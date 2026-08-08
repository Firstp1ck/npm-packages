import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = SKILL_DIR / "scripts"
BUILD_INDEX = SCRIPTS_DIR / "build_repo_index.py"
EXTRACT_HANDOFF = SCRIPTS_DIR / "extract_explorer_handoff.py"
VALIDATE_HANDOFF = SCRIPTS_DIR / "validate_handoff.py"
SUMMARIZE_REPORTS = SCRIPTS_DIR / "summarize_effectiveness_reports.py"


def _env():
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    return env


def _normalize(path: str) -> str:
    return path.replace("\\", "/")


def _run(args, *, input_text=None, check=True):
    result = subprocess.run(
        [sys.executable, *map(str, args)],
        input=input_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=_env(),
    )
    if check and result.returncode != 0:
        raise AssertionError(
            f"Command failed: {args}\nexit={result.returncode}\nstdout={result.stdout}\nstderr={result.stderr}"
        )
    return result


def _build_index(repo: Path, output: Path) -> dict:
    _run([BUILD_INDEX, "--repo", repo, "--output", output])
    return json.loads(output.read_text(encoding="utf-8"))


class RepoExplorerTests(unittest.TestCase):
    def test_package_registers_native_tool_extension(self):
        package_json = json.loads((SKILL_DIR.parents[1] / "package.json").read_text(encoding="utf-8"))
        extension_path = SKILL_DIR.parents[1] / "extensions" / "repo-explorer.ts"

        self.assertIn("./extensions", package_json["pi"]["extensions"])
        self.assertIn("extensions", package_json["files"])
        self.assertIn("skills/repo-explorer/tests/fixtures", package_json["files"])
        self.assertTrue(extension_path.exists())
        source = extension_path.read_text(encoding="utf-8")
        self.assertIn('name: "repo_explorer_explore"', source)
        self.assertIn("writeEffectivenessReport", source)
        self.assertIn("repo-explorer-effectiveness-", source)
        self.assertIn("effectiveness_report", source)
        self.assertIn('"--budget", budget', source)
        self.assertIn('"--include-evidence", includeEvidence ? "true" : "false"', source)
        self.assertIn("## Model-Visible Output", source)
        self.assertIn("## Explorer Limitations", source)
        self.assertIn("## Target Repository Risks", source)
        self.assertIn("## Tracking Metadata", source)
        self.assertIn("## Improvement Signals", source)
        self.assertIn("## Downstream Feedback Capture", source)
        self.assertIn("do not use Bash to preflight availability", source)
        self.assertIn("targeted non-shell read/grep/find/ls", source)
        self.assertIn("Bash is diagnostic-only", source)

    def test_skill_documents_effectiveness_report_requirement(self):
        source = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("Write Effectiveness Report", source)
        self.assertIn("skills/repo-explorer/repo-explorer-effectiveness-<timestamp>-<repo-key>.md", source)
        self.assertIn("effectiveness_report", source)
        self.assertIn("Use the Native Tool for Routine Exploration", source)
        self.assertIn("Do not use Bash to preflight tool availability", source)
        self.assertIn("specialized non-shell `read`, `grep`, `find`, or `ls`", source)
        self.assertIn("Bash is diagnostic-only", source)

    def test_validator_rejects_missing_required_contract_fields(self):
        handoff_missing_index_info_and_errors = {
            "schema_version": "1.0",
            "explorer": "pathfinder",
            "timestamp": "2026-05-28T00:00:00+00:00",
            "request": {"goal": "x", "target_paths": ["/tmp/repo"], "depth": "standard"},
            "task_understanding": "x",
            "key_files": [],
            "relevant_symbols": [],
            "dependency_map": [],
            "risks_and_unknowns": [],
            "next_actions_for_caller": [],
            "evidence": [],
        }

        result = _run(
            [VALIDATE_HANDOFF, "--input", "-"],
            input_text=json.dumps(handoff_missing_index_info_and_errors),
            check=False,
        )
        self.assertNotEqual(result.returncode, 0, result.stdout)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["valid"])
        self.assertIn("Missing required top-level field: index_info", payload["errors"])
        self.assertIn("Missing required top-level field: errors", payload["errors"])

    def test_validator_accepts_dash_stdin_for_valid_handoff(self):
        valid_handoff = {
            "schema_version": "1.0",
            "explorer": "pathfinder",
            "timestamp": "2026-05-28T00:00:00+00:00",
            "request": {"goal": "x", "target_paths": ["/tmp/repo"], "depth": "standard"},
            "index_info": {"index_path": "/tmp/index.json", "index_age_seconds": 0, "files_indexed": 0},
            "task_understanding": "x",
            "key_files": [],
            "relevant_symbols": [],
            "dependency_map": [],
            "risks_and_unknowns": [],
            "next_actions_for_caller": [],
            "evidence": [],
            "errors": [],
        }

        result = _run([VALIDATE_HANDOFF, "--input", "-"], input_text=json.dumps(valid_handoff))
        payload = json.loads(result.stdout)
        self.assertTrue(payload["valid"], payload)

    def test_validator_rejects_invalid_timestamp_paths_lines_and_confidence(self):
        invalid_handoff = {
            "schema_version": "1.0",
            "explorer": "pathfinder",
            "timestamp": "not-a-timestamp",
            "request": {"goal": "x", "target_paths": ["/tmp/repo"], "depth": "standard"},
            "index_info": {"index_path": "/tmp/index.json", "index_age_seconds": 0, "files_indexed": 1},
            "task_understanding": "x",
            "key_files": [
                {
                    "path": "/definitely/missing/repo_explorer_file.py",
                    "role": "source",
                    "language": "python",
                    "lines": "12",
                    "relevance": "low",
                    "confidence": "certain",
                    "confidence_reason": "bad enum",
                }
            ],
            "relevant_symbols": [
                {
                    "name": "x",
                    "kind": "function",
                    "file": "/definitely/missing/repo_explorer_file.py",
                    "line_start": 2,
                    "line_end": 1,
                    "why": "test",
                    "confidence": "high",
                    "confidence_reason": "test",
                }
            ],
            "dependency_map": [],
            "risks_and_unknowns": [],
            "next_actions_for_caller": [],
            "evidence": [
                {
                    "file": "/definitely/missing/repo_explorer_file.py",
                    "line_start": 10,
                    "line_end": 10,
                    "snippet": "one\ntwo",
                    "context": "bad line range",
                    "confidence": "medium",
                    "confidence_reason": "test",
                }
            ],
            "errors": [],
        }

        result = _run([VALIDATE_HANDOFF, "--input", "-"], input_text=json.dumps(invalid_handoff), check=False)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["valid"])
        errors = payload["errors"]
        self.assertTrue(any("timestamp is not valid ISO-8601" in e for e in errors), errors)
        self.assertTrue(any("key_files[0].path path does not exist" in e for e in errors), errors)
        self.assertIn("key_files[0].lines must be a non-negative integer", errors)
        self.assertIn("key_files[0].relevance has invalid value: low", errors)
        self.assertIn("key_files[0].confidence has invalid value: certain", errors)
        self.assertTrue(any("relevant_symbols[0].file path does not exist" in e for e in errors), errors)
        self.assertIn("relevant_symbols[0] has line_end before line_start", errors)
        self.assertTrue(any("evidence[0] snippet line count exceeds declared line range" in e for e in errors), errors)

    def test_index_includes_ci_and_safe_dotfiles_and_marks_env_sensitive(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "fixture"
            (repo / ".github" / "workflows").mkdir(parents=True)
            (repo / "src").mkdir(parents=True)
            (repo / ".github" / "workflows" / "ci.yml").write_text("name: ci\n", encoding="utf-8")
            (repo / ".env").write_text("PASSWORD=super-secret-value\n", encoding="utf-8")
            (repo / ".env.example").write_text("PASSWORD=change-me\n", encoding="utf-8")
            (repo / ".gitignore").write_text("*.log\n", encoding="utf-8")
            (repo / "package.json").write_text('{"scripts":{"test":"echo ok"}}\n', encoding="utf-8")
            (repo / "src" / "auth.ts").write_text(
                "export const loginUser = async () => true;\n", encoding="utf-8"
            )

            index = _build_index(repo, repo / "index.json")
            rel_paths = {_normalize(f["relative_path"]): f for f in index["files"]}

            self.assertIn(".github/workflows/ci.yml", rel_paths)
            self.assertIn(".env", rel_paths)
            self.assertIn(".env.example", rel_paths)
            self.assertIn(".gitignore", rel_paths)
            self.assertIn("src/auth.ts", rel_paths)

            env_entry = rel_paths[".env"]
            self.assertEqual(env_entry["role"], "environment")
            self.assertTrue(env_entry.get("content_sensitive"))
            self.assertEqual(env_entry.get("hash", ""), "")
            self.assertNotIn("symbols", env_entry)

    def test_symbol_kinds_and_spans_are_normalized(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "fixture"
            (repo / "src").mkdir(parents=True)
            (repo / "src" / "auth.ts").write_text(
                "export interface User { id: string }\n"
                "export const loginUser = async () => {\n"
                "  return true;\n"
                "}\n"
                "export class SessionStore {}\n",
                encoding="utf-8",
            )
            (repo / "src" / "auth.py").write_text(
                "async def authenticate_user():\n"
                "    return True\n"
                "\n"
                "class AuthService:\n"
                "    pass\n",
                encoding="utf-8",
            )

            index = _build_index(repo, repo / "index.json")
            symbols = {}
            for file_entry in index["files"]:
                for sym in file_entry.get("symbols", []):
                    symbols[sym["name"]] = sym

            self.assertEqual(symbols["User"]["kind"], "interface")
            self.assertEqual(symbols["loginUser"]["kind"], "function")
            self.assertGreaterEqual(symbols["loginUser"].get("line_end", 0), 4)
            self.assertEqual(symbols["SessionStore"]["kind"], "class")
            self.assertEqual(symbols["authenticate_user"]["kind"], "function")
            self.assertEqual(symbols["AuthService"]["kind"], "class")

    def test_extraction_prioritizes_goal_relevant_code_and_avoids_license_noise(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "fixture"
            (repo / "src").mkdir(parents=True)
            (repo / "LICENSE").write_text("MIT License\n", encoding="utf-8")
            (repo / "README.md").write_text("# Fixture\n", encoding="utf-8")
            (repo / "package.json").write_text('{"name":"fixture"}\n', encoding="utf-8")
            (repo / "src" / "auth.ts").write_text(
                "import fs from 'fs';\n"
                "import { saveSession } from './session';\n"
                "export const loginUser = async () => {\n"
                "  return saveSession();\n"
                "}\n",
                encoding="utf-8",
            )
            (repo / "src" / "session.ts").write_text(
                "export function saveSession() { return true; }\n", encoding="utf-8"
            )

            index_path = repo / "index.json"
            _build_index(repo, index_path)
            result = _run([
                EXTRACT_HANDOFF,
                "--index",
                index_path,
                "--goal",
                "find auth login flow",
                "--depth",
                "standard",
                "--target-paths",
                repo,
            ])
            handoff = json.loads(result.stdout)
            key_paths = {_normalize(Path(f["path"]).relative_to(repo).as_posix()) for f in handoff["key_files"]}
            symbol_names = {s["name"] for s in handoff["relevant_symbols"]}

            self.assertIn("src/auth.ts", key_paths)
            self.assertNotIn("LICENSE", key_paths)
            dependency_targets = {d["target"] for d in handoff["dependency_map"]}

            auth_file = next(f for f in handoff["key_files"] if Path(f["path"]).name == "auth.ts")
            login_symbol = next(s for s in handoff["relevant_symbols"] if s["name"] == "loginUser")

            self.assertIn("loginUser", symbol_names)
            self.assertIn("src/session.ts", dependency_targets)
            self.assertNotIn("fs", dependency_targets)
            self.assertIn(auth_file["confidence"], {"high", "medium", "low"})
            self.assertTrue(auth_file["confidence_reason"])
            self.assertIn(login_symbol["confidence"], {"high", "medium", "low"})
            self.assertTrue(login_symbol["confidence_reason"])
            self.assertLessEqual(len(handoff["evidence"]), 5)
            self.assertTrue(all("confidence" in item for item in handoff["evidence"]))

    def test_compact_ranking_keeps_ci_config_and_snake_case_symbols(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "fixture"
            (repo / ".github" / "workflows").mkdir(parents=True)
            (repo / "config").mkdir()
            (repo / "docs").mkdir()
            (repo / "src").mkdir()
            (repo / "tests").mkdir()
            (repo / ".github" / "workflows" / "ci.yml").write_text(
                "name: ci\n", encoding="utf-8"
            )
            (repo / "config" / "app.yaml").write_text("service: fixture\n", encoding="utf-8")
            (repo / "docs" / "architecture.md").write_text("# Architecture\n", encoding="utf-8")
            (repo / "tests" / "test_token.py").write_text("def test_token(): pass\n", encoding="utf-8")
            (repo / "src" / "token_store.py").write_text(
                "def save_token(value):\n    return value\n", encoding="utf-8"
            )

            index_path = repo / "index.json"
            _build_index(repo, index_path)
            result = _run([
                EXTRACT_HANDOFF,
                "--index",
                index_path,
                "--goal",
                "find ci tests configuration architecture token store",
                "--depth",
                "standard",
                "--budget",
                "compact",
                "--include-evidence",
                "false",
                "--target-paths",
                repo,
            ])
            handoff = json.loads(result.stdout)
            key_paths = {_normalize(Path(item["path"]).relative_to(repo).as_posix()) for item in handoff["key_files"]}
            symbol_names = {item["name"] for item in handoff["relevant_symbols"]}

            self.assertIn(".github/workflows/ci.yml", key_paths)
            self.assertIn("config/app.yaml", key_paths)
            self.assertIn("save_token", symbol_names)

    def test_internal_dependency_resolution_handles_rust_public_modules_and_go_modules(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "fixture"
            (repo / "src" / "rust").mkdir(parents=True)
            (repo / "cmd" / "server").mkdir(parents=True)
            (repo / "internal" / "router").mkdir(parents=True)
            (repo / "src" / "rust" / "lib.rs").write_text("pub mod auth;\n", encoding="utf-8")
            (repo / "src" / "rust" / "auth.rs").write_text(
                "pub fn authenticate_request() {}\n", encoding="utf-8"
            )
            (repo / "go.mod").write_text("module example.com/fixture\n", encoding="utf-8")
            (repo / "cmd" / "server" / "main.go").write_text(
                'package main\nimport "example.com/fixture/internal/router"\nfunc main() { router.NewRouter() }\n',
                encoding="utf-8",
            )
            (repo / "internal" / "router" / "router.go").write_text(
                "package router\nfunc NewRouter() {}\n", encoding="utf-8"
            )

            index_path = repo / "index.json"
            _build_index(repo, index_path)
            result = _run([
                EXTRACT_HANDOFF,
                "--index",
                index_path,
                "--goal",
                "trace rust auth module and go router wiring",
                "--depth",
                "standard",
                "--budget",
                "compact",
                "--include-evidence",
                "false",
                "--target-paths",
                repo,
            ])
            dependencies = {
                (item["source"], item["target"], item["kind"])
                for item in json.loads(result.stdout)["dependency_map"]
            }

            self.assertIn(("src/rust/lib.rs", "src/rust/auth.rs", "import"), dependencies)
            self.assertIn(("cmd/server/main.go", "internal/router/router.go", "import"), dependencies)

    def test_extraction_redacts_secret_snippets_and_records_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "fixture"
            (repo / "src").mkdir(parents=True)
            (repo / "src" / "auth.ts").write_text(
                "export const authSecret = () => {\n"
                "  const token = 'sk-12345678901234567890';\n"
                "  return token;\n"
                "}\n",
                encoding="utf-8",
            )

            index_path = repo / "index.json"
            _build_index(repo, index_path)
            result = _run([
                EXTRACT_HANDOFF,
                "--index",
                index_path,
                "--goal",
                "find auth secret handling",
                "--depth",
                "standard",
                "--target-paths",
                repo,
            ])
            handoff = json.loads(result.stdout)
            snippets = "\n".join(item["snippet"] for item in handoff["evidence"])
            error_codes = {item["code"] for item in handoff["errors"]}

            self.assertIn("[REDACTED]", snippets)
            self.assertNotIn("sk-12345678901234567890", snippets)
            self.assertIn("redacted_secret", error_codes)
            validation = _run([VALIDATE_HANDOFF, "--input", "-"], input_text=json.dumps(handoff))
            self.assertTrue(json.loads(validation.stdout)["valid"])

    def test_extraction_records_omitted_symbol_budget_without_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "fixture"
            (repo / "src").mkdir(parents=True)
            (repo / "src" / "auth.ts").write_text(
                "\n".join(f"export function authThing{i}() {{ return {i}; }}" for i in range(35)),
                encoding="utf-8",
            )

            index_path = repo / "index.json"
            _build_index(repo, index_path)
            result = _run([
                EXTRACT_HANDOFF,
                "--index",
                index_path,
                "--goal",
                "find auth functions",
                "--depth",
                "standard",
                "--target-paths",
                repo,
            ])
            handoff = json.loads(result.stdout)
            error_codes = {item["code"] for item in handoff["errors"]}

            self.assertEqual(len(handoff["relevant_symbols"]), 30)
            self.assertEqual(handoff["omitted"]["relevant_symbols"], 5)
            self.assertIn("budget", handoff["omitted"]["reasons"])
            self.assertNotIn("budget_exceeded", error_codes)
            validation = _run([VALIDATE_HANDOFF, "--input", "-"], input_text=json.dumps(handoff))
            self.assertTrue(json.loads(validation.stdout)["valid"])

    def test_compact_no_evidence_uses_budget_and_records_omissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "fixture"
            (repo / "src").mkdir(parents=True)
            (repo / "src" / "auth.ts").write_text(
                "\n".join(f"export function authThing{i}() {{ return {i}; }}" for i in range(35)),
                encoding="utf-8",
            )

            index_path = repo / "index.json"
            _build_index(repo, index_path)
            result = _run([
                EXTRACT_HANDOFF,
                "--index",
                index_path,
                "--goal",
                "find auth functions",
                "--depth",
                "standard",
                "--budget",
                "compact",
                "--include-evidence",
                "false",
                "--target-paths",
                repo,
            ])
            handoff = json.loads(result.stdout)
            error_codes = {item["code"] for item in handoff["errors"]}

            self.assertLessEqual(len(handoff["key_files"]), 8)
            self.assertLessEqual(len(handoff["relevant_symbols"]), 12)
            self.assertGreater(len(handoff["relevant_symbols"]), 0)
            self.assertEqual(handoff["evidence"], [])
            self.assertGreater(handoff["omitted"]["relevant_symbols"], 0)
            self.assertGreater(handoff["omitted"]["evidence"], 0)
            self.assertIn("user-did-not-request-evidence", handoff["omitted"]["reasons"])
            self.assertNotIn("budget_exceeded", error_codes)
            validation = _run([VALIDATE_HANDOFF, "--input", "-"], input_text=json.dumps(handoff))
            self.assertTrue(json.loads(validation.stdout)["valid"])

    def test_trace_goal_with_no_dependency_edges_records_explorer_limitation(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "fixture"
            (repo / "src").mkdir(parents=True)
            (repo / "src" / "auth.ts").write_text(
                "export function loginUser() { return true; }\n",
                encoding="utf-8",
            )

            index_path = repo / "index.json"
            _build_index(repo, index_path)
            result = _run([
                EXTRACT_HANDOFF,
                "--index",
                index_path,
                "--goal",
                "trace auth flow wiring",
                "--depth",
                "standard",
                "--budget",
                "compact",
                "--include-evidence",
                "false",
                "--target-paths",
                repo,
            ])
            handoff = json.loads(result.stdout)
            limitation_codes = {item["code"] for item in handoff["explorer_limitations"]}

            self.assertEqual(handoff["dependency_map"], [])
            self.assertIn("dependency_trace_empty", limitation_codes)
            validation = _run([VALIDATE_HANDOFF, "--input", "-"], input_text=json.dumps(handoff))
            self.assertTrue(json.loads(validation.stdout)["valid"])

    def test_effectiveness_summary_script_creates_improvement_markdown(self):
        with tempfile.TemporaryDirectory() as tmp:
            reports_dir = Path(tmp) / "reports"
            reports_dir.mkdir()
            (reports_dir / "repo-explorer-effectiveness-2026-06-20T00-00-00-000Z-demo.md").write_text(
                "# Repo Explorer Effectiveness Report\n\n"
                "- Generated: 2026-06-20T00:00:00Z\n"
                "- Status: completed\n"
                "- Assessment: partial\n"
                "- Goal: trace auth flow\n\n"
                "## Run Configuration\n\n"
                "- Depth: standard\n"
                "- Budget: compact\n"
                "- Evidence requested in tool output: no\n\n"
                "## Effectiveness Signals\n\n"
                "- Handoff validation: valid\n"
                "- Key files found: 8\n"
                "- Relevant symbols found: 12\n"
                "- Dependency edges found: 0\n"
                "- Evidence snippets collected: 0\n\n"
                "## Omitted Items\n\n"
                "- Key files omitted: 3\n"
                "- Symbols omitted: 10\n"
                "- Dependency edges omitted: 0\n"
                "- Evidence omitted: 12\n"
                "- Omission reasons: budget, symbol-diversity, user-did-not-request-evidence\n\n"
                "## Improvement Signals\n\n"
                "- dependency_trace_empty\n"
                "- high_symbol_omission\n\n"
                "## Explorer Limitations\n\n"
                "- [medium] dependency_trace_empty: no dependency edges\n",
                encoding="utf-8",
            )
            (reports_dir / "repo-explorer-effectiveness-2026-06-19T00-00-00-000Z-legacy.md").write_text(
                "# Repo Explorer Effectiveness Report\n\n"
                "- Generated: 2026-06-19T00:00:00Z\n"
                "- Status: completed\n"
                "- Assessment: partial\n"
                "- Goal: find auth flow\n\n"
                "## Run Configuration\n\n"
                "- Depth: standard\n"
                "- Budget: compact\n"
                "- Evidence requested in tool output: no\n\n"
                "## Effectiveness Signals\n\n"
                "- Handoff validation: valid\n"
                "- Key files found: 25\n"
                "- Relevant symbols found: 30\n"
                "- Dependency edges found: 0\n"
                "- Evidence snippets collected: 5\n\n"
                "## Risks and Errors\n\n"
                "- budget_exceeded: relevant_symbols trimmed to 30\n",
                encoding="utf-8",
            )
            output = Path(tmp) / "summary.md"

            result = _run([SUMMARIZE_REPORTS, "--reports-dir", reports_dir, "--output", output])
            summary = output.read_text(encoding="utf-8")

            self.assertIn(str(output), result.stdout)
            self.assertIn("Reports parsed: 2", summary)
            self.assertIn("dependency_trace_empty", summary)
            self.assertIn("legacy_budget_exceeded", summary)
            self.assertIn("P1: improve dependency/call tracing", summary)
            self.assertIn("## Recommended Backlog", summary)


if __name__ == "__main__":
    unittest.main()
