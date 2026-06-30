import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = SKILL_DIR.parents[1]
SCRIPTS_DIR = SKILL_DIR / "scripts"
CREATE_DRAFT = SCRIPTS_DIR / "skill_create_draft.mjs"
EXAMPLE_NOTES = SKILL_DIR / "examples" / "example-successful-trajectory.md"


def _run(args, *, env=None, check=True):
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env or os.environ.copy(),
    )
    if check and result.returncode != 0:
        raise AssertionError(
            f"Command failed: {args}\nexit={result.returncode}\nstdout={result.stdout}\nstderr={result.stderr}"
        )
    return result


class SkillCreatorPackageTests(unittest.TestCase):
    def test_package_registers_skill_native_tools_and_portability_reference(self):
        package_json = json.loads((PACKAGE_ROOT / "package.json").read_text(encoding="utf-8"))
        extension = PACKAGE_ROOT / "extensions" / "skill-creator.ts"
        skill = SKILL_DIR / "SKILL.md"
        portability_reference = SKILL_DIR / "references" / "SKILL-PORTABILITY.md"
        quality_reference = SKILL_DIR / "references" / "SKILL-QUALITY-GUIDE.md"

        self.assertIn("./skills", package_json["pi"]["skills"])
        self.assertIn("./extensions", package_json["pi"]["extensions"])
        self.assertTrue(extension.exists())
        self.assertTrue(skill.exists())
        self.assertTrue(portability_reference.exists())
        self.assertTrue(quality_reference.exists())
        self.assertIn("Portable core rules", portability_reference.read_text(encoding="utf-8"))
        self.assertIn("Authoring quality gate", quality_reference.read_text(encoding="utf-8"))
        self.assertIn("SKILL-QUALITY-GUIDE.md", skill.read_text(encoding="utf-8"))

        source = extension.read_text(encoding="utf-8")
        for tool_name in ["skill_create_draft", "skill_create_from_notes", "skill_create_from_patch"]:
            self.assertIn(f'name: "{tool_name}"', source)
        for option_name in ["invocation", "leadingWords", "branches", "shouldTrigger", "shouldNotTrigger", "discloseReference"]:
            self.assertIn(option_name, source)

    def test_cli_generates_disabled_draft_with_contract_test(self):
        with tempfile.TemporaryDirectory() as tmp:
            agent_dir = Path(tmp) / "agent"
            env = os.environ.copy()
            env["PI_CODING_AGENT_DIR"] = str(agent_dir)

            result = _run([
                "node",
                str(CREATE_DRAFT),
                "--name",
                "Example Repeatable Workflow",
                "--source-notes",
                str(EXAMPLE_NOTES),
                "--reusability",
                "repeated-3-plus",
                "--reuse-count",
                "3",
                "--reusability-evidence",
                "Used successfully for three similar Pi package maintenance tasks.",
                "--with-tests",
                "--json",
            ], env=env)

            payload = json.loads(result.stdout)
            skill_path = Path(payload["skillPath"])
            self.assertTrue(payload["ok"], payload)
            self.assertEqual(skill_path, agent_dir / "drafts" / "skills" / "example-repeatable-workflow" / "SKILL.md")
            self.assertTrue(skill_path.exists())

            text = skill_path.read_text(encoding="utf-8")
            self.assertIn("name: example-repeatable-workflow", text)
            for section in [
                "## When to Use",
                "## Invocation Design",
                "## Workflow",
                "## References",
                "## Verification",
                "## Quality Review",
                "## Safety and Failure Modes",
            ]:
                self.assertIn(section, text)
            self.assertIn("### Should trigger", text)
            self.assertIn("### Should not trigger", text)
            self.assertIn("Invocation mode: model-invoked", text)
            self.assertIn("Completion criterion:", text)
            self.assertIn("no broad catch-all", text)
            self.assertIn("disabled draft", text)
            self.assertIsNone(re.search(r"/(home|Users)/[A-Za-z0-9._-]+", text))

            test_result = _run([
                sys.executable,
                "-m",
                "unittest",
                "discover",
                "-s",
                str(skill_path.parent / "tests"),
                "-p",
                "test_*.py",
            ])
            self.assertIn("OK", test_result.stderr)

    def test_cli_supports_user_invocation_and_disclosed_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            agent_dir = Path(tmp) / "agent"
            env = os.environ.copy()
            env["PI_CODING_AGENT_DIR"] = str(agent_dir)

            result = _run([
                "node",
                str(CREATE_DRAFT),
                "--name",
                "Manual Skill Polish",
                "--source-notes",
                str(EXAMPLE_NOTES),
                "--reusability",
                "confirmed",
                "--reusability-evidence",
                "Human confirmed this is a reusable manual authoring reference.",
                "--invocation",
                "user",
                "--leading-word",
                "polish",
                "--branch",
                "manual skill editing review",
                "--should-trigger",
                "User explicitly asks to polish a draft skill",
                "--should-not-trigger",
                "User asks for unrelated code formatting",
                "--disclose-reference",
                "--json",
            ], env=env)

            payload = json.loads(result.stdout)
            skill_path = Path(payload["skillPath"])
            reference_path = skill_path.parent / "references" / "source-reference.md"
            self.assertTrue(payload["ok"], payload)
            self.assertTrue(reference_path.exists())
            self.assertIn(str(reference_path), payload["filesWritten"])
            self.assertIn("Disclosed sanitized source material", "\n".join(payload["warnings"]))

            text = skill_path.read_text(encoding="utf-8")
            self.assertIn("disable-model-invocation: true", text)
            self.assertIn("Invocation mode: user-invoked", text)
            self.assertIn("`polish`", text)
            self.assertIn("manual skill editing review", text)
            self.assertIn("User explicitly asks to polish a draft skill.", text)
            self.assertIn("User asks for unrelated code formatting.", text)
            self.assertIn("references/source-reference.md", text)

    def test_cli_blocks_unknown_reusability(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy()
            env["PI_CODING_AGENT_DIR"] = str(Path(tmp) / "agent")
            result = _run([
                "node",
                str(CREATE_DRAFT),
                "--name",
                "one-off",
                "--source-notes",
                str(EXAMPLE_NOTES),
                "--reusability",
                "unknown",
                "--reusability-evidence",
                "Not enough evidence.",
                "--json",
            ], env=env, check=False)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Draft creation blocked", result.stderr)

    def test_cli_refuses_auto_discovered_skill_root_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            agent_dir = Path(tmp) / "agent"
            env = os.environ.copy()
            env["PI_CODING_AGENT_DIR"] = str(agent_dir)
            unsafe_output = agent_dir / "skills" / "drafts" / "unsafe"

            result = _run([
                "node",
                str(CREATE_DRAFT),
                "--name",
                "unsafe-draft",
                "--source-notes",
                str(EXAMPLE_NOTES),
                "--reusability",
                "confirmed",
                "--reusability-evidence",
                "Human confirmed this should become a reusable skill.",
                "--output",
                str(unsafe_output),
                "--json",
            ], env=env, check=False)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Refusing to write", result.stderr)
            self.assertFalse((unsafe_output / "SKILL.md").exists())

    def test_package_skeleton_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "pi-skill-example-repeatable-workflow"
            result = _run([
                "node",
                str(CREATE_DRAFT),
                "--name",
                "example-repeatable-workflow",
                "--source-notes",
                str(EXAMPLE_NOTES),
                "--reusability",
                "strategic-reuse",
                "--reusability-evidence",
                "Likely to recur across Pi package maintenance tasks.",
                "--package-skeleton",
                "--output",
                str(out),
                "--with-tests",
                "--json",
            ])

            payload = json.loads(result.stdout)
            self.assertTrue(payload["ok"], payload)
            self.assertTrue((out / "package.json").exists())
            self.assertTrue((out / "README.md").exists())
            self.assertTrue((out / "LICENSE").exists())
            self.assertTrue((out / "skills" / "example-repeatable-workflow" / "SKILL.md").exists())


if __name__ == "__main__":
    unittest.main()
