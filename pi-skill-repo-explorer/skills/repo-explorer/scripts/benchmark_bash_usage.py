#!/usr/bin/env python3
"""Deterministic benchmark for agent-visible repo-explorer Bash usage.

Both strategies execute their own real helper pipeline in an isolated temporary
cache. The legacy helper invocations are model-visible Bash events. The native
pipeline's helper processes are recorded as internal events and therefore do
not count as model-issued Bash. Missing facts are recovered only from bounded
adapter output; fixture availability is used solely to validate the corpus.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_CORPUS = SKILL_DIR / "tests" / "fixtures" / "bash-usage-corpus"
BUILD_INDEX = SCRIPT_DIR / "build_repo_index.py"
REFRESH_INDEX = SCRIPT_DIR / "refresh_repo_index.py"
EXTRACT_HANDOFF = SCRIPT_DIR / "extract_explorer_handoff.py"
VALIDATE_HANDOFF = SCRIPT_DIR / "validate_handoff.py"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_repo_index import scan_repo  # noqa: E402
from extract_explorer_handoff import redact_secrets  # noqa: E402
from validate_handoff import (  # noqa: E402
    scan_secrets,
    validate_evidence_snippets,
    validate_field_types,
    validate_limits,
    validate_structure,
)

BENCHMARK_SCHEMA_VERSION = "2.0"
STRATEGY_VERSIONS = {
    "legacy_manual": "legacy-manual-v2-real-pipeline",
    "native_first": "native-first-v2-real-pipeline",
}
FACT_CATEGORIES = ("file", "symbol", "dependency", "evidence")
NativeFollowupPolicy = Callable[[dict[str, Any], dict[str, Any], dict[str, list[dict[str, Any]]]], list[dict[str, Any]]]
NativeHandoffTransform = Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]


class BenchmarkError(ValueError):
    """Raised for an invalid corpus or benchmark request."""


def _posix(value: str | Path) -> str:
    return str(value).replace("\\", "/")


def _relative(path: str | Path, root: Path) -> str:
    try:
        return _posix(Path(path).resolve().relative_to(root.resolve()))
    except (OSError, ValueError):
        return _posix(path)


def load_manifest(corpus_dir: Path) -> dict[str, Any]:
    manifest_path = corpus_dir / "manifest.json"
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BenchmarkError(f"Cannot load corpus manifest {manifest_path}: {error}") from error
    if not isinstance(payload, dict):
        raise BenchmarkError("Corpus manifest must be a JSON object")
    return payload


def corpus_digest(corpus_dir: Path) -> str:
    """Hash fixture paths and bytes without including the absolute corpus root."""
    digest = hashlib.sha256()
    for path in sorted(path for path in corpus_dir.rglob("*") if path.is_file()):
        digest.update(path.relative_to(corpus_dir).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _index_files(index: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {_posix(item.get("relative_path", "")): item for item in index.get("files", [])}


def _requirement_available(requirement: dict[str, Any], repo_root: Path, index: dict[str, Any]) -> bool:
    """Corpus-validation oracle. Strategy execution must never call this."""
    category = requirement["category"]
    indexed = _index_files(index)
    if category == "file":
        return requirement["path"] in indexed and (repo_root / requirement["path"]).is_file()
    if category == "symbol":
        entry = indexed.get(requirement["path"], {})
        return any(symbol.get("name") == requirement["name"] for symbol in entry.get("symbols", []))
    if category == "dependency":
        source = repo_root / requirement["source"]
        target = repo_root / requirement["target"]
        return source.is_file() and target.is_file() and requirement["marker"] in source.read_text(
            encoding="utf-8", errors="replace"
        )
    if category == "evidence":
        source = repo_root / requirement["path"]
        return source.is_file() and requirement["contains"] in source.read_text(encoding="utf-8", errors="replace")
    return False


def validate_manifest(manifest: dict[str, Any], corpus_dir: Path, index: dict[str, Any]) -> None:
    """Validate explicit requirements against the physical fixture repository."""
    errors: list[str] = []
    if manifest.get("schema_version") != "1.0":
        errors.append("manifest.schema_version must be '1.0'")
    tags = manifest.get("coverage_tags")
    if not isinstance(tags, list) or not tags or not all(isinstance(tag, str) for tag in tags):
        errors.append("manifest.coverage_tags must be a non-empty string list")
    scenarios = manifest.get("scenarios")
    if not isinstance(scenarios, list) or not scenarios:
        errors.append("manifest.scenarios must be a non-empty list")
        scenarios = []

    scenario_ids: set[str] = set()
    fact_ids: set[str] = set()
    repo_root = corpus_dir / "repo"
    for position, scenario in enumerate(scenarios):
        label = f"scenarios[{position}]"
        if not isinstance(scenario, dict):
            errors.append(f"{label} must be an object")
            continue
        scenario_id = scenario.get("id")
        if not isinstance(scenario_id, str) or not scenario_id:
            errors.append(f"{label}.id must be a non-empty string")
        elif scenario_id in scenario_ids:
            errors.append(f"duplicate scenario id: {scenario_id}")
        else:
            scenario_ids.add(scenario_id)
        if not isinstance(scenario.get("goal"), str) or not scenario["goal"].strip():
            errors.append(f"{label}.goal must be a non-empty string")
        if scenario.get("depth") not in {"shallow", "standard", "deep"}:
            errors.append(f"{label}.depth must be shallow, standard, or deep")
        if scenario.get("index_state") not in {"fresh", "missing"}:
            errors.append(f"{label}.index_state must be fresh or missing")
        if "include_evidence" in scenario and not isinstance(scenario["include_evidence"], bool):
            errors.append(f"{label}.include_evidence must be boolean")
        requirements = scenario.get("required_facts")
        if not isinstance(requirements, list) or not requirements:
            errors.append(f"{label}.required_facts must be a non-empty list")
            continue
        for requirement in requirements:
            if not isinstance(requirement, dict):
                errors.append(f"{label}.required_facts entries must be objects")
                continue
            fact_id = requirement.get("id")
            category = requirement.get("category")
            if not isinstance(fact_id, str) or not fact_id:
                errors.append(f"{label} has a fact without a non-empty id")
                continue
            if fact_id in fact_ids:
                errors.append(f"duplicate required fact id: {fact_id}")
            fact_ids.add(fact_id)
            if category not in FACT_CATEGORIES:
                errors.append(f"{fact_id} has unsupported category: {category}")
                continue
            required_fields = {
                "file": ("path",),
                "symbol": ("path", "name"),
                "dependency": ("source", "target", "kind", "marker"),
                "evidence": ("path", "contains"),
            }[category]
            missing_fields = [name for name in required_fields if not isinstance(requirement.get(name), str) or not requirement[name]]
            if missing_fields:
                errors.append(f"{fact_id} is missing string fields: {', '.join(missing_fields)}")
            elif not _requirement_available(requirement, repo_root, index):
                errors.append(f"{fact_id} is not provable from the fixture repository")
    if errors:
        raise BenchmarkError("Invalid corpus manifest:\n- " + "\n- ".join(errors))


def _validate_handoff(handoff: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    errors.extend(validate_structure(handoff))
    errors.extend(validate_limits(handoff))
    errors.extend(validate_evidence_snippets(handoff))
    errors.extend(validate_field_types(handoff))
    errors.extend(f"Unredacted secret pattern: {warning}" for warning in scan_secrets(handoff))
    return errors


def _recover_from_handoff(requirements: list[dict[str, Any]], handoff: dict[str, Any], repo_root: Path) -> set[str]:
    key_files = {_relative(item.get("path", ""), repo_root) for item in handoff.get("key_files", [])}
    symbols = {(_relative(item.get("file", ""), repo_root), item.get("name")) for item in handoff.get("relevant_symbols", [])}
    dependencies = {
        (_posix(item.get("source", "")), _posix(item.get("target", "")), item.get("kind"))
        for item in handoff.get("dependency_map", [])
    }
    evidence = [(_relative(item.get("file", ""), repo_root), item.get("snippet", "")) for item in handoff.get("evidence", [])]
    recovered: set[str] = set()
    for requirement in requirements:
        category = requirement["category"]
        if category == "file" and requirement["path"] in key_files:
            recovered.add(requirement["id"])
        elif category == "symbol" and (requirement["path"], requirement["name"]) in symbols:
            recovered.add(requirement["id"])
        elif category == "dependency" and (requirement["source"], requirement["target"], requirement["kind"]) in dependencies:
            recovered.add(requirement["id"])
        elif category == "evidence":
            expected = requirement.get("handoff_contains", requirement["contains"])
            if any(path == requirement["path"] and expected in snippet for path, snippet in evidence):
                recovered.add(requirement["id"])
    return recovered


@dataclass
class EventLedger:
    scenario_id: str
    strategy: str
    events: list[dict[str, Any]] = field(default_factory=list)

    def record(
        self,
        tool: str,
        operation: str,
        detail: str,
        *,
        model_issued: bool,
        exit_code: int,
        result: str,
    ) -> None:
        self.events.append({
            "event_id": f"{self.scenario_id}:{self.strategy}:{len(self.events) + 1:02d}",
            "model_issued": model_issued,
            "tool": tool,
            "operation": operation,
            "detail": detail,
            "exit_code": exit_code,
            "result": result,
        })

    @property
    def bash_count(self) -> int:
        return sum(1 for event in self.events if event["model_issued"] and event["tool"] == "bash")


def _run_process(args: list[str], *, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    return subprocess.run(
        [sys.executable, *args],
        input=input_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
        check=False,
    )


def _json_stdout(process: subprocess.CompletedProcess[str], operation: str) -> dict[str, Any]:
    try:
        payload = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise BenchmarkError(f"{operation} returned invalid JSON (exit {process.returncode})") from error
    if not isinstance(payload, dict):
        raise BenchmarkError(f"{operation} returned a non-object JSON result")
    return payload


def _stage_result(operation: str, process: subprocess.CompletedProcess[str], payload: dict[str, Any] | None = None) -> str:
    if payload is None:
        return "completed" if process.returncode == 0 else "failed"
    if operation == "validate_handoff":
        return f"valid={str(bool(payload.get('valid'))).lower()} errors={len(payload.get('errors', []))}"
    status = payload.get("status", "ok" if process.returncode == 0 else "error")
    files = payload.get("files_indexed")
    errors = payload.get("errors")
    result = f"status={status}" + (f" files_indexed={files}" if isinstance(files, int) else "")
    return result + (f" errors={len(errors)}" if isinstance(errors, list) else "")


def _record_stage(
    ledger: EventLedger,
    *,
    tool: str,
    operation: str,
    detail: str,
    model_issued: bool,
    process: subprocess.CompletedProcess[str],
    payload: dict[str, Any] | None = None,
) -> None:
    ledger.record(
        tool,
        operation,
        detail,
        model_issued=model_issued,
        exit_code=process.returncode,
        result=_stage_result(operation, process, payload),
    )


def _build_index_stage(repo_root: Path, index_path: Path) -> tuple[subprocess.CompletedProcess[str], dict[str, Any]]:
    process = _run_process([str(BUILD_INDEX), "--repo", str(repo_root), "--output", str(index_path)])
    payload = _json_stdout(process, "build_index")
    return process, payload


def _execute_pipeline(
    strategy: str,
    scenario: dict[str, Any],
    repo_root: Path,
) -> tuple[dict[str, Any], list[str], EventLedger]:
    """Execute an independent helper pipeline and return its actual handoff."""
    ledger = EventLedger(scenario["id"], strategy)
    model_issued = strategy == "legacy_manual"
    stage_tool = "bash" if model_issued else "internal_process"
    include_evidence = scenario.get("include_evidence", False)

    with tempfile.TemporaryDirectory(prefix=f"repo-explorer-{strategy}-") as temporary:
        cache = Path(temporary)
        index_path = cache / f"{repo_root.name}-index.json"
        handoff_path = cache / "handoff.json"

        if scenario["index_state"] == "fresh":
            setup, setup_payload = _build_index_stage(repo_root, index_path)
            _record_stage(
                ledger,
                tool="internal_process",
                operation="prepare_fresh_index",
                detail="pre-existing cache fixture",
                model_issued=False,
                process=setup,
                payload=setup_payload,
            )
            if setup.returncode != 0:
                raise BenchmarkError("Cannot prepare fresh isolated index")

        refresh = _run_process([str(REFRESH_INDEX), "--repo", str(repo_root), "--data-dir", str(cache)])
        refresh_payload = _json_stdout(refresh, "refresh_index")
        _record_stage(
            ledger,
            tool=stage_tool,
            operation="refresh_index",
            detail="python refresh_repo_index.py --repo <CORPUS_ROOT> --data-dir <CACHE>",
            model_issued=model_issued,
            process=refresh,
            payload=refresh_payload,
        )
        if refresh.returncode == 1:
            build, build_payload = _build_index_stage(repo_root, index_path)
            _record_stage(
                ledger,
                tool=stage_tool,
                operation="build_index_fallback",
                detail="python build_repo_index.py --repo <CORPUS_ROOT> --output <CACHE>/index.json",
                model_issued=model_issued,
                process=build,
                payload=build_payload,
            )
            if build.returncode != 0:
                raise BenchmarkError("Index build fallback failed")
        elif refresh.returncode != 0:
            raise BenchmarkError("Index refresh failed")

        extract = _run_process([
            str(EXTRACT_HANDOFF),
            "--index", str(index_path),
            "--goal", scenario["goal"],
            "--depth", scenario["depth"],
            "--budget", "compact",
            "--include-evidence", "true" if include_evidence else "false",
            "--target-paths", str(repo_root),
        ])
        handoff = _json_stdout(extract, "extract_handoff")
        _record_stage(
            ledger,
            tool=stage_tool,
            operation="extract_handoff",
            detail=f"python extract_explorer_handoff.py --index <CACHE>/index.json --budget compact --include-evidence {str(include_evidence).lower()}",
            model_issued=model_issued,
            process=extract,
            payload={
                "status": "ok" if extract.returncode == 0 else "error",
                "errors": handoff.get("errors", []),
            },
        )
        if extract.returncode != 0:
            raise BenchmarkError("Handoff extraction failed")
        handoff_path.write_text(json.dumps(handoff, ensure_ascii=False), encoding="utf-8")

        validate = _run_process([str(VALIDATE_HANDOFF), "--input", str(handoff_path)])
        validate_payload = _json_stdout(validate, "validate_handoff")
        _record_stage(
            ledger,
            tool=stage_tool,
            operation="validate_handoff",
            detail="python validate_handoff.py --input <CACHE>/handoff.json",
            model_issued=model_issued,
            process=validate,
            payload=validate_payload,
        )
        validation_errors = list(validate_payload.get("errors", []))
        validation_errors.extend(error for error in _validate_handoff(handoff) if error not in validation_errors)
        return handoff, validation_errors, ledger


def _missing_by_category(requirements: list[dict[str, Any]], recovered: set[str]) -> dict[str, list[dict[str, Any]]]:
    grouped = {category: [] for category in FACT_CATEGORIES}
    for requirement in requirements:
        if requirement["id"] not in recovered:
            grouped[requirement["category"]].append(requirement)
    return {category: grouped[category] for category in FACT_CATEGORIES if grouped[category]}


def _coverage(required: list[dict[str, Any]], recovered: set[str]) -> dict[str, Any]:
    required_ids = [item["id"] for item in required]
    recovered_ids = sorted(set(required_ids) & recovered)
    missing_ids = sorted(set(required_ids) - recovered)
    percent = 100.0 if not required_ids else round(100.0 * len(recovered_ids) / len(required_ids), 6)
    return {
        "required": len(required_ids),
        "recovered": len(recovered_ids),
        "percent": percent,
        "recovered_fact_ids": recovered_ids,
        "missing_fact_ids": missing_ids,
    }


def _adapter_request(category: str, requirements: list[dict[str, Any]], repo_root: Path) -> dict[str, Any]:
    probes: list[dict[str, Any]] = []
    for item in requirements:
        probe = {"id": item["id"], "category": category}
        if category in {"file", "symbol", "evidence"}:
            probe["path"] = item["path"]
        if category == "symbol":
            probe["name"] = item["name"]
        elif category == "dependency":
            probe.update({key: item[key] for key in ("source", "target", "kind", "marker")})
        elif category == "evidence":
            probe["contains"] = item["contains"]
            probe["handoff_contains"] = item.get("handoff_contains", item["contains"])
        probes.append(probe)
    return {"repo_root": str(repo_root), "category": category, "probes": probes}


def _adapter_main() -> int:
    """Bounded subprocess adapter used by modeled follow-up events."""
    request = json.load(sys.stdin)
    repo_root = Path(request["repo_root"]).resolve()
    category = request["category"]
    observations: list[dict[str, Any]] = []
    for probe in request["probes"][:32]:
        observation = {"id": probe["id"], "matched": False}
        if category == "file":
            observation["matched"] = (repo_root / probe["path"]).is_file()
        elif category == "symbol":
            source = repo_root / probe["path"]
            if source.is_file() and source.stat().st_size <= 300_000:
                text = source.read_text(encoding="utf-8", errors="replace")
                observation["matched"] = re.search(rf"\b{re.escape(probe['name'])}\b", text) is not None
        elif category == "dependency":
            source = repo_root / probe["source"]
            target = repo_root / probe["target"]
            if source.is_file() and target.is_file() and source.stat().st_size <= 300_000:
                observation["matched"] = probe["marker"] in source.read_text(encoding="utf-8", errors="replace")
        elif category == "evidence":
            source = repo_root / probe["path"]
            if source.is_file() and source.stat().st_size <= 300_000:
                text = source.read_text(encoding="utf-8", errors="replace")[:300_000]
                redacted, _ = redact_secrets(text)
                expected = probe.get("handoff_contains", probe["contains"])
                observation["matched"] = expected in redacted
        observations.append(observation)
    print(json.dumps({"category": category, "observations": observations}, sort_keys=True))
    return 0


def default_native_followup_policy(
    scenario: dict[str, Any],
    handoff: dict[str, Any],
    missing: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Allow only bounded evidence reads explicitly justified by the handoff."""
    evidence_missing = missing.get("evidence", [])
    omitted_value = handoff.get("omitted")
    omitted = omitted_value if isinstance(omitted_value, dict) else {}
    reasons = omitted.get("reasons", []) if isinstance(omitted.get("reasons"), list) else []
    explicit_omission = isinstance(omitted.get("evidence"), int) and omitted["evidence"] > 0 and (
        "user-did-not-request-evidence" in reasons or "budget" in reasons
    )
    request = handoff.get("request") if isinstance(handoff.get("request"), dict) else {}
    targets = request.get("target_paths") if isinstance(request.get("target_paths"), list) else []
    base = Path(targets[0]) if targets and isinstance(targets[0], str) else Path()
    key_files = handoff.get("key_files") if isinstance(handoff.get("key_files"), list) else []
    discovered = {
        _relative(item.get("path", ""), base)
        for item in key_files
        if isinstance(item, dict)
    }
    eligible = [item for item in evidence_missing if explicit_omission and item["path"] in discovered]
    return [{
        "tool": "read",
        "category": "evidence",
        "requirements": eligible,
        "model_issued": True,
    }] if eligible else []


