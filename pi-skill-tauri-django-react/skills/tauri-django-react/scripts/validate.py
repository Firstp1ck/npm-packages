#!/usr/bin/env python3
"""
Validate a Tauri + Django + React project setup.

Checks cross-layer configuration consistency: CSP, CORS/CSRF, auth,
port ranges, Tauri imports, health endpoints, session management,
bundle resources, environment variables, and the mandatory start.sh runner.

Usage:
    python3 validate.py --project-root /path/to/project
    python3 validate.py --project-root /path/to/project --format json
    python3 validate.py --project-root /path/to/project --fix-suggestions
"""
import argparse
import json
import re
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

class Result:
    PASS = "PASS"
    FAIL = "FAIL"
    WARN = "WARN"
    SKIP = "SKIP"

    def __init__(self, status: str, message: str, fix: str = "", layer: str = ""):
        self.status = status
        self.message = message
        self.fix = fix
        self.layer = layer

    def to_dict(self) -> dict:
        d = {"status": self.status, "message": self.message, "layer": self.layer}
        if self.fix:
            d["fix"] = self.fix
        return d


# ---------------------------------------------------------------------------
# File finders
# ---------------------------------------------------------------------------

def find_file(root: Path, candidates: list[str]) -> Path | None:
    for c in candidates:
        p = root / c
        if p.exists():
            return p
    return None


def read_text(path: Path | None) -> str:
    if path is None or not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def find_files_by_glob(root: Path, pattern: str) -> list[Path]:
    return list(root.glob(pattern))


# ---------------------------------------------------------------------------
# Tauri layer checks
# ---------------------------------------------------------------------------

