import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = SKILL_DIR.parents[1]
REPO_ROOT = PACKAGE_ROOT.parent
SKILL = SKILL_DIR / "SKILL.md"
TEMPLATE = SKILL_DIR / "assets" / "starter-template.html"
VALIDATOR = SKILL_DIR / "scripts" / "validate_report.py"
FIXTURE = SKILL_DIR / "tests" / "fixtures" / "minimal-report.html"
FULL_FIXTURE = SKILL_DIR / "tests" / "fixtures" / "full-feature-report.html"
DESIGN_VARIANTS_DIR = SKILL_DIR / "tests" / "fixtures" / "design-variants"
DESIGN_VARIANT_NAMES = [
    "11-sidebar-docs.html",
    "12-longform-editorial.html",
    "13-marginal-layout.html",
    "14-compact-console.html",
    "15-graphic-poster.html",
    "16-minimal-landing.html",
    "17-terminal-readme.html",
    "18-dark-product.html",
    "19-industrial-spec.html",
    "20-rounded-corporate.html",
]
ROUTING = PACKAGE_ROOT / "tests" / "routing" / "html-report.json"


class HtmlReportContractTests(unittest.TestCase):
    def test_frontmatter_and_required_sections(self):
        text = SKILL.read_text(encoding="utf-8")
        self.assertRegex(
            text,
            r"^---\s*\n[\s\S]*?name:\s*html-report[\s\S]*?description:\s*.+[\s\S]*?license:\s*MIT[\s\S]*?\n---",
        )
        for section in [
            "## When to Use",
            "## Invocation Design",
            "## Inputs and Assumptions",
            "## Portable Workflow",
            "## Output Contract",
            "## Scripts, References, and Dependencies",
            "## Verification",
            "## Quality Review",
            "## Safety and Failure Modes",
            "## Pi Adapter",
        ]:
            self.assertIn(section, text)
        self.assertIn("### Should trigger", text)
        self.assertIn("### Should not trigger", text)
        self.assertIn("Completion criterion:", text)

    def test_requested_capabilities_are_contractual(self):
        text = SKILL.read_text(encoding="utf-8").lower()
        for phrase in [
            "overview table",
            "graphs only for quantitative data",
            "diagrams only for meaningful relationships",
            "inline svg",
            "accessible tabs",
            "2,500",
            "print css",
            "interactive controls only when they serve a concrete reader task",
            "progressive enhancement",
            "no runtime package or browser build dependency",
        ]:
            self.assertIn(phrase, text)

    def test_final_response_requires_clickable_report_link(self):
        text = SKILL.read_text(encoding="utf-8")
        self.assertIn("final assistant response must always end", text.lower())
        self.assertIn("standalone clickable Markdown link", text)
        self.assertIn("[report-name.html](/absolute/path/to/report-name.html)", text)
        self.assertIn("final non-empty line", text)

    def test_bundled_resources_exist(self):
        expected = [
            TEMPLATE,
            VALIDATOR,
            FIXTURE,
            FULL_FIXTURE,
            ROUTING,
            SKILL_DIR / "references" / "DESIGN-SYSTEM.md",
            SKILL_DIR / "references" / "CONTENT-ARCHITECTURE.md",
            SKILL_DIR / "references" / "VISUAL-DECISIONS.md",
            SKILL_DIR / "references" / "INTERACTION-DESIGN.md",
        ]
        for path in expected:
            self.assertTrue(path.is_file(), f"missing {path.relative_to(PACKAGE_ROOT)}")

    def test_template_reproduces_design_and_new_components(self):
        text = TEMPLATE.read_text(encoding="utf-8")
        for token in [
            "--bg: #0b1220",
            "radial-gradient",
            "--panel: #121c2d",
            "--green: #50d890",
            "--yellow: #f7c65c",
            "--red: #ff7373",
            "--blue: #65b5ff",
            "data-overview",
            'role="tablist"',
            'role="tab"',
            'role="tabpanel"',
            'data-visual-kind="graph"',
            'data-visual-kind="diagram"',
            'role="img"',
            "ArrowRight",
            "ArrowLeft",
            "Home",
            "End",
            "location.hash",
            'data-report-action="print"',
            'data-report-action="copy-link"',
            'data-report-action="focus-mode"',
            'data-search-action="previous-match"',
            'data-search-action="next-match"',
            'data-search-action="clear-search"',
            "reading-progress",
            "reader-nav",
            "toggle-complete",
            "focus-reading",
            "report-match",
            "Alt+/",
            "data-enhanced-control",
            "interactions-ready",
            "data-copyable",
            'data-details-action="expand"',
            'data-details-action="collapse"',
            'aria-live="polite"',
            "navigator.clipboard",
            "document.execCommand('copy')",
            "@media print",
            "@media (max-width: 620px)",
            "prefers-reduced-motion",
        ]:
            self.assertIn(token, text)
        self.assertNotRegex(text, r"<(?:script|img)[^>]+(?:src)=['\"]https?://")
        self.assertNotRegex(text, r"<link[^>]+href=['\"]https?://")

    def test_validator_accepts_strict_fixture(self):
        completed = subprocess.run(
            ["python3", str(VALIDATOR), str(FIXTURE), "--strict"],
            check=False,
            text=True,
            capture_output=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        result = json.loads(completed.stdout)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["metrics"]["overview_tables"], 1)
        self.assertEqual(result["metrics"]["visuals"], 1)

    def test_validator_accepts_full_feature_fixture(self):
        completed = subprocess.run(
            ["python3", str(VALIDATOR), str(FULL_FIXTURE), "--strict"],
            check=False,
            text=True,
            capture_output=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        result = json.loads(completed.stdout)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["metrics"]["overview_tables"], 1)
        self.assertEqual(result["metrics"]["tabs"], 5)
        self.assertEqual(result["metrics"]["tabpanels"], 5)
        self.assertEqual(result["metrics"]["visuals"], 2)
        self.assertEqual(result["metrics"]["svgs"], 2)
        self.assertEqual(result["metrics"]["interactive_controls"], 8)
        self.assertEqual(result["metrics"]["copyable_blocks"], 2)
        self.assertEqual(result["metrics"]["live_regions"], 2)
        self.assertEqual(result["metrics"]["remote_dependencies"], 0)

        text = FULL_FIXTURE.read_text(encoding="utf-8")
        for feature in [
            'class="skip-link"',
            'class="metric"',
            'class="finding"',
            'class="callout"',
            'class="callout info-callout"',
            'class="steps"',
            "<details",
            "<pre data-copyable><code>",
            'data-report-action="print"',
            'data-report-action="copy-link"',
            'data-report-action="focus-mode"',
            'data-search-action="previous-match"',
            'data-search-action="next-match"',
            'data-search-action="clear-search"',
            "reading-progress",
            "reader-nav",
            "toggle-complete",
            "focus-reading",
            "report-match",
            'data-details-action="expand"',
            'data-details-action="collapse"',
            'aria-live="polite"',
            "navigator.clipboard",
            "document.execCommand('copy')",
            "prefers-reduced-motion",
            "@media print",
        ]:
            self.assertIn(feature, text)

    def test_design_variants_preserve_content_and_validate(self):
        canonical = FULL_FIXTURE.read_text(encoding="utf-8")
        canonical_body = canonical.split("<body>", 1)[1]
        candidates = sorted(DESIGN_VARIANTS_DIR.glob("*.html"))
        self.assertEqual([path.name for path in candidates], DESIGN_VARIANT_NAMES)

        markers = set()
        for candidate in candidates:
            text = candidate.read_text(encoding="utf-8")
            self.assertEqual(
                text.split("<body>", 1)[1],
                canonical_body,
                f"visible content or behavior drifted in {candidate.name}",
            )
            marker = re.search(r'data-design-variant="([^"]+)"', text)
            self.assertIsNotNone(marker, f"missing design marker in {candidate.name}")
            markers.add(marker.group(1))

            completed = subprocess.run(
                ["python3", str(VALIDATOR), str(candidate), "--strict"],
                check=False,
                text=True,
                capture_output=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            result = json.loads(completed.stdout)
            self.assertEqual(result["status"], "PASS")
            self.assertEqual(result["metrics"]["remote_dependencies"], 0)

        self.assertEqual(len(markers), len(DESIGN_VARIANT_NAMES))

    def test_validator_rejects_unresolved_template(self):
        completed = subprocess.run(
            ["python3", str(VALIDATOR), str(TEMPLATE), "--strict"],
            check=False,
            text=True,
            capture_output=True,
        )
        self.assertEqual(completed.returncode, 1, completed.stdout + completed.stderr)
        result = json.loads(completed.stdout)
        self.assertTrue(any("Unresolved placeholders" in item for item in result["errors"]))

    def test_validator_requires_tabs_for_long_reports(self):
        original = FIXTURE.read_text(encoding="utf-8")
        extra_sections = "".join(
            f'<section class="report-section"><h2>Phase {index}</h2><p>Verified implementation detail.</p></section>'
            for index in range(1, 7)
        )
        mutated = original.replace("</main>", extra_sections + "</main>")
        with tempfile.TemporaryDirectory() as tmp:
            candidate = Path(tmp) / "long.html"
            candidate.write_text(mutated, encoding="utf-8")
            completed = subprocess.run(
                ["python3", str(VALIDATOR), str(candidate), "--strict"],
                check=False,
                text=True,
                capture_output=True,
            )
        self.assertEqual(completed.returncode, 1, completed.stdout + completed.stderr)
        result = json.loads(completed.stdout)
        self.assertTrue(any("without accessible tabs" in item for item in result["errors"]))

    def test_routing_fixture_has_clear_positive_and_negative_examples(self):
        fixture = json.loads(ROUTING.read_text(encoding="utf-8"))
        self.assertEqual(fixture["skill"], "html-report")
        self.assertGreaterEqual(len(fixture["should_trigger"]), 3)
        self.assertGreaterEqual(len(fixture["should_not_trigger"]), 3)
        self.assertFalse(set(fixture["should_trigger"]) & set(fixture["should_not_trigger"]))
        self.assertGreaterEqual(len(fixture.get("ambiguous", [])), 1)

    def test_package_has_no_private_home_paths_or_secret_markers(self):
        private_path = re.compile(r"/(?:home|Users)/[A-Za-z0-9._-]+")
        secret = re.compile(r"(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})")
        suffixes = {".md", ".json", ".html", ".py", ".css", ".js"}
        for path in PACKAGE_ROOT.rglob("*"):
            if path.is_file() and path.suffix in suffixes:
                text = path.read_text(encoding="utf-8")
                self.assertIsNone(private_path.search(text), f"private path in {path.relative_to(PACKAGE_ROOT)}")
                self.assertIsNone(secret.search(text), f"secret-like token in {path.relative_to(PACKAGE_ROOT)}")

    def test_package_metadata_exposes_only_the_skill(self):
        package = json.loads((PACKAGE_ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["name"], "@firstpick/pi-skill-html-report")
        self.assertIn("pi-package", package["keywords"])
        self.assertEqual(package["pi"]["skills"], ["./skills"])
        self.assertNotIn("extensions", package["pi"])


if __name__ == "__main__":
    unittest.main()