def _execute_followups(
    strategy: str,
    scenario: dict[str, Any],
    handoff: dict[str, Any],
    missing: dict[str, list[dict[str, Any]]],
    repo_root: Path,
    ledger: EventLedger,
    native_followup_policy: NativeFollowupPolicy,
) -> set[str]:
    if strategy == "legacy_manual":
        requests = [
            {"tool": "bash", "category": category, "requirements": requirements}
            for category, requirements in missing.items()
        ]
    else:
        requests = native_followup_policy(scenario, handoff, missing)

    recovered: set[str] = set()
    for request in requests:
        category = request.get("category")
        requirements = request.get("requirements", [])
        tool = request.get("tool")
        model_issued = request.get("model_issued", True)
        if (
            category not in FACT_CATEGORIES
            or not isinstance(requirements, list)
            or not requirements
            or not isinstance(tool, str)
            or not isinstance(model_issued, bool)
        ):
            continue
        adapter_input = _adapter_request(category, requirements, repo_root)
        process = _run_process([str(Path(__file__).resolve()), "--adapter"], input_text=json.dumps(adapter_input))
        payload = _json_stdout(process, f"targeted_{category}_adapter")
        matched = sorted(
            item["id"] for item in payload.get("observations", [])
            if isinstance(item, dict) and item.get("matched") is True and isinstance(item.get("id"), str)
        )
        recovered.update(matched)
        ledger.record(
            tool,
            f"targeted_{category}_fallback",
            f"bounded {category} adapter for {len(requirements)} fact(s)",
            model_issued=model_issued,
            exit_code=process.returncode,
            result=f"observations={len(payload.get('observations', []))} recovered={','.join(matched) or 'none'}",
        )
    return recovered