def check_tauri_conf(root: Path) -> list[Result]:
    results = []
    layer = "tauri"

    conf_path = find_file(root, [
        "frontend/src-tauri/tauri.conf.json",
        "src-tauri/tauri.conf.json",
    ])

    if conf_path is None:
        results.append(Result(
            Result.FAIL, "tauri.conf.json not found",
            fix="Create frontend/src-tauri/tauri.conf.json (run scaffold.py)",
            layer=layer,
        ))
        return results

    try:
        conf = json.loads(conf_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        results.append(Result(
            Result.FAIL, f"tauri.conf.json parse error: {e}",
            layer=layer,
        ))
        return results

    # CSP checks
    csp = ""
    try:
        csp = conf.get("app", {}).get("security", {}).get("csp", "")
    except AttributeError:
        pass

    if not csp:
        results.append(Result(
            Result.FAIL, "No CSP defined in tauri.conf.json",
            fix="Add app.security.csp with connect-src allowing backend origins",
            layer=layer,
        ))
    else:
        if "ipc:" not in csp:
            results.append(Result(
                Result.FAIL, "CSP connect-src missing 'ipc:' (Tauri IPC)",
                fix="Add 'ipc:' to connect-src in CSP",
                layer=layer,
            ))
        else:
            results.append(Result(Result.PASS, "CSP includes ipc: origin", layer=layer))

        if "http://ipc.localhost" not in csp:
            results.append(Result(
                Result.FAIL, "CSP connect-src missing 'http://ipc.localhost'",
                fix="Add 'http://ipc.localhost' to connect-src in CSP",
                layer=layer,
            ))
        else:
            results.append(Result(Result.PASS, "CSP includes http://ipc.localhost", layer=layer))

        has_localhost = "http://localhost:" in csp or "http://localhost " in csp
        has_127 = "http://127.0.0.1:" in csp or "http://127.0.0.1 " in csp
        if has_localhost or has_127:
            results.append(Result(
                Result.PASS, "CSP connect-src includes backend localhost origins",
                layer=layer,
            ))
        else:
            results.append(Result(
                Result.FAIL,
                "CSP connect-src missing backend origins (http://localhost:PORT or http://127.0.0.1:PORT)",
                fix="Add 'http://localhost:8000 http://127.0.0.1:8000' to connect-src",
                layer=layer,
            ))

    # Bundle resources
    resources = []
    try:
        resources = conf.get("bundle", {}).get("resources", [])
    except AttributeError:
        pass

    resource_strs = [r if isinstance(r, str) else str(r) for r in resources]
    has_backend_resource = any("python-backend" in r for r in resource_strs)
    if has_backend_resource:
        results.append(Result(
            Result.PASS, "Bundle resources include python-backend", layer=layer,
        ))
    else:
        results.append(Result(
            Result.FAIL, "Bundle resources missing python-backend directory",
            fix='Add "resources/python-backend/**/*" to bundle.resources',
            layer=layer,
        ))

    # devUrl
    dev_url = ""
    try:
        dev_url = conf.get("build", {}).get("devUrl", "")
    except AttributeError:
        pass

    if dev_url:
        results.append(Result(
            Result.PASS, f"devUrl configured: {dev_url}", layer=layer,
        ))
    else:
        results.append(Result(
            Result.WARN, "No devUrl in tauri.conf.json build section",
            fix="Set build.devUrl to match your Vite dev server (e.g. http://localhost:5173)",
            layer=layer,
        ))

    # frontendDist
    frontend_dist = ""
    try:
        frontend_dist = conf.get("build", {}).get("frontendDist", "")
    except AttributeError:
        pass

    if frontend_dist:
        results.append(Result(
            Result.PASS, f"frontendDist configured: {frontend_dist}", layer=layer,
        ))
    else:
        results.append(Result(
            Result.WARN, "No frontendDist in tauri.conf.json",
            fix='Set build.frontendDist to your Vite output (typically "../dist")',
            layer=layer,
        ))

    return results


def check_cargo_toml(root: Path) -> list[Result]:
    results = []
    layer = "tauri"

    cargo_path = find_file(root, [
        "frontend/src-tauri/Cargo.toml",
        "src-tauri/Cargo.toml",
    ])

    if cargo_path is None:
        results.append(Result(
            Result.SKIP, "Cargo.toml not found (Tauri layer may not be initialized)",
            layer=layer,
        ))
        return results

    content = read_text(cargo_path)

    required_deps = ["tauri", "reqwest", "serde", "serde_json"]
    for dep in required_deps:
        pattern = rf'(?m)^{re.escape(dep)}\s*='
        if re.search(pattern, content):
            results.append(Result(Result.PASS, f"Cargo.toml has {dep} dependency", layer=layer))
        else:
            results.append(Result(
                Result.FAIL, f"Cargo.toml missing {dep} dependency",
                fix=f"Add {dep} to [dependencies] in Cargo.toml",
                layer=layer,
            ))

    if "blocking" in content:
        results.append(Result(
            Result.PASS, "reqwest has blocking feature (needed for health checks)",
            layer=layer,
        ))
    else:
        results.append(Result(
            Result.WARN, "reqwest may be missing 'blocking' feature",
            fix='Ensure reqwest has features = ["blocking", "json"]',
            layer=layer,
        ))

    if "tauri-build" in content:
        results.append(Result(
            Result.PASS, "tauri-build present in build-dependencies", layer=layer,
        ))
    else:
        results.append(Result(
            Result.FAIL, "tauri-build missing from build-dependencies",
            fix="Add tauri-build to [build-dependencies]",
            layer=layer,
        ))

    return results


def check_build_rs(root: Path) -> list[Result]:
    results = []
    layer = "tauri"

    build_rs = find_file(root, [
        "frontend/src-tauri/build.rs",
        "src-tauri/build.rs",
    ])

    if build_rs is None:
        results.append(Result(
            Result.WARN, "build.rs not found",
            fix="Create frontend/src-tauri/build.rs with tauri_build::build() call",
            layer=layer,
        ))
        return results

    content = read_text(build_rs)

    if "tauri_build::build()" in content:
        results.append(Result(Result.PASS, "build.rs calls tauri_build::build()", layer=layer))
    else:
        results.append(Result(
            Result.FAIL, "build.rs does not call tauri_build::build()",
            fix="Add tauri_build::build(); to the main() function",
            layer=layer,
        ))

    return results


def check_lib_rs(root: Path) -> list[Result]:
    results = []
    layer = "tauri"

    lib_rs = find_file(root, [
        "frontend/src-tauri/src/lib.rs",
        "frontend/src-tauri/src/main.rs",
        "src-tauri/src/lib.rs",
        "src-tauri/src/main.rs",
    ])

    if lib_rs is None:
        results.append(Result(
            Result.FAIL, "No lib.rs or main.rs found in src-tauri/src/",
            fix="Create the Tauri entry point (run scaffold.py)",
            layer=layer,
        ))
        return results

    content = read_text(lib_rs)

    if "find_available_port" in content or "TcpListener::bind" in content:
        results.append(Result(
            Result.PASS, "Port selection logic present in Rust code", layer=layer,
        ))
    else:
        results.append(Result(
            Result.WARN, "No port selection logic found in Rust entry point",
            fix="Implement find_available_port() using TcpListener::bind probing",
            layer=layer,
        ))

    if "backend-ready" in content:
        results.append(Result(
            Result.PASS, 'Rust code emits "backend-ready" event', layer=layer,
        ))
    else:
        results.append(Result(
            Result.FAIL, 'No "backend-ready" event emission found',
            fix='Emit "backend-ready" with port payload after health check passes',
            layer=layer,
        ))

    if "/api/health" in content:
        results.append(Result(
            Result.PASS, "Rust code polls /api/health/ endpoint", layer=layer,
        ))
    else:
        results.append(Result(
            Result.WARN, "No health endpoint polling found in Rust code",
            fix="Add health polling loop before emitting backend-ready",
            layer=layer,
        ))

    if "kill" in content.lower() or "taskkill" in content.lower():
        results.append(Result(
            Result.PASS, "Process cleanup logic present", layer=layer,
        ))
    else:
        results.append(Result(
            Result.WARN, "No process cleanup logic found",
            fix="Add kill_backend_process() with taskkill /T on Windows",
            layer=layer,
        ))

    return results


# ---------------------------------------------------------------------------
# Django layer checks
# ---------------------------------------------------------------------------

def check_django_auth(root: Path) -> list[Result]:
    results = []
    layer = "django"

    auth_path = find_file(root, [
        "backend/api/authentication.py",
        "api/authentication.py",
        "backend/authentication.py",
    ])

    if auth_path is None:
        results.append(Result(
            Result.FAIL, "authentication.py not found",
            fix="Create backend/api/authentication.py with HybridSessionAuthentication",
            layer=layer,
        ))
        return results

    content = read_text(auth_path)

    if "HybridSessionAuthentication" in content:
        results.append(Result(
            Result.PASS, "HybridSessionAuthentication class defined", layer=layer,
        ))
    else:
        results.append(Result(
            Result.FAIL, "HybridSessionAuthentication not found in authentication.py",
            fix="Add HybridSessionAuthentication that checks Session header before cookies",
            layer=layer,
        ))

    if "SessionTokenAuthentication" in content:
        results.append(Result(
            Result.PASS, "SessionTokenAuthentication class defined", layer=layer,
        ))
    else:
        results.append(Result(
            Result.WARN, "SessionTokenAuthentication helper class not found",
            fix="Add SessionTokenAuthentication for Authorization: Session header parsing",
            layer=layer,
        ))

    return results


def check_django_settings(root: Path) -> list[Result]:
    results = []
    layer = "django"

    settings_candidates = [
        "backend/config/settings/base.py",
        "backend/config/settings.py",
        "backend/settings/base.py",
        "backend/settings.py",
        "config/settings/base.py",
        "config/settings.py",
        "settings.py",
    ]
    settings_path = find_file(root, settings_candidates)

    if settings_path is None:
        results.append(Result(
            Result.SKIP, "Django settings file not found (checked common locations)",
            layer=layer,
        ))
        return results

    content = read_text(settings_path)

    # CORS
    if "CORS_ALLOWED_ORIGIN" in content:
        results.append(Result(Result.PASS, "CORS origin configuration present", layer=layer))
    else:
        results.append(Result(
            Result.FAIL, "No CORS origin configuration found in settings",
            fix="Add CORS_ALLOWED_ORIGIN_REGEXES with tauri://localhost and localhost patterns",
            layer=layer,
        ))

    tauri_origin_patterns = ["tauri://localhost", "tauri.localhost", r"tauri\.localhost"]
    has_tauri_cors = any(p in content for p in tauri_origin_patterns)
    if has_tauri_cors:
        results.append(Result(
            Result.PASS, "CORS includes Tauri origins (tauri://localhost)", layer=layer,
        ))
    else:
        results.append(Result(
            Result.FAIL, "CORS missing Tauri origins",
            fix='Add r"^tauri://localhost$" and r"^https?://tauri\\.localhost$" to CORS_ALLOWED_ORIGIN_REGEXES',
            layer=layer,
        ))

    if "CORS_ALLOW_CREDENTIALS" in content:
        if re.search(r"CORS_ALLOW_CREDENTIALS\s*=\s*True", content):
            results.append(Result(
                Result.PASS, "CORS_ALLOW_CREDENTIALS = True", layer=layer,
            ))
        else:
            results.append(Result(
                Result.FAIL, "CORS_ALLOW_CREDENTIALS is not True",
                fix="Set CORS_ALLOW_CREDENTIALS = True for session cookie support",
                layer=layer,
            ))
    else:
        results.append(Result(
            Result.FAIL, "CORS_ALLOW_CREDENTIALS not set",
            fix="Add CORS_ALLOW_CREDENTIALS = True",
            layer=layer,
        ))

    # CSRF
    if "CSRF_TRUSTED_ORIGINS" in content:
        results.append(Result(
            Result.PASS, "CSRF_TRUSTED_ORIGINS configured", layer=layer,
        ))
    else:
        results.append(Result(
            Result.FAIL, "CSRF_TRUSTED_ORIGINS not configured",
            fix="Add CSRF_TRUSTED_ORIGINS with Tauri origins and localhost port range",
            layer=layer,
        ))

    has_tauri_csrf = any(p in content for p in ["tauri://localhost", "tauri.localhost"])
    if "CSRF_TRUSTED_ORIGINS" in content and has_tauri_csrf:
        results.append(Result(
            Result.PASS, "CSRF_TRUSTED_ORIGINS includes Tauri origins", layer=layer,
        ))
    elif "CSRF_TRUSTED_ORIGINS" in content:
        results.append(Result(
            Result.WARN, "CSRF_TRUSTED_ORIGINS may be missing Tauri origins",
            fix='Add "tauri://localhost" and "https://tauri.localhost" to CSRF_TRUSTED_ORIGINS',
            layer=layer,
        ))

    # Auth classes
    if "HybridSessionAuthentication" in content:
        results.append(Result(
            Result.PASS, "HybridSessionAuthentication in DRF settings", layer=layer,
        ))
    else:
        results.append(Result(
            Result.FAIL, "HybridSessionAuthentication not referenced in settings",
            fix="Add to REST_FRAMEWORK DEFAULT_AUTHENTICATION_CLASSES",
            layer=layer,
        ))

    # Session
    match = re.search(r"SESSION_EXPIRE_AT_BROWSER_CLOSE\s*=\s*(\w+)", content)
    if match:
        if match.group(1) == "False":
            results.append(Result(
                Result.PASS, "SESSION_EXPIRE_AT_BROWSER_CLOSE = False", layer=layer,
            ))
        else:
            results.append(Result(
                Result.FAIL, "SESSION_EXPIRE_AT_BROWSER_CLOSE should be False for Tauri",
                fix="Set SESSION_EXPIRE_AT_BROWSER_CLOSE = False so desktop users stay logged in",
                layer=layer,
            ))
    else:
        results.append(Result(
            Result.WARN, "SESSION_EXPIRE_AT_BROWSER_CLOSE not explicitly set",
            fix="Add SESSION_EXPIRE_AT_BROWSER_CLOSE = False",
            layer=layer,
        ))

    return results


def check_health_endpoint(root: Path) -> list[Result]:
    results = []
    layer = "django"

    health_candidates = [
        "backend/api/views/health.py",
        "backend/api/health.py",
        "api/views/health.py",
        "api/health.py",
    ]
    health_path = find_file(root, health_candidates)

    if health_path is None:
        results.append(Result(
            Result.FAIL, "Health endpoint file not found",
            fix="Create backend/api/views/health.py with an AllowAny health_check view",
            layer=layer,
        ))
        return results

    content = read_text(health_path)

    if "health_check" in content or "health" in content.lower():
        results.append(Result(Result.PASS, "Health check view defined", layer=layer))
    else:
        results.append(Result(
            Result.WARN, "No health_check function found in health file",
            layer=layer,
        ))

    if "AllowAny" in content:
        results.append(Result(
            Result.PASS, "Health endpoint uses AllowAny permission", layer=layer,
        ))
    else:
        results.append(Result(
            Result.FAIL, "Health endpoint not marked AllowAny",
            fix="Add @permission_classes([AllowAny]) -- Tauri polls before login",
            layer=layer,
        ))

    return results


def check_tauri_entry(root: Path) -> list[Result]:
    results = []
    layer = "django"

    entry_path = find_file(root, [
        "backend/tauri_entry.py",
        "tauri_entry.py",
    ])

    if entry_path is None:
        results.append(Result(
            Result.FAIL, "tauri_entry.py not found",
            fix="Create backend/tauri_entry.py as the PyInstaller entry point",
            layer=layer,
        ))
        return results

    content = read_text(entry_path)

    if "--noreload" in content:
        results.append(Result(
            Result.PASS, "tauri_entry.py uses --noreload (required for PyInstaller)",
            layer=layer,
        ))
    else:
        results.append(Result(
            Result.FAIL, "tauri_entry.py missing --noreload flag",
            fix="Add --noreload to the runserver command (Django reloader breaks in PyInstaller)",
            layer=layer,
        ))

    if "BACKEND_PORT" in content:
        results.append(Result(
            Result.PASS, "tauri_entry.py reads BACKEND_PORT env var", layer=layer,
        ))
    else:
        results.append(Result(
            Result.FAIL, "tauri_entry.py doesn't read BACKEND_PORT",
            fix="Read port from os.environ.get('BACKEND_PORT', '8000')",
            layer=layer,
        ))

    if "migrate" in content:
        results.append(Result(
            Result.PASS, "tauri_entry.py runs migrations on startup", layer=layer,
        ))
    else:
        results.append(Result(
            Result.WARN, "tauri_entry.py doesn't appear to run migrations",
            fix="Add execute_from_command_line(['manage.py', 'migrate', '--noinput'])",
            layer=layer,
        ))

    return results


# ---------------------------------------------------------------------------
# React / TypeScript checks
# ---------------------------------------------------------------------------

def check_tauri_ts(root: Path) -> list[Result]:
    results = []
    layer = "react"

    tauri_ts = find_file(root, [
        "frontend/src/utils/tauri.ts",
        "frontend/src/utils/tauri.tsx",
        "src/utils/tauri.ts",
        "src/utils/tauri.tsx",
    ])

    if tauri_ts is None:
        results.append(Result(
            Result.FAIL, "Tauri utility file (utils/tauri.ts) not found",
            fix="Create frontend/src/utils/tauri.ts with isTauriApp() and port management",
            layer=layer,
        ))
        return results

    content = read_text(tauri_ts)

    if "isTauriApp" in content:
        results.append(Result(Result.PASS, "isTauriApp() utility defined", layer=layer))
    else:
        results.append(Result(
            Result.FAIL, "isTauriApp() not found in tauri.ts",
            fix="Add isTauriApp() checking __TAURI_INTERNALS__ or __TAURI__",
            layer=layer,
        ))

    if "__TAURI_INTERNALS__" in content or "__TAURI__" in content:
        results.append(Result(
            Result.PASS, "Tauri detection checks window globals", layer=layer,
        ))
    else:
        results.append(Result(
            Result.WARN, "Tauri detection may not check the correct window globals",
            fix='Check "__TAURI_INTERNALS__" in window (Tauri v2) or "__TAURI__" (v1)',
            layer=layer,
        ))

    if "setTauriBackendPort" in content and "getTauriBackendPort" in content:
        results.append(Result(
            Result.PASS, "Port getter/setter functions defined", layer=layer,
        ))
    else:
        results.append(Result(
            Result.FAIL, "Missing setTauriBackendPort/getTauriBackendPort",
            fix="Add port management functions for dynamic backend port",
            layer=layer,
        ))

    return results


def check_static_tauri_imports(root: Path) -> list[Result]:
    results = []
    layer = "react"

    src_dirs = [root / "frontend" / "src", root / "src"]
    ts_files: list[Path] = []
    for src_dir in src_dirs:
        if src_dir.is_dir():
            ts_files.extend(find_files_by_glob(src_dir, "**/*.ts"))
            ts_files.extend(find_files_by_glob(src_dir, "**/*.tsx"))

    if not ts_files:
        results.append(Result(
            Result.SKIP, "No TypeScript files found to check", layer=layer,
        ))
        return results

    static_import_pattern = re.compile(
        r'^\s*import\s+.*from\s+["\']@tauri-apps/', re.MULTILINE
    )

    bad_files = []
    for f in ts_files:
        content = read_text(f)
        matches = static_import_pattern.findall(content)
        if matches:
            rel = f.relative_to(root) if f.is_relative_to(root) else f
            bad_files.append(str(rel))

    if bad_files:
        file_list = ", ".join(bad_files[:5])
        suffix = f" (+{len(bad_files) - 5} more)" if len(bad_files) > 5 else ""
        results.append(Result(
            Result.FAIL,
            f"Static @tauri-apps imports found in: {file_list}{suffix}",
            fix="Use dynamic imports: await import('@tauri-apps/...') behind isTauriApp() guard",
            layer=layer,
        ))
    else:
        results.append(Result(
            Result.PASS, "No static @tauri-apps imports found (all dynamic)", layer=layer,
        ))

    return results


def check_session_token(root: Path) -> list[Result]:
    results = []
    layer = "react"

    api_candidates = [
        "frontend/src/services/api-tauri.ts",
        "frontend/src/services/api.ts",
        "src/services/api-tauri.ts",
        "src/services/api.ts",
    ]

    found = False
    for candidate in api_candidates:
        p = root / candidate
        if p.exists():
            content = read_text(p)
            found = True

            if "session_token" in content.lower() or "SESSION_TOKEN" in content:
                results.append(Result(
                    Result.PASS, f"Session token management in {candidate}", layer=layer,
                ))
            else:
                results.append(Result(
                    Result.WARN, f"No session token management found in {candidate}",
                    fix="Add getSessionToken/setSessionToken/clearSessionToken using localStorage",
                    layer=layer,
                ))

            if "Authorization" in content and "Session" in content:
                results.append(Result(
                    Result.PASS, "Axios interceptor sends Authorization: Session header",
                    layer=layer,
                ))
            else:
                results.append(Result(
                    Result.WARN, "Authorization: Session header not found in API client",
                    fix="Add axios request interceptor that sets Authorization: Session <token>",
                    layer=layer,
                ))
            break

    if not found:
        results.append(Result(
            Result.FAIL, "API service file not found (api-tauri.ts or api.ts)",
            fix="Create frontend/src/services/api-tauri.ts with session token and dynamic URL",
            layer=layer,
        ))

    return results


def check_loading_screen(root: Path) -> list[Result]:
    results = []
    layer = "react"

    ls_candidates = [
        "frontend/src/components/LoadingScreen.tsx",
        "frontend/src/components/LoadingScreen.jsx",
        "src/components/LoadingScreen.tsx",
        "src/components/LoadingScreen.jsx",
    ]
    ls_path = find_file(root, ls_candidates)

    if ls_path is None:
        results.append(Result(
            Result.FAIL, "LoadingScreen component not found",
            fix="Create frontend/src/components/LoadingScreen.tsx (run scaffold.py)",
            layer=layer,
        ))
        return results

    content = read_text(ls_path)

    if "backend-ready" in content:
        results.append(Result(
            Result.PASS, "LoadingScreen listens for backend-ready event", layer=layer,
        ))
    else:
        results.append(Result(
            Result.FAIL, 'LoadingScreen missing "backend-ready" event listener',
            fix='Listen for "backend-ready" Tauri event to receive the backend port',
            layer=layer,
        ))

    if "health" in content.lower() or "/api/health" in content:
        results.append(Result(
            Result.PASS, "LoadingScreen has health polling fallback", layer=layer,
        ))
    else:
        results.append(Result(
            Result.WARN, "LoadingScreen may lack a health polling fallback",
            fix="Add polling to /api/health/ as a fallback if the Tauri event is missed",
            layer=layer,
        ))

    return results


# ---------------------------------------------------------------------------
# Cross-layer consistency checks
# ---------------------------------------------------------------------------

def check_port_consistency(root: Path) -> list[Result]:
    results = []
    layer = "cross-layer"

    # Extract port range from lib.rs
    lib_rs = find_file(root, [
        "frontend/src-tauri/src/lib.rs",
        "src-tauri/src/lib.rs",
    ])
    rust_port_start = None
    rust_port_end = None

    if lib_rs:
        content = read_text(lib_rs)
        m_start = re.search(r"DEFAULT_BACKEND_PORT.*?(\d{4,5})", content)
        m_offset = re.search(r"MAX_PORT_OFFSET.*?(\d+)", content)
        if m_start:
            rust_port_start = int(m_start.group(1))
        if m_offset and rust_port_start:
            rust_port_end = rust_port_start + int(m_offset.group(1))

    # Check Django CSRF includes the port range
    settings_path = find_file(root, [
        "backend/config/settings/base.py",
        "backend/config/settings.py",
        "backend/settings/base.py",
        "backend/settings.py",
    ])

    if rust_port_start and settings_path:
        settings_content = read_text(settings_path)
        port_str = str(rust_port_start)
        if port_str in settings_content:
            results.append(Result(
                Result.PASS,
                f"Django settings reference port {rust_port_start} (matches Rust default)",
                layer=layer,
            ))
        else:
            results.append(Result(
                Result.WARN,
                f"Django settings may not cover Rust port range ({rust_port_start}-{rust_port_end})",
                fix=f"Ensure CORS and CSRF settings cover ports {rust_port_start}-{rust_port_end}",
                layer=layer,
            ))
    elif not rust_port_start:
        results.append(Result(
            Result.SKIP, "Could not extract port range from Rust code", layer=layer,
        ))

    # Check tauri.conf.json devUrl vs Vite config
    conf_path = find_file(root, [
        "frontend/src-tauri/tauri.conf.json",
        "src-tauri/tauri.conf.json",
    ])
    vite_path = find_file(root, [
        "frontend/vite.config.ts",
        "frontend/vite.config.js",
        "vite.config.ts",
        "vite.config.js",
    ])

    if conf_path and vite_path:
        try:
            conf = json.loads(read_text(conf_path))
            dev_url = conf.get("build", {}).get("devUrl", "")
            dev_port_match = re.search(r":(\d+)", dev_url)

            vite_content = read_text(vite_path)
            vite_port_match = re.search(r"port\s*:\s*(\d+)", vite_content)

            if dev_port_match and vite_port_match:
                tauri_port = dev_port_match.group(1)
                vite_port = vite_port_match.group(1)
                if tauri_port == vite_port:
                    results.append(Result(
                        Result.PASS,
                        f"tauri.conf.json devUrl port ({tauri_port}) matches Vite config",
                        layer=layer,
                    ))
                else:
                    results.append(Result(
                        Result.FAIL,
                        f"Port mismatch: tauri.conf.json devUrl uses {tauri_port}, Vite uses {vite_port}",
                        fix=f"Align devUrl port with Vite server port",
                        layer=layer,
                    ))
        except (json.JSONDecodeError, AttributeError):
            pass

    return results


# ---------------------------------------------------------------------------
# Environment checks
# ---------------------------------------------------------------------------

def check_env_files(root: Path) -> list[Result]:
    results = []
    layer = "environment"

    env_files = [
        root / ".env",
        root / ".env.example",
        root / "frontend" / ".env",
        root / "frontend" / ".env.example",
    ]

    any_env = False
    has_signing_key = False
    has_updater_pat = False

    for env_file in env_files:
        if env_file.exists():
            any_env = True
            content = read_text(env_file)
            if "TAURI_SIGNING_PRIVATE_KEY" in content:
                has_signing_key = True
            if "GITHUB_PAT_UPDATER" in content:
                has_updater_pat = True

    if not any_env:
        results.append(Result(
            Result.WARN, "No .env or .env.example file found",
            fix="Create a .env.example documenting TAURI_SIGNING_PRIVATE_KEY and other vars",
            layer=layer,
        ))
        return results

    if has_signing_key:
        results.append(Result(
            Result.PASS, "TAURI_SIGNING_PRIVATE_KEY documented in env", layer=layer,
        ))
    else:
        results.append(Result(
            Result.WARN, "TAURI_SIGNING_PRIVATE_KEY not found in any env file",
            fix="Add TAURI_SIGNING_PRIVATE_KEY to .env.example (required for signed builds)",
            layer=layer,
        ))

    # Only warn about PAT if updater is configured
    conf_path = find_file(root, [
        "frontend/src-tauri/tauri.conf.json",
        "src-tauri/tauri.conf.json",
    ])
    has_updater = False
    if conf_path:
        try:
            conf = json.loads(read_text(conf_path))
            has_updater = bool(conf.get("plugins", {}).get("updater", {}))
        except (json.JSONDecodeError, AttributeError):
            pass

    if has_updater and not has_updater_pat:
        results.append(Result(
            Result.WARN, "Updater configured but GITHUB_PAT_UPDATER not in env",
            fix="Add GITHUB_PAT_UPDATER to .env (required for private repo updates)",
            layer=layer,
        ))
    elif has_updater and has_updater_pat:
        results.append(Result(
            Result.PASS, "GITHUB_PAT_UPDATER documented for updater", layer=layer,
        ))

    return results


# ---------------------------------------------------------------------------
# Local runner checks
# ---------------------------------------------------------------------------

def check_start_script(root: Path) -> list[Result]:
    results = []
    layer = "development"

    script = root / "start.sh"
    if not script.exists():
        results.append(Result(
            Result.FAIL,
            "Mandatory root start.sh not found",
            fix="Create executable ./start.sh that starts Django and React together with uv and bun",
            layer=layer,
        ))
        return results

    content = read_text(script)

    if script.stat().st_mode & 0o111:
        results.append(Result(Result.PASS, "start.sh is executable", layer=layer))
    else:
        results.append(Result(
            Result.FAIL,
            "start.sh is not executable",
            fix="Run chmod +x start.sh",
            layer=layer,
        ))

    required_patterns = [
        ("uv", "start.sh uses uv for backend commands", "Use uv sync and uv run python manage.py ..."),
        ("bun", "start.sh uses bun for frontend commands", "Use bun install and bun run dev"),
        ("manage.py migrate", "start.sh runs Django migrations", "Run uv run python manage.py migrate before starting the backend"),
        ("manage.py runserver", "start.sh starts the Django backend", "Start Django with uv run python manage.py runserver"),
        ("bun run dev", "start.sh starts the React/Vite frontend", "Start React with bun run dev"),
        ("VITE_API_BASE_URL", "start.sh exports/provides VITE_API_BASE_URL", "Set VITE_API_BASE_URL to the Django /api base URL unless already set"),
        ("trap cleanup EXIT INT TERM", "start.sh traps EXIT/INT/TERM for cleanup", "Trap EXIT, INT, and TERM and kill child processes"),
        ("kill", "start.sh stops child processes", "Track backend/frontend PIDs and kill them in cleanup()"),
    ]

    for needle, ok_message, fix in required_patterns:
        if needle in content:
            results.append(Result(Result.PASS, ok_message, layer=layer))
        else:
            results.append(Result(Result.FAIL, ok_message.replace("uses", "missing").replace("runs", "missing").replace("starts", "missing"), fix=fix, layer=layer))

    if "seed_demo" in content or "manage.py help" in content:
        results.append(Result(
            Result.PASS,
            "start.sh handles optional demo/seed command discovery",
            layer=layer,
        ))
    else:
        results.append(Result(
            Result.WARN,
            "start.sh does not handle optional demo/seed commands",
            fix="If the project has demo data, run a clearly named seed command conditionally (for example manage.py help seed_demo)",
            layer=layer,
        ))

    return results


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

ALL_CHECKS = [
    ("Tauri Configuration", check_tauri_conf),
    ("Cargo Dependencies", check_cargo_toml),
    ("Build Script", check_build_rs),
    ("Rust Entry Point", check_lib_rs),
    ("Django Authentication", check_django_auth),
    ("Django Settings", check_django_settings),
    ("Health Endpoint", check_health_endpoint),
    ("Tauri Entry Point", check_tauri_entry),
    ("Tauri Utilities (TS)", check_tauri_ts),
    ("Static Import Check", check_static_tauri_imports),
    ("Session Token Management", check_session_token),
    ("Loading Screen", check_loading_screen),
    ("Port Consistency", check_port_consistency),
    ("Environment Files", check_env_files),
    ("Start Script", check_start_script),
]

COLORS = {
    Result.PASS: "\033[32m",  # green
    Result.FAIL: "\033[31m",  # red
    Result.WARN: "\033[33m",  # yellow
    Result.SKIP: "\033[36m",  # cyan
}
RESET = "\033[0m"


def format_text(all_results: list[tuple[str, list[Result]]], fix_suggestions: bool) -> str:
    lines = []
    for section, results in all_results:
        lines.append(f"\n{'='*60}")
        lines.append(f"  {section}")
        lines.append(f"{'='*60}")
        for r in results:
            color = COLORS.get(r.status, "")
            lines.append(f"  {color}[{r.status:4s}]{RESET} {r.message}")
            if fix_suggestions and r.fix:
                lines.append(f"         Fix: {r.fix}")
    return "\n".join(lines)


def format_json(all_results: list[tuple[str, list[Result]]]) -> str:
    output = {}
    for section, results in all_results:
        output[section] = [r.to_dict() for r in results]
    return json.dumps(output, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate Tauri + Django + React project setup"
    )
    parser.add_argument(
        "--project-root", required=True, type=Path,
        help="Path to the project root directory",
    )
    parser.add_argument(
        "--format", choices=["text", "json"], default="text",
        help="Output format (default: text)",
    )
    parser.add_argument(
        "--fix-suggestions", action="store_true",
        help="Include fix suggestions for failures and warnings",
    )
    args = parser.parse_args()

    project_root = args.project_root.resolve()
    if not project_root.is_dir():
        print(f"Error: project root does not exist: {project_root}", file=sys.stderr)
        return 2

    all_results: list[tuple[str, list[Result]]] = []
    for section_name, check_fn in ALL_CHECKS:
        results = check_fn(project_root)
        all_results.append((section_name, results))

    if args.format == "json":
        print(format_json(all_results))
    else:
        print(format_text(all_results, args.fix_suggestions))

        # Summary
        total = sum(len(r) for _, r in all_results)
        passed = sum(1 for _, rs in all_results for r in rs if r.status == Result.PASS)
        failed = sum(1 for _, rs in all_results for r in rs if r.status == Result.FAIL)
        warned = sum(1 for _, rs in all_results for r in rs if r.status == Result.WARN)
        skipped = sum(1 for _, rs in all_results for r in rs if r.status == Result.SKIP)

        print(f"\n{'='*60}")
        print(f"  Summary: {passed} passed, {failed} failed, {warned} warnings, {skipped} skipped ({total} total)")
        print(f"{'='*60}\n")

    has_failures = any(
        r.status == Result.FAIL for _, rs in all_results for r in rs
    )
    return 1 if has_failures else 0


if __name__ == "__main__":
    sys.exit(main())
