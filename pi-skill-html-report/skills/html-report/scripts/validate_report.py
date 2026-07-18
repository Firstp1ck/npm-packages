#!/usr/bin/env python3
"""Validate generated complex-explanation HTML reports using only stdlib."""

from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

PLACEHOLDER_RE = re.compile(r"\{\{[^{}]+\}\}|\b(?:TODO|FIXME)\b", re.IGNORECASE)
WORD_RE = re.compile(r"\b[\w'-]+\b", re.UNICODE)
REMOTE_SCHEMES = {"http", "https", "//"}


class ReportParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.html_lang = ""
        self.viewport = False
        self.main_count = 0
        self.overview_tables = 0
        self.major_sections = 0
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []
        self.style_parts: list[str] = []
        self.script_parts: list[str] = []
        self.local_dependencies: list[str] = []
        self.remote_dependencies: list[str] = []
        self.images_without_alt: list[str] = []
        self.tabs: list[dict[str, str]] = []
        self.tabpanels: list[dict[str, str]] = []
        self.tablists = 0
        self.ids: set[str] = set()
        self.visuals: list[dict[str, str]] = []
        self.svgs: list[dict[str, object]] = []
        self.interactive_controls: list[dict[str, str]] = []
        self.copyable_blocks = 0
        self.live_regions = 0
        self._svg_stack: list[dict[str, object]] = []
        self._in_document_title = False
        self._in_style = False
        self._in_script = False

    @staticmethod
    def _attrs(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
        return {key: value or "" for key, value in attrs}

    def handle_decl(self, decl: str) -> None:
        pass

    def handle_starttag(self, tag: str, attrs_raw: list[tuple[str, str | None]]) -> None:
        attrs = self._attrs(attrs_raw)
        element_id = attrs.get("id")
        if element_id:
            self.ids.add(element_id)

        if any(key in attrs for key in ("data-report-action", "data-details-action", "data-search-action")):
            self.interactive_controls.append({"tag": tag, **attrs})
        if tag == "pre" and "data-copyable" in attrs:
            self.copyable_blocks += 1
        if attrs.get("aria-live") in {"polite", "assertive"}:
            self.live_regions += 1

        if tag == "html":
            self.html_lang = attrs.get("lang", "").strip()
        elif tag == "meta" and attrs.get("name", "").lower() == "viewport":
            self.viewport = bool(attrs.get("content", "").strip())
        elif tag == "main":
            self.main_count += 1
        elif tag == "section":
            classes = set(attrs.get("class", "").split())
            if "report-section" in classes or attrs.get("role") == "tabpanel":
                self.major_sections += 1
            if attrs.get("role") == "tabpanel":
                self.tabpanels.append(attrs)
        elif tag == "table" and "data-overview" in attrs:
            self.overview_tables += 1
        elif tag == "title":
            if self._svg_stack:
                self._svg_stack[-1]["has_title"] = True
            else:
                self._in_document_title = True
        elif tag == "desc" and self._svg_stack:
            self._svg_stack[-1]["has_desc"] = True
        elif tag == "style":
            self._in_style = True
        elif tag == "script":
            self._in_script = True
            src = attrs.get("src", "").strip()
            if src:
                self._record_dependency(src)
        elif tag == "link" and "stylesheet" in attrs.get("rel", "").lower().split():
            href = attrs.get("href", "").strip()
            if href:
                self._record_dependency(href)
        elif tag == "img":
            src = attrs.get("src", "").strip()
            if src:
                self._record_dependency(src)
            if "alt" not in attrs:
                self.images_without_alt.append(src or "<inline image>")
        elif tag == "nav" and attrs.get("role") == "tablist":
            self.tablists += 1
        elif attrs.get("role") == "tab":
            self.tabs.append(attrs)
        elif attrs.get("role") == "tabpanel":
            self.tabpanels.append(attrs)
        elif tag == "figure" and attrs.get("data-visual-kind"):
            self.visuals.append(attrs)
        elif tag == "svg":
            svg: dict[str, object] = {
                "role": attrs.get("role", ""),
                "aria_label": attrs.get("aria-label", ""),
                "aria_labelledby": attrs.get("aria-labelledby", ""),
                "has_title": False,
                "has_desc": False,
            }
            self.svgs.append(svg)
            self._svg_stack.append(svg)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title" and not self._svg_stack:
            self._in_document_title = False
        elif tag == "style":
            self._in_style = False
        elif tag == "script":
            self._in_script = False
        elif tag == "svg" and self._svg_stack:
            self._svg_stack.pop()

    def handle_data(self, data: str) -> None:
        if self._in_style:
            self.style_parts.append(data)
        elif self._in_script:
            self.script_parts.append(data)
        elif self._in_document_title:
            self.title_parts.append(data)
        else:
            self.text_parts.append(data)

    def _record_dependency(self, ref: str) -> None:
        if ref.startswith(("#", "data:", "mailto:", "tel:")):
            return
        parsed = urlparse(ref)
        if parsed.scheme in {"http", "https"} or ref.startswith("//"):
            self.remote_dependencies.append(ref)
        else:
            self.local_dependencies.append(ref.split("#", 1)[0].split("?", 1)[0])


def audit_report(path: Path, strict: bool = False) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    parser = ReportParser()
    parser.feed(text)

    errors: list[str] = []
    warnings: list[str] = []
    title = " ".join(parser.title_parts).strip()
    visible_text = " ".join(parser.text_parts)
    word_count = len(WORD_RE.findall(visible_text))
    css = "\n".join(parser.style_parts)
    js = "\n".join(parser.script_parts)

    if not re.match(r"^\s*<!doctype\s+html\s*>", text, re.IGNORECASE):
        errors.append("Missing HTML5 doctype.")
    if not parser.html_lang:
        errors.append("The <html> element needs a non-empty lang attribute.")
    if not title:
        errors.append("The document needs a non-empty <title>.")
    if not parser.viewport:
        errors.append("Missing viewport metadata.")
    if parser.main_count != 1:
        errors.append(f"Expected exactly one <main> landmark; found {parser.main_count}.")
    if parser.overview_tables < 1:
        errors.append("Missing mandatory overview table marked with data-overview.")
    if "@media" not in css or "max-width" not in css:
        errors.append("Responsive CSS media rules were not detected.")
    if not re.search(r"@media\s+print", css, re.IGNORECASE):
        errors.append("Print CSS was not detected.")

    placeholders = sorted(set(match.group(0) for match in PLACEHOLDER_RE.finditer(text)))
    if placeholders:
        message = f"Unresolved placeholders/markers found: {', '.join(placeholders[:8])}"
        (errors if strict else warnings).append(message)

    report_dir = path.parent
    missing_refs = []
    for ref in sorted(set(filter(None, parser.local_dependencies))):
        target = Path(ref) if Path(ref).is_absolute() else report_dir / ref
        if not target.exists():
            missing_refs.append(ref)
    if missing_refs:
        errors.append(f"Missing local dependencies: {', '.join(missing_refs)}")
    if parser.remote_dependencies:
        message = "External runtime dependencies detected: " + ", ".join(sorted(set(parser.remote_dependencies)))
        (errors if strict else warnings).append(message)
    if parser.images_without_alt:
        errors.append("Images missing alt attributes: " + ", ".join(parser.images_without_alt))

    for index, svg in enumerate(parser.svgs, start=1):
        labelled = bool(svg["aria_label"] or svg["aria_labelledby"])
        if svg["role"] != "img" or not labelled or not svg["has_title"]:
            errors.append(f"SVG {index} must have role=img, an accessible label, and a <title>.")
        if not svg["has_desc"]:
            warnings.append(f"SVG {index} has no <desc>; add one for non-trivial visuals.")

    allowed_visuals = {"graph", "diagram", "illustration", "image"}
    for index, visual in enumerate(parser.visuals, start=1):
        kind = visual.get("data-visual-kind", "")
        if kind not in allowed_visuals:
            errors.append(f"Visual {index} has unsupported data-visual-kind={kind!r}.")
        if not visual.get("data-purpose", "").strip():
            errors.append(f"Visual {index} needs a non-empty data-purpose.")
        if kind == "graph" and not visual.get("data-source", "").strip():
            errors.append(f"Graph visual {index} needs data-source provenance.")
    if not parser.visuals:
        warnings.append("No marked graph/diagram/media found; confirm that a text/table-only report is intentional.")

    allowed_actions = {
        "print",
        "copy-link",
        "focus-mode",
        "expand",
        "collapse",
        "previous-match",
        "next-match",
        "clear-search",
    }
    for index, control in enumerate(parser.interactive_controls, start=1):
        action = (
            control.get("data-report-action")
            or control.get("data-details-action")
            or control.get("data-search-action", "")
        )
        if control.get("tag") != "button":
            errors.append(f"Interactive control {index} must use a native button element.")
        if action not in allowed_actions:
            errors.append(f"Interactive control {index} has unsupported action={action!r}.")
    if parser.interactive_controls:
        if "data-enhanced-control" not in text or "interactions-ready" not in js:
            errors.append("Static interaction controls must be hidden until progressive enhancement is ready.")

    has_copy_actions = parser.copyable_blocks > 0 or any(
        control.get("data-report-action") == "copy-link" for control in parser.interactive_controls
    )
    if has_copy_actions:
        if parser.live_regions < 1:
            errors.append("Copy interactions need a polite or assertive aria-live status region.")
        if "navigator.clipboard" not in js or "execCommand" not in js:
            errors.append("Copy interactions need Clipboard API handling and a local fallback.")

    has_tabs = bool(parser.tabs or parser.tabpanels or parser.tablists)
    if has_tabs:
        if parser.tablists != 1:
            errors.append(f"Expected one tablist when tabs are used; found {parser.tablists}.")
        if len(parser.tabs) < 2 or len(parser.tabs) != len(parser.tabpanels):
            errors.append("Tabs require at least two tabs and a one-to-one tab/panel mapping.")
        panel_ids = {panel.get("id", "") for panel in parser.tabpanels}
        tab_ids = {tab.get("id", "") for tab in parser.tabs}
        selected = 0
        for tab in parser.tabs:
            if tab.get("aria-selected") == "true":
                selected += 1
            control = tab.get("aria-controls", "")
            if not tab.get("id") or not control or control not in panel_ids:
                errors.append(f"Tab {tab.get('id') or '<missing-id>'} has invalid aria-controls={control!r}.")
        for panel in parser.tabpanels:
            label = panel.get("aria-labelledby", "")
            if not panel.get("id") or not label or label not in tab_ids:
                errors.append(f"Tab panel {panel.get('id') or '<missing-id>'} has invalid aria-labelledby={label!r}.")
        if selected != 1:
            errors.append(f"Exactly one tab must initially have aria-selected=true; found {selected}.")
        for key in ["ArrowRight", "ArrowLeft", "Home", "End"]:
            if key not in js:
                errors.append(f"Tab keyboard handler is missing {key} support.")
        if "location.hash" not in js and "replaceState" not in js:
            warnings.append("Tabs do not appear to support URL hashes.")
        if not re.search(r"tabpanel[^}]*display\s*:\s*block\s*!important", css, re.IGNORECASE | re.DOTALL):
            errors.append("Print CSS must reveal all tab panels.")
    elif word_count >= 2500 or parser.major_sections >= 6:
        errors.append(
            f"Long report detected ({word_count} words, {parser.major_sections} major sections) without accessible tabs."
        )

    result = {
        "path": str(path),
        "status": "PASS" if not errors else "FAIL",
        "strict": strict,
        "metrics": {
            "words": word_count,
            "major_sections": parser.major_sections,
            "overview_tables": parser.overview_tables,
            "tabs": len(parser.tabs),
            "tabpanels": len(parser.tabpanels),
            "visuals": len(parser.visuals),
            "svgs": len(parser.svgs),
            "interactive_controls": len(parser.interactive_controls),
            "copyable_blocks": parser.copyable_blocks,
            "live_regions": parser.live_regions,
            "local_dependencies": len(parser.local_dependencies),
            "remote_dependencies": len(parser.remote_dependencies),
        },
        "errors": errors,
        "warnings": warnings,
    }
    return result


def main(argv: list[str] | None = None) -> int:
    argp = argparse.ArgumentParser(description=__doc__)
    argp.add_argument("report", type=Path, help="HTML report to validate")
    argp.add_argument("--strict", action="store_true", help="Fail on placeholders and external runtime dependencies")
    args = argp.parse_args(argv)

    if not args.report.is_file():
        print(json.dumps({"status": "FAIL", "errors": [f"Report not found: {args.report}"]}, indent=2))
        return 2
    try:
        result = audit_report(args.report.resolve(), strict=args.strict)
    except (OSError, UnicodeError) as exc:
        print(json.dumps({"status": "FAIL", "errors": [str(exc)]}, indent=2))
        return 2
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