def _strategy_result(
    strategy: str,
    scenario: dict[str, Any],
    handoff: dict[str, Any],
    handoff_errors: list[str],
    repo_root: Path,
    ledger: EventLedger,
    native_followup_policy: NativeFollowupPolicy,
) -> dict[str, Any]:
    requirements = scenario["required_facts"]
    initially_recovered = _recover_from_handoff(requirements, handoff, repo_root)
    missing = _missing_by_category(requirements, initially_recovered)
    recovered = set(initially_recovered)
    recovered.update(_execute_followups(
        strategy, scenario, handoff, missing, repo_root, ledger, native_followup_policy
    ))
    initial_coverage = _coverage(requirements, initially_recovered)
    final_coverage = _coverage(requirements, recovered)
    non_evidence = [item for item in requirements if item["category"] != "evidence"]
    direct_non_evidence = _coverage(non_evidence, initially_recovered)
    return {
        "strategy": strategy,
        "strategy_version": STRATEGY_VERSIONS[strategy],
        "handoff_valid": not handoff_errors,
        "handoff_validation_errors": handoff_errors,
        "initial_handoff_coverage": initial_coverage,
        "direct_non_evidence_coverage": direct_non_evidence,
        "final_coverage": final_coverage,
        "fallback_categories": list(missing),
        "events": ledger.events,
        "event_count": len(ledger.events),
        "bash_event_count": ledger.bash_count,
        "correct": not handoff_errors and not final_coverage["missing_fact_ids"],
    }


def calculate_reduction(
    baseline_bash_calls: int,
    improved_bash_calls: int,
    *,
    correctness_gate_passed: bool,
    minimum_percent: float = 80.0,
) -> dict[str, Any]:
    """Calculate guarded Bash reduction; zero baseline never passes."""
    if baseline_bash_calls < 0 or improved_bash_calls < 0:
        raise BenchmarkError("Bash call counts must be non-negative")
    absolute_savings = baseline_bash_calls - improved_bash_calls
    if baseline_bash_calls == 0:
        return {
            "baseline_bash_calls": baseline_bash_calls,
            "improved_bash_calls": improved_bash_calls,
            "absolute_savings": absolute_savings,
            "reduction_percent": None,
            "reduction_defined": False,
            "correctness_gate_passed": correctness_gate_passed,
            "minimum_percent": minimum_percent,
            "meets_target": False,
            "reason": "baseline Bash call count is zero; percentage is undefined",
        }
    reduction = round(100.0 * absolute_savings / baseline_bash_calls, 6)
    meets_target = correctness_gate_passed and reduction >= minimum_percent
    reason = "target met" if meets_target else (
        "required-fact coverage, direct non-evidence coverage, or handoff validation failed"
        if not correctness_gate_passed else "reduction below target"
    )
    return {
        "baseline_bash_calls": baseline_bash_calls,
        "improved_bash_calls": improved_bash_calls,
        "absolute_savings": absolute_savings,
        "reduction_percent": reduction,
        "reduction_defined": True,
        "correctness_gate_passed": correctness_gate_passed,
        "minimum_percent": minimum_percent,
        "meets_target": meets_target,
        "reason": reason,
    }


def _aggregate_strategy(results: Iterable[dict[str, Any]]) -> dict[str, Any]:
    items = list(results)
    required = sum(item["final_coverage"]["required"] for item in items)
    recovered = sum(item["final_coverage"]["recovered"] for item in items)
    direct_required = sum(item["direct_non_evidence_coverage"]["required"] for item in items)
    direct_recovered = sum(item["direct_non_evidence_coverage"]["recovered"] for item in items)
    return {
        "scenario_count": len(items),
        "required_facts": required,
        "recovered_facts": recovered,
        "coverage_percent": 100.0 if required == 0 else round(100.0 * recovered / required, 6),
        "direct_non_evidence_required": direct_required,
        "direct_non_evidence_recovered": direct_recovered,
        "direct_non_evidence_coverage_percent": 100.0 if direct_required == 0 else round(100.0 * direct_recovered / direct_required, 6),
        "valid_handoffs": sum(1 for item in items if item["handoff_valid"]),
        "correct_scenarios": sum(1 for item in items if item["correct"]),
        "event_count": sum(item["event_count"] for item in items),
        "bash_event_count": sum(item["bash_event_count"] for item in items),
    }


def run_benchmark(
    corpus_dir: Path = DEFAULT_CORPUS,
    minimum_percent: float = 80.0,
    *,
    native_followup_policy: NativeFollowupPolicy = default_native_followup_policy,
    native_handoff_transform: NativeHandoffTransform | None = None,
) -> dict[str, Any]:
    corpus_dir = corpus_dir.resolve()
    repo_root = corpus_dir / "repo"
    if not repo_root.is_dir():
        raise BenchmarkError(f"Corpus repository not found: {repo_root}")
    manifest = load_manifest(corpus_dir)
    validation_index = scan_repo(repo_root)
    validate_manifest(manifest, corpus_dir, validation_index)

    scenario_results: list[dict[str, Any]] = []
    for scenario in manifest["scenarios"]:
        legacy_handoff, legacy_errors, legacy_ledger = _execute_pipeline("legacy_manual", scenario, repo_root)
        native_handoff, native_errors, native_ledger = _execute_pipeline("native_first", scenario, repo_root)
        native_ledger.events.insert(0, {
            "event_id": f"{scenario['id']}:native_first:00",
            "model_issued": True,
            "tool": "repo_explorer_explore",
            "operation": "explore",
            "detail": f"target=<CORPUS_ROOT> budget=compact includeEvidence={str(scenario.get('include_evidence', False)).lower()}",
            "exit_code": 0,
            "result": "native handoff returned",
        })
        if native_handoff_transform is not None:
            native_handoff = native_handoff_transform(scenario, native_handoff)
            native_errors = _validate_handoff(native_handoff)
        strategies = {
            "legacy_manual": _strategy_result(
                "legacy_manual", scenario, legacy_handoff, legacy_errors, repo_root, legacy_ledger, native_followup_policy
            ),
            "native_first": _strategy_result(
                "native_first", scenario, native_handoff, native_errors, repo_root, native_ledger, native_followup_policy
            ),
        }
        scenario_results.append({
            "id": scenario["id"],
            "goal": scenario["goal"],
            "depth": scenario["depth"],
            "index_state": scenario["index_state"],
            "include_evidence": scenario.get("include_evidence", False),
            "required_fact_ids": sorted(item["id"] for item in scenario["required_facts"]),
            "strategies": strategies,
        })

    aggregates = {
        strategy: _aggregate_strategy(item["strategies"][strategy] for item in scenario_results)
        for strategy in ("legacy_manual", "native_first")
    }
    scenario_count = len(scenario_results)
    full_correctness = all(
        aggregate["coverage_percent"] == 100.0
        and aggregate["valid_handoffs"] == scenario_count
        and aggregate["correct_scenarios"] == scenario_count
        for aggregate in aggregates.values()
    )
    direct_non_evidence_gate = all(
        aggregate["direct_non_evidence_coverage_percent"] == 100.0 for aggregate in aggregates.values()
    )
    correctness_gate_passed = full_correctness and direct_non_evidence_gate
    reduction = calculate_reduction(
        aggregates["legacy_manual"]["bash_event_count"],
        aggregates["native_first"]["bash_event_count"],
        correctness_gate_passed=correctness_gate_passed,
        minimum_percent=minimum_percent,
    )
    native_events = [
        event for scenario in scenario_results for event in scenario["strategies"]["native_first"]["events"]
    ]
    improved_has_zero_model_bash = not any(event["model_issued"] and event["tool"] == "bash" for event in native_events)
    improved_has_one_native_event = all(
        sum(
            event["model_issued"] and event["tool"] == "repo_explorer_explore"
            for event in scenario["strategies"]["native_first"]["events"]
        ) == 1
        for scenario in scenario_results
    )
    native_internal_events_recorded = all(
        any(not event["model_issued"] and event["tool"] == "internal_process" for event in scenario["strategies"]["native_first"]["events"])
        for scenario in scenario_results
    )
    native_internal_events_excluded = all(
        scenario["strategies"]["native_first"]["bash_event_count"]
        == sum(
            event["model_issued"] and event["tool"] == "bash"
            for event in scenario["strategies"]["native_first"]["events"]
        )
        for scenario in scenario_results
    )

    digest = corpus_digest(corpus_dir)
    config_material = json.dumps({
        "corpus_digest": digest,
        "minimum_percent": minimum_percent,
        "strategy_versions": STRATEGY_VERSIONS,
    }, sort_keys=True, separators=(",", ":"))
    result = {
        "schema_version": BENCHMARK_SCHEMA_VERSION,
        "benchmark_id": "repo-explorer-agent-visible-bash-v2",
        "corpus_config_id": hashlib.sha256(config_material.encode("utf-8")).hexdigest()[:16],
        "metric": {
            "unit": "model-issued bash tool invocation",
            "counts_native_internal_subprocesses": False,
            "normalization": "absolute corpus/cache roots and runtime timestamps are excluded",
        },
        "corpus": {
            "id": manifest.get("corpus_id", "unknown"),
            "digest_sha256": digest,
            "coverage_tags": sorted(manifest["coverage_tags"]),
            "file_count": len(validation_index.get("files", [])),
            "scenario_count": scenario_count,
            "required_fact_count": sum(len(item["required_fact_ids"]) for item in scenario_results),
        },
        "strategy_versions": STRATEGY_VERSIONS,
        "scenarios": scenario_results,
        "aggregates": aggregates,
        "reduction": reduction,
        "invariants": {
            "improved_has_one_native_event_per_scenario": improved_has_one_native_event,
            "improved_has_zero_model_bash": improved_has_zero_model_bash,
            "native_internal_events_recorded": native_internal_events_recorded,
            "native_internal_events_excluded_from_bash_count": native_internal_events_excluded,
            "both_strategies_have_full_coverage": full_correctness,
            "both_strategies_have_full_direct_non_evidence_coverage": direct_non_evidence_gate,
        },
        "benchmark_passed": reduction["meets_target"]
        and improved_has_one_native_event
        and improved_has_zero_model_bash
        and native_internal_events_recorded
        and native_internal_events_excluded,
    }
    normalized = json.dumps(result, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    result["result_content_digest_sha256"] = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return result


def render_markdown(result: dict[str, Any]) -> str:
    reduction = result["reduction"]
    reduction_text = "undefined" if reduction["reduction_percent"] is None else f"{reduction['reduction_percent']:.6f}%"
    status = "PASS" if result["benchmark_passed"] else "FAIL"
    lines = [
        "# Repo Explorer Agent-Visible Bash Benchmark",
        "",
        f"- Status: **{status}**",
        f"- Corpus/config ID: `{result['corpus_config_id']}`",
        f"- Result content digest: `{result['result_content_digest_sha256']}`",
        f"- Corpus: `{result['corpus']['id']}` (`{result['corpus']['digest_sha256']}`)",
        f"- Metric: {result['metric']['unit']}",
        f"- Native internal subprocesses counted: {str(result['metric']['counts_native_internal_subprocesses']).lower()}",
        "",
        "## Aggregate",
        "",
        "| Strategy | Scenarios | Required facts | Coverage | Direct non-evidence | Valid handoffs | Bash events |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for strategy in ("legacy_manual", "native_first"):
        aggregate = result["aggregates"][strategy]
        lines.append(
            f"| `{strategy}` | {aggregate['scenario_count']} | {aggregate['required_facts']} | "
            f"{aggregate['coverage_percent']:.6f}% | {aggregate['direct_non_evidence_coverage_percent']:.6f}% | "
            f"{aggregate['valid_handoffs']} | {aggregate['bash_event_count']} |"
        )
    lines.extend([
        "",
        f"- Absolute Bash savings: **{reduction['absolute_savings']}**",
        f"- Reduction: **{reduction_text}**",
        f"- Correctness gate passed: **{str(reduction['correctness_gate_passed']).lower()}**",
        f"- Required minimum: **{reduction['minimum_percent']:.6f}%**",
        f"- Result: {reduction['reason']}",
        "",
        "## Scenarios",
        "",
        "| Scenario | Facts | Legacy Bash | Native Bash | Native fallback categories |",
        "|---|---:|---:|---:|---|",
    ])
    for scenario in result["scenarios"]:
        legacy = scenario["strategies"]["legacy_manual"]
        native = scenario["strategies"]["native_first"]
        fallbacks = ", ".join(native["fallback_categories"]) or "none"
        lines.append(
            f"| `{scenario['id']}` | {len(scenario['required_fact_ids'])} | {legacy['bash_event_count']} | "
            f"{native['bash_event_count']} | {fallbacks} |"
        )
    lines.extend(["", "## Event Ledgers", ""])
    for scenario in result["scenarios"]:
        lines.extend([f"### {scenario['id']}", ""])
        for strategy in ("legacy_manual", "native_first"):
            lines.extend([f"**{strategy}**", ""])
            for event in scenario["strategies"][strategy]["events"]:
                visibility = "model" if event["model_issued"] else "internal"
                lines.append(
                    f"- `{event['event_id']}` `{event['tool']}` / `{event['operation']}` ({visibility}, exit {event['exit_code']}) "
                    f"— {event['detail']} — {event['result']}"
                )
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def write_outputs(result: dict[str, Any], json_path: Path | None, markdown_path: Path | None) -> None:
    if json_path:
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    if markdown_path:
        markdown_path.parent.mkdir(parents=True, exist_ok=True)
        markdown_path.write_text(render_markdown(result), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv == ["--adapter"]:
        return _adapter_main()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS, help="Corpus directory containing manifest.json and repo/")
    parser.add_argument("--json-out", type=Path, help="Write normalized machine-readable results")
    parser.add_argument("--markdown-out", type=Path, help="Write normalized Markdown results")
    parser.add_argument("--minimum-reduction", type=float, default=80.0, help="Required aggregate Bash reduction percentage")
    args = parser.parse_args(argv)
    try:
        result = run_benchmark(args.corpus, args.minimum_reduction)
        write_outputs(result, args.json_out, args.markdown_out)
    except BenchmarkError as error:
        print(f"benchmark error: {error}", file=sys.stderr)
        return 2
    if not args.json_out and not args.markdown_out:
        print(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False))
    else:
        print(json.dumps({
            "status": "passed" if result["benchmark_passed"] else "failed",
            "corpus_config_id": result["corpus_config_id"],
            "result_content_digest_sha256": result["result_content_digest_sha256"],
            "json_out": str(args.json_out) if args.json_out else None,
            "markdown_out": str(args.markdown_out) if args.markdown_out else None,
            "baseline_bash_calls": result["reduction"]["baseline_bash_calls"],
            "improved_bash_calls": result["reduction"]["improved_bash_calls"],
            "reduction_percent": result["reduction"]["reduction_percent"],
        }, sort_keys=True))
    return 0 if result["benchmark_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
