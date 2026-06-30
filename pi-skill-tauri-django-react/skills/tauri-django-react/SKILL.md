---
name: tauri-django-react
description: Agents should invoke this skill for Tauri + Django + React desktop apps, especially backend lifecycle, CORS/auth, frontend integration, mandatory light/dark theming, German/English i18n, build packaging, dual desktop/web deployment, Rust commands, and platform-specific gotchas.
---

# Tauri + Django + React Integration Patterns

Dense technical reference for building desktop applications that use Tauri as the native shell, Django as the backend API, and React as the frontend UI. Patterns are designed for reuse across projects.

This skill is self-contained; it must not depend on package-level `docs/` files at runtime.

---

## Quick Start

### Identify the Integration Concern

1. **Which layers are involved?** If the question spans two or more of Rust/Python/TypeScript, this skill applies.
2. **Is it a lifecycle issue?** Port selection, process spawning, health checking, cleanup -> Backend Lifecycle section.
3. **Is it an auth issue?** Cookies not working in Tauri, CORS errors, session tokens -> Cross-Origin Auth section.
4. **Is it a build issue?** PyInstaller fails, bundle missing files, `tauri build` errors -> Build Pipeline section.
5. **Is it a dual-mode issue?** Works in browser but not Tauri (or vice versa) -> Frontend Integration section.
6. **Mandatory local runner:** When creating or updating a project with this skill, add or maintain an executable `scripts/start.sh` that starts both Django and React for local development.
7. **Mandatory frontend UX baseline:** Ask the user for separate light-mode and dark-mode background images before finalizing visual work; implement a persistent light/dark mode setting; implement German/English i18n for every user-facing string.
8. **Mandatory GitHub release automation:** When creating or updating a project with this skill, add or maintain both `.github/workflows/release.yml` and an executable `scripts/release.sh` release helper.
9. **Mandatory configurable update path:** Add or maintain a filesystem update checker that reads a configurable update source directory before checking/installing desktop updates.

### Mandatory GitHub Release Automation

Every Tauri + Django + React project handled by this skill must include GitHub release automation:

- `.github/workflows/release.yml` builds the Tauri desktop app, uploads installer artifacts, and publishes a GitHub Release for `v*` tags or manual `workflow_dispatch` runs.
- `scripts/release.sh` updates project version files, regenerates relevant locks when tooling is available, commits/pushes version changes, creates an annotated `vX.X.X` tag, and pushes the tag to trigger the workflow.
- `dev/RELEASES/` is the canonical release-notes directory; release notes use `dev/RELEASES/RELEASE_vX.X.X.md` and the workflow falls back to the annotated tag message when the file is absent.
- The workflow and script must be adapted to the actual app name, artifact names, package names, secrets, signing/updater setup, and platform targets. Do not copy private updater/Gist/signing logic unless the current project explicitly has that configuration.

### Mandatory Configurable Filesystem Update System

Every desktop-distributed Tauri + Django + React project handled by this skill must include a configurable filesystem update path unless the user explicitly chooses Tauri's built-in updater only:

- **Canonical setting:** `settings.update_source_path` in the app config (`config.json`) stores the local/network directory to scan for installer updates.
- **Config overrides:** support `APP_UPDATE_SOURCE_PATH` or `TAURI_UPDATE_SOURCE_PATH` env vars for deployment overrides; support `APP_CONFIG_PATH` for a custom runtime config file; support `APP_UPDATE_INSTALLER_PATTERNS` for app-specific installer filename regexes.
- **Version source:** Rust passes `TAURI_APP_VERSION` and `APP_VERSION` from `app.package_info().version` into the Django backend. Django falls back to `APP_VERSION`, Django settings, or `pyproject.toml` in development.
- **Installer discovery:** Django scans the configured directory for versioned installer filenames, extracts semantic `X.Y.Z`, compares integer tuples, and returns the newest installer newer than the current version. Keep the current-version installer path too so the UI can offer reinstall.
- **Safety boundary:** only launch installers that exist, are regular files, match the configured filename pattern, and resolve inside the configured update source directory.
- **API contract:** expose `GET /api/updates/check/` for availability, authenticated `GET/PATCH /api/updates/settings/` for the configurable path, and authenticated `POST /api/updates/install/` for launching a validated installer. If `check` is public, redact local/network paths unless the request is authenticated.
- **Frontend contract:** provide an update service and menu/button whose label changes between `Check update` and `Install update`; check at startup and periodically; prompt before launching the installer; close the Tauri app after a successful installer launch.
- **Release artifact contract:** release workflows/scripts must produce installer names that match the checker (for example `<app-slug>-1.2.3-Setup.exe` or Tauri NSIS `<app-slug>_1.2.3_x64-setup.exe`).

### Mandatory `scripts/start.sh` Local Runner

Every Tauri + Django + React project handled by this skill must include `scripts/start.sh` unless the user explicitly declines it. The script is the one-command local development entry point and must:

- use `uv` for backend dependency sync and Django commands;
- use `bun` for frontend dependency install and Vite/React startup;
- run Django migrations before starting the backend;
- optionally run a clearly named seed/demo command when the project has one;
- start Django and React concurrently;
- set `VITE_API_BASE_URL` to the Django `/api` base URL unless already provided;
- print the frontend and backend URLs;
- trap `EXIT`, `INT`, and `TERM` and stop both child processes;
- be executable (`chmod +x scripts/start.sh`).

Recommended template:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_URL="http://localhost:5173"
BACKEND_URL="http://${BACKEND_HOST}:${BACKEND_PORT}"

backend_pid=""
frontend_pid=""

cleanup() {
  echo
  echo "Stopping application..."
  if [[ -n "$frontend_pid" ]] && kill -0 "$frontend_pid" 2>/dev/null; then
    kill "$frontend_pid" 2>/dev/null || true
  fi
  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" 2>/dev/null; then
    kill "$backend_pid" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

(
  cd "$BACKEND_DIR"
  uv sync --all-groups
  uv run python manage.py migrate
  if uv run python manage.py help seed_demo >/dev/null 2>&1; then
    uv run python manage.py seed_demo
  fi
)

(
  cd "$FRONTEND_DIR"
  bun install
)

(
  cd "$BACKEND_DIR"
  uv run python manage.py runserver "${BACKEND_HOST}:${BACKEND_PORT}"
) &
backend_pid=$!

(
  cd "$FRONTEND_DIR"
  VITE_API_BASE_URL="${VITE_API_BASE_URL:-${BACKEND_URL}/api}" bun run dev
) &
frontend_pid=$!

echo "Frontend: $FRONTEND_URL"
echo "Backend:  $BACKEND_URL/api"
echo "Press Ctrl+C to stop both processes."

wait -n "$backend_pid" "$frontend_pid"
```

---

## Backend Lifecycle (Tauri / Rust)

The core responsibility of the Rust layer: start the Django backend, confirm it's healthy, tell the frontend, and clean up on exit.

### Port Selection

```rust
const DEFAULT_BACKEND_PORT: u16 = 8000;
const MAX_PORT_OFFSET: u16 = 10;

fn find_available_port() -> Option<u16> {
    for offset in 0..=MAX_PORT_OFFSET {
        let port = DEFAULT_BACKEND_PORT + offset;
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
}
```

- Probes 8000-8010 using `TcpListener::bind()` -- bind succeeds means port is free
- The selected port is passed to Django via `BACKEND_PORT` env var and to React via a Tauri event
- Never hardcode the port in frontend code

### Subprocess Spawning

```rust
let mut cmd = Command::new(&backend_path);
cmd.current_dir(&backend_dir);
cmd.env("BACKEND_PORT", port.to_string());
cmd.env("DJANGO_DATABASE_PATH", db_path.to_string_lossy().to_string());
cmd.env("TAURI_APP_DATA_DIR", app_data.to_string_lossy().to_string());
cmd.env("TAURI_APP_VERSION", app.package_info().version.to_string());
cmd.env("APP_VERSION", app.package_info().version.to_string());

#[cfg(target_os = "windows")]
{
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
}

let child = cmd.spawn()?;
```

- Backend path resolved from `resource_dir/python-backend/tauri_entry` (+ `.exe` on Windows)
- `CREATE_NO_WINDOW` (0x08000000) prevents a visible console window on Windows
- Pass the Tauri package version to Django via `TAURI_APP_VERSION`/`APP_VERSION` so update checks compare against the installed app version
- Store the `Child` handle in `Mutex<Option<BackendState>>` for later cleanup
- On Windows, strip UNC `\\?\` prefix from paths before passing to Python

### Health Polling

```rust
let client = reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(2))
    .build()?;

for attempt in 0..max_retries {
    match client.get(&format!("http://127.0.0.1:{}/api/health/", port)).send() {
        Ok(resp) if resp.status().is_success() => {
            app_handle.emit("backend-ready", json!({ "port": port }))?;
            return Ok(());
        }
        _ => std::thread::sleep(Duration::from_millis(500)),
    }
}
app_handle.emit("backend-error", json!({ "error": "Backend failed to start" }))?;
```

- Poll `GET /api/health/` with a 2-second timeout per request
- Retry with 500ms sleep between attempts (typically 30-60 retries = 15-30 seconds max wait)
- On success: emit `backend-ready` with the port number
- On failure: emit `backend-error` with a description

### Process Cleanup

```rust
fn kill_backend_process(state: &Mutex<Option<BackendState>>) {
    if let Some(mut backend) = state.lock().unwrap().take() {
        #[cfg(target_os = "windows")]
        {
            // taskkill /F /T kills the entire process tree
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &backend.child.id().to_string()])
                .creation_flags(0x08000000)
                .output();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = backend.child.kill();
        }
    }
}
```

- **Windows:** Must use `taskkill /F /T /PID` to kill the entire process tree (PyInstaller spawns child processes)
- **Unix:** `child.kill()` sends SIGKILL, which is sufficient
- Call cleanup on: app exit, window close, `before_exit` event, and `on_window_event(CloseRequested)`

### Window Lifecycle

- **Windows:** Minimize to system tray on close (`api.prevent_close()` + `window.hide()`)
- **Linux/macOS:** Quit the application on window close (standard behavior)
- Tray icon re-shows the window on click

### Event Emission Summary

| Event | Payload | When |
|---|---|---|
| `backend-ready` | `{ "port": number }` | Health check passes |
| `backend-error` | `{ "error": string }` | Health check exhausts retries, or spawn fails |

---

## Cross-Origin Authentication (Django / Python)

WebView in Tauri runs from `tauri://localhost` (or `https://tauri.localhost`), which means cookies may not work reliably for `http://127.0.0.1:8000`. The solution: a hybrid auth system.

### HybridSessionAuthentication

```python
class HybridSessionAuthentication(authentication.SessionAuthentication):
    def authenticate(self, request):
        auth_header = authentication.get_authorization_header(request)
        if auth_header:
            auth_parts = auth_header.decode("utf-8").split()
            if auth_parts and auth_parts[0].lower() == "session":
                token_auth = SessionTokenAuthentication()
                return token_auth.authenticate(request)
        return super().authenticate(request)
```

- **Priority 1:** Check for `Authorization: Session <session_key>` header (Tauri path)
- **Priority 2:** Fall back to standard cookie-based session auth (browser path)
- Register in DRF settings: `DEFAULT_AUTHENTICATION_CLASSES = ["api.authentication.HybridSessionAuthentication"]`

### SessionTokenAuthentication

```python
class SessionTokenAuthentication:
    def authenticate(self, request):
        session_key = self._extract_key(request)
        session = SessionStore(session_key=session_key)
        if not session.exists(session_key):
            raise AuthenticationFailed("Invalid session")
        user_id = session.get("_auth_user_id")
        user = User.objects.get(pk=user_id)
        session["_session_expiry"] = settings.SESSION_COOKIE_AGE  # sliding expiration
        session.save()
        return (user, None)
```

- Looks up the session in Django's session store using the key from the header
- Implements sliding expiration by resetting `_session_expiry` on each authenticated request

### CORS Configuration

```python
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^tauri://localhost$",
    r"^https?://tauri\.localhost$",
    r"^https?://localhost(:\d+)?$",
    r"^https?://127\.0\.0\.1(:\d+)?$",
]
CORS_ALLOW_CREDENTIALS = True
```

### CSRF Configuration

```python
CSRF_TRUSTED_ORIGINS = [
    "tauri://localhost",
    "https://tauri.localhost",
    "http://localhost",
    "http://127.0.0.1",
] + [f"http://localhost:{p}" for p in range(8000, 8011)]
  + [f"http://127.0.0.1:{p}" for p in range(8000, 8011)]
CSRF_COOKIE_SAMESITE = "Lax"
```

- Include the full port range (8000-8010) to handle dynamic port selection
- `CORS_ALLOW_CREDENTIALS = True` is required for session cookies in web mode

### Health Endpoint

```python
@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(_request):
    return Response({"status": "ok"}, status=200)
```

- Must be unauthenticated (`AllowAny`) -- Tauri polls this before any user login
- URL: `GET /api/health/`
- Keep the response minimal for fast polling

---

## Frontend Integration (React / TypeScript)

### Mandatory Theme + Background + i18n Baseline

Every React frontend created or substantially updated with this skill must include these UI foundations unless the user explicitly declines them:

1. **Ask for backgrounds first:** Before finalizing visual styling, ask the user whether they have separate light-mode and dark-mode background images. If supplied, store them under `frontend/src/assets/` with stable names such as `background_light.png` and `background_dark.png`; if not supplied, use temporary CSS gradients and leave a clear TODO.
2. **Persistent light/dark setting:** Implement a `Theme = "light" | "dark"` state, initialize it from `localStorage`, fall back to `prefers-color-scheme`, write `document.documentElement.dataset.theme`, set `document.documentElement.style.colorScheme`, and expose a translated toggle button.
3. **Theme-aware backgrounds:** Wire backgrounds through CSS selectors (`body` for light, `:root[data-theme='dark'] body` for dark). Use overlays/gradients above the images so text contrast remains acceptable in both modes.
4. **German/English i18n:** Implement `Language = "en" | "de"`, complete dictionaries for both languages, a typed `translate()`/`t()` helper with parameter interpolation, language detection from `localStorage` and `navigator.language`, a language switcher, and `document.documentElement.lang` + `document.title` updates.
5. **No hardcoded UI strings:** All visible labels, buttons, status messages, errors, ARIA labels, document titles, and theme/language controls must use i18n keys in both English and German.

Recommended theme pattern:

```typescript
type Theme = "light" | "dark";
const themeStorageKey = "app-theme";

function getInitialTheme(): Theme {
  const stored = window.localStorage.getItem(themeStorageKey);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

useEffect(() => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(themeStorageKey, theme);
}, [theme]);
```

Recommended background CSS pattern:

```css
body {
  background-image:
    linear-gradient(135deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.72)),
    url("./assets/background_light.png");
  background-attachment: fixed;
  background-position: center;
  background-size: cover;
}

:root[data-theme='dark'] body {
  background-image:
    linear-gradient(135deg, rgba(0, 0, 0, 0.76), rgba(0, 0, 0, 0.72)),
    url("./assets/background_dark.png");
}
```

Recommended i18n contract:

```typescript
export type Language = "en" | "de";
export type TranslationKey = "app.title" | "common.language" | "common.darkMode";
export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

const dictionaries: Record<Language, Record<TranslationKey, string>> = {
  en: { "app.title": "App", "common.language": "Language", "common.darkMode": "Dark" },
  de: { "app.title": "App", "common.language": "Sprache", "common.darkMode": "Dunkel" },
};
```

### Tauri Detection

```typescript
export function isTauriApp(): boolean {
    if (typeof window === "undefined") return false;
    return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}
```

- Detects Tauri v2 (`__TAURI_INTERNALS__`) and v1 (`__TAURI__`)
- Safe for SSR (checks `typeof window`)
- Used as the primary gate for all Tauri-specific code paths

### Dynamic Backend Port

```typescript
let tauriBackendPort: number = 8000;

export function setTauriBackendPort(port: number): void {
    tauriBackendPort = port;
}

export function getTauriBackendPort(): number {
    return tauriBackendPort;
}
```

- Module-level variable updated when `backend-ready` event arrives
- Default 8000 is a fallback; the actual port comes from Tauri

### Dynamic API Base URL

```typescript
export const getBackendBaseUrl = (): string => {
    const envUrl = import.meta.env.VITE_API_BASE_URL;
    if (envUrl) return envUrl;
    if (isTauriApp()) {
        return `http://127.0.0.1:${getTauriBackendPort()}`;
    }
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8000`;
};
```

- **Priority 1:** Explicit env var `VITE_API_BASE_URL` (for custom deployments)
- **Priority 2:** Tauri mode uses `127.0.0.1` with the dynamic port
- **Priority 3:** Web mode derives from `window.location`

### Session Token Management

```typescript
const SESSION_TOKEN_KEY = "session_token";

export function getSessionToken(): string | null {
    return localStorage.getItem(SESSION_TOKEN_KEY);
}

export function setSessionToken(token: string): void {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
}

// Axios interceptor
apiClient.interceptors.request.use((config) => {
    const token = getSessionToken();
    if (token) {
        config.headers.Authorization = `Session ${token}`;
    }
    return config;
});
```

- Stored in `localStorage` (not cookies) for Tauri mode
- Axios interceptor adds `Authorization: Session <token>` to every request
- Login response includes the session key, which gets stored

### LoadingScreen Pattern

```typescript
useEffect(() => {
    if (!isTauriApp()) return;

    const setupListeners = async () => {
        const { listen } = await import("@tauri-apps/api/event");

        await listen<{ port: number }>("backend-ready", (event) => {
            setTauriBackendPort(event.payload.port);
            updateApiBaseUrl(event.payload.port);
            onReady();
        });

        await listen<{ error: string }>("backend-error", (event) => {
            setError(event.payload.error);
        });
    };

    void setupListeners();
}, [onReady]);
```

- **Primary:** Listen for `backend-ready` Tauri event (fast path)
- **Fallback:** Poll `GET /api/health/` with exponential backoff (if event is missed)
- Use a `hasCalledReady` ref to prevent double-invocation of `onReady()`
- Show status messages and a progress indicator during startup
- App renders `<LoadingScreen>` when `isTauriApp() && !djangoReady`, normal content otherwise

### Dynamic Tauri Imports

**Critical rule:** Never import `@tauri-apps/*` at the top level. Always use dynamic imports:

```typescript
// WRONG -- breaks in browser
import { open } from "@tauri-apps/plugin-opener";

// CORRECT -- browser-safe
export async function openUrl(url: string): Promise<void> {
    if (isTauriApp()) {
        const { open } = await import("@tauri-apps/plugin-opener");
        await open(url);
    } else {
        window.open(url, "_blank");
    }
}
```

### Vite Configuration

```typescript
export default defineConfig({
    server: {
        proxy: {
            "/api": "http://127.0.0.1:8000",
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    tauri: ["@tauri-apps/api", "@tauri-apps/plugin-opener"],
                },
            },
        },
    },
});
```

- Dev proxy routes `/api` to Django to avoid CORS in development
- `manualChunks` isolates Tauri dependencies into a separate bundle chunk

---

## PyInstaller Entry Point (Django / Python)

### tauri_entry.py Structure

```python
import sys
import os
from pathlib import Path

def is_frozen() -> bool:
    return getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")

def setup_environment(db_path: Path | None = None) -> tuple[Path, Path]:
    if is_frozen():
        base_dir = Path(sys._MEIPASS)
    else:
        base_dir = Path(__file__).resolve().parent

    app_data_dir = Path(os.environ.get("TAURI_APP_DATA_DIR", base_dir / "data"))
    app_data_dir.mkdir(parents=True, exist_ok=True)

    if db_path is None:
        db_path = app_data_dir / "db.sqlite3"

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.base")
    os.environ["DJANGO_DATABASE_PATH"] = str(db_path)
    os.environ.setdefault("CORS_ALLOWED_ORIGINS", "tauri://localhost,https://tauri.localhost")

    return app_data_dir, db_path

def run_server():
    app_data_dir, db_path = setup_environment()

    import django
    django.setup()
    from django.core.management import execute_from_command_line

    execute_from_command_line(["manage.py", "migrate", "--noinput"])

    port = os.environ.get("BACKEND_PORT", "8000")
    execute_from_command_line(["manage.py", "runserver", f"127.0.0.1:{port}", "--noreload"])

def init_database(db_path, admin_user=None, admin_email=None, admin_password=None):
    """Called by NSIS installer via --init-db flag."""
    setup_environment(db_path)

    import django
    django.setup()
    from django.core.management import execute_from_command_line

    execute_from_command_line(["manage.py", "migrate", "--noinput"])

    if admin_user and admin_password:
        from django.contrib.auth import get_user_model
        User = get_user_model()
        if not User.objects.filter(username=admin_user).exists():
            User.objects.create_superuser(admin_user, admin_email, admin_password)

    return 0
```

- `--noreload` is mandatory: Django's reloader doesn't work inside PyInstaller
- `--init-db` mode runs migrations and creates admin user during install (called from NSIS hooks)
- `TAURI_APP_DATA_DIR` is set by Rust, pointing to the OS-appropriate app data directory

### PyInstaller Spec Essentials

- **Mode:** `onedir` (not `onefile`) -- faster startup, easier to bundle in Tauri
- **Hidden imports:** Explicitly list all Django apps, database backends, REST framework modules
- **Excludes:** Strip dev-only packages (pytest, debug-toolbar, etc.) to reduce bundle size
- **Data files:** Include Django templates, static files, locale files

---

## Build Pipeline

### Full Build Sequence

```
1. PyInstaller: bundle Django backend into standalone executable
   └── Output: dist/tauri_entry/ (directory with executable + dependencies)

2. Copy backend to Tauri resources:
   └── cp -r dist/tauri_entry/ frontend/src-tauri/resources/python-backend/

3. Vite: build React frontend
   └── Output: frontend/dist/ (static HTML/JS/CSS)

4. Tauri build: package everything into native installer
   └── Input: frontend/dist/ (frontend) + resources/ (backend)
   └── Output: NSIS installer (Windows), DMG (macOS), DEB/AppImage (Linux)
```

### build.rs (Compile-Time Resource Sync)

```rust
fn main() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();

    sync_templates(repo_root, manifest_dir);
    sync_release_notes(repo_root, manifest_dir);
    load_dotenv(repo_root);

    tauri_build::build();
}
```

- Runs at compile time, copies resources from repo root into `src-tauri/resources/`
- `load_dotenv()` makes `.env` values available via `option_env!()` macros (e.g., updater PAT)

### tauri.conf.json Key Settings

```json
{
    "bundle": {
        "resources": [
            "resources/python-backend/**/*",
            "resources/templates/**/*"
        ]
    },
    "app": {
        "security": {
            "csp": "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost http://localhost:8000 http://127.0.0.1:8000 https://*; img-src 'self' data: https: http://localhost:8000 http://127.0.0.1:8000; font-src 'self' data:;"
        }
    }
}
```

- **CSP:** `connect-src` and `img-src` must include `http://127.0.0.1:8000` for backend connectivity
- **Bundle resources:** Glob patterns for the PyInstaller output directory and any additional resources

### Tauri Plugins

| Plugin | Purpose | Config |
|---|---|---|
| `updater` | Optional Tauri built-in updater from GitHub/custom endpoints | Public key + endpoint in `tauri.conf.json`, PAT via `option_env!()` for private repos |
| `fs` | Filesystem access from frontend | Scope paths in `tauri.conf.json` capabilities |
| `shell` | Run shell commands from frontend | Scope allowed commands |
| `opener` | Open URLs and files in default app | No special config needed |
| `notification` | Desktop notifications | Windows: requires AUMID setup |
| `autostart` | Launch on system boot | Platform-specific registration |

The configurable filesystem update checker is app/backend logic, not a Tauri plugin. Prefer it when updates are distributed by copying installers to an internal network/local folder; use Tauri's built-in updater only when the project has signed updater metadata/endpoints.

---

## Deployment Modes

### Desktop (Tauri)

- Tauri spawns Django, React runs in WebView
- Backend binds to `127.0.0.1` only (not exposed to network)
- Auth via `Authorization: Session` header (localStorage)
- Database: SQLite in app data directory
- Distribution: NSIS (Windows), DMG (macOS), DEB/AppImage (Linux)

### Web (Docker)

- Django behind Gunicorn + Nginx reverse proxy
- React served as static files by Nginx
- Auth via session cookies (standard Django behavior)
- Database: PostgreSQL
- Distribution: Docker Compose

### Development

- Mandatory one-command local runner: `./scripts/start.sh` from the repository root starts Django and React together.
- Django: `uv run python manage.py runserver 0.0.0.0:8000`
- React: `bun run dev` (port 5173) with proxy or `VITE_API_BASE_URL` pointing to Django
- Tauri: `tauri dev` wraps Vite dev server in WebView and starts/uses the local Django backend according to the lifecycle wiring
- All development processes must have clear cleanup behavior on Ctrl+C or app exit

---

## Platform-Specific Gotchas

### Windows

| Issue | Details | Solution |
|---|---|---|
| **Console window** | PyInstaller subprocess shows a command prompt | `CREATE_NO_WINDOW` flag (0x08000000) on `Command::new()` |
| **Process tree cleanup** | `child.kill()` only kills the parent; PyInstaller child processes survive | `taskkill /F /T /PID` kills the entire tree |
| **UNC path prefix** | Tauri's `resource_dir()` returns `\\?\C:\...` which Python can't handle | Strip `\\?\` prefix before passing to Python |
| **NSIS installer hooks** | Need to run `--init-db` during install and cleanup on uninstall | Custom NSIS hooks in `tauri.conf.json` |
| **Toast notifications** | Windows requires an AUMID for notifications | `SetCurrentProcessExplicitAppUserModelID` in Rust |
| **Tray behavior** | Users expect minimize-to-tray on Windows | `api.prevent_close()` + `window.hide()` on `CloseRequested` |

### macOS

| Issue | Details | Solution |
|---|---|---|
| **Code signing** | Required for distribution outside App Store | Sign with Developer ID, notarize with `xcrun notarytool` |
| **Universal binary** | Need to support both Intel and Apple Silicon | Build PyInstaller for both architectures, or use Rosetta 2 |

### Linux

| Issue | Details | Solution |
|---|---|---|
| **Package formats** | Users expect .deb or .AppImage depending on distro | Build both via `tauri build` |
| **System tray** | Behavior varies by desktop environment | Test on GNOME and KDE at minimum |

---

## Additional Reusable Local-First Desktop Patterns

These patterns extend the baseline integration for local-first desktop apps with mutable SQLite data, per-user Windows installers, plain Django views, and internal filesystem-based updates.

### Desktop App Configuration and Mutable Database Path

Use a small JSON settings file in Tauri's app data directory for mutable desktop-only settings, especially the SQLite database path.

Recommended database path precedence:

1. Explicit environment variable for admin/debug overrides
2. In-app `settings.json` for user-selected runtime configuration
3. Installer-provided source such as Windows registry or `database-path.txt`
4. Default app-data path such as `<app-data>/db.sqlite3`

Expose Rust commands for the settings UI:

```rust
#[tauri::command]
fn app_config(...) -> Result<AppConfigPayload, String>;

#[tauri::command]
fn save_app_config(..., database_path: String) -> Result<AppConfigPayload, String>;

#[tauri::command]
fn restart_backend(...) -> Result<AppConfigPayload, String>;
```

Useful payload fields: `configPath`, `databasePath`, `databasePathSource`, `defaultDatabasePath`, `runningDatabasePath`, `runningPort`, and `restartRequired`.

### Packaged Backend Resolution With Development Fallback

Do not assume a single backend resource layout. Check several packaged backend candidates, then fall back to a development launcher only in debug builds.

```rust
fn spawn_backend(app: &AppHandle, port: u16) -> Result<(Child, PathBuf), String> {
    match resolve_packaged_backend_path(app) {
        Ok(path) => spawn_packaged_backend(app, &path, port),
        Err(packaged_error) if cfg!(debug_assertions) => {
            spawn_dev_backend(app, port)
                .map_err(|dev_error| format!("{packaged_error}. Development fallback also failed: {dev_error}"))
        }
        Err(packaged_error) => Err(format!(
            "{packaged_error}. The desktop build is missing the bundled Django backend. Run the backend bundle script before Tauri packaging."
        )),
    }
}
```

Development fallback can run `uv run python tauri_entry.py` from the backend directory. Release builds should fail with a user-actionable packaging message.

### Backend Startup Diagnostics and Missed-Event Fallback

In addition to `backend-ready` / `backend-error` events, expose commands the frontend can poll if it misses an event during startup:

```rust
#[tauri::command]
fn backend_port(state: tauri::State<'_, Mutex<Option<BackendState>>>) -> Option<u16>;

#[tauri::command]
fn backend_startup_error(state: tauri::State<'_, Mutex<Option<String>>>) -> Option<String>;
```

Emit richer readiness payloads for diagnostics:

```json
{
  "port": 8000,
  "databasePath": ".../db.sqlite3",
  "backendReadyMs": 2310,
  "healthReadyMs": 1804
}
```

Frontend loading screens should both listen for events and poll `backend_port` / `backend_startup_error` every ~500ms until ready or failed.

### Plain Django Session Header Authentication

For projects using regular Django views instead of DRF, implement session-header auth as middleware rather than DRF authentication classes.

```python
SESSION_AUTH_SCHEME = "session"

def get_authorization_session_key(request):
    header = request.META.get("HTTP_AUTHORIZATION", "")
    parts = header.split()
    if len(parts) != 2 or parts[0].lower() != SESSION_AUTH_SCHEME:
        return None
    return parts[1]
```

Recommended middleware split:

1. `SessionHeaderCsrfExemptMiddleware` before `CsrfViewMiddleware`: validate `Authorization: Session <session_key>` against the session store, attach the user/session, then set `_dont_enforce_csrf_checks = True` only for valid session headers.
2. `SessionHeaderAuthenticationMiddleware` after Django auth middleware: assign `request.session`, assign `request.user`, and refresh session expiry.

This preserves normal cookie + CSRF behavior for browser mode while allowing reliable Tauri requests with an `Authorization: Session ...` header.

### Fetch-Based API Wrapper Alternative

Axios is not required. A small `fetch` wrapper works well if it centralizes cookie CSRF and Tauri session headers:

```typescript
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string> | undefined),
    };
    const csrfToken = getCookie("csrftoken");
    const sessionToken = getSessionToken();
    if (csrfToken) headers["X-CSRFToken"] = decodeURIComponent(csrfToken);
    if (sessionToken) headers.Authorization = `Session ${sessionToken}`;

    const response = await fetch(`${getApiBaseUrl()}${path}`, {
        credentials: "include",
        ...options,
        headers,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Request failed with status ${response.status}`);
    return body as T;
}
```

### Production Backend Server: Waitress Over runserver

Use Django `runserver --noreload` for development, but prefer Waitress for the packaged desktop backend, especially on Windows.

```python
def should_use_waitress() -> bool:
    default = "1" if is_frozen() else "0"
    return os.environ.get("USE_WAITRESS", default) == "1"

def run_backend_server(port: str) -> None:
    if should_use_waitress():
        from config.wsgi import application
        from waitress import serve
        serve(application, host="127.0.0.1", port=int(port), threads=4, clear_untrusted_proxy_headers=True)
    else:
        execute_from_command_line(["manage.py", "runserver", f"127.0.0.1:{port}", "--noreload"])
```

Keep binding to `127.0.0.1`; do not expose the embedded backend on `0.0.0.0` in desktop mode.

### PyInstaller Windowed stdout/stderr Safety

Windowed PyInstaller executables on Windows may start with `sys.stdout` / `sys.stderr` set to `None`. Django management commands can crash when writing to those streams.

At startup, redirect missing streams to an app-data log file:

```python
def ensure_standard_streams(app_data_dir: Path) -> None:
    if sys.stdout is not None and sys.stderr is not None:
        return
    log_path = app_data_dir / "backend.log"
    if sys.stdout is None:
        sys.stdout = log_path.open("a", encoding="utf-8", buffering=1)
    if sys.stderr is None:
        sys.stderr = log_path.open("a", encoding="utf-8", buffering=1)
```

Call this immediately after creating the app-data directory and before importing Django.

### Startup Migration Optimization

Avoid running full migrations on every desktop launch when the schema is already current.

```python
def migrations_are_current() -> bool:
    from django.core.management import call_command
    try:
        call_command("migrate", check=True, interactive=False, verbosity=0)
    except SystemExit as exc:
        return exc.code in (0, None)
    return True
```

If current, skip `migrate`; otherwise run `migrate --noinput`. Log timings for environment setup, Django setup, migration check, migration execution, and health readiness.

### First-Run Admin Setup

For local-first apps, avoid collecting admin credentials in the installer. Instead:

- `GET /api/auth/setup/` returns whether no users exist
- `POST /api/auth/setup-admin/` creates the first admin only if the user table is empty
- Login the new admin immediately and return `sessionToken`
- Return `409 Conflict` if setup is already complete

This keeps credential entry inside the app UI, avoids installer blocking, and works the same for fresh installs and reset databases.

### Windows NSIS Installer Data Coordination

For per-user Windows installers with mutable SQLite data:

- Use `installMode: "currentUser"` unless machine-wide install is required
- Let the installer choose/create a database path and write it to both registry and `database-path.txt`
- On update/repair, keep existing app `settings.json` silently instead of overwriting user choices
- Close running app and backend processes before update/install using `taskkill /IM ...`, then `taskkill /F /T ...`
- Do **not** run the bundled backend from the NSIS InstallFiles page; migrations can block the installer UI and make Cancel appear stuck
- Defer database initialization/migrations/admin setup to first app launch

On uninstall, preserve local SQLite data before removing app directories. Include sidecar files:

- `*.sqlite`, `*.sqlite3`, `*.db`
- `*-wal`, `*-shm`, `*-journal`

### Local Installer-Based Updates Hardening

The mandatory configurable filesystem update system should also follow these hardening rules:

- Never launch arbitrary paths from user input
- Require the file to exist and match an approved installer filename pattern
- Require `installer.relative_to(source_dir)` to succeed after resolving symlinks/relative segments
- Hide internal source paths from unauthenticated users
- Pass `TAURI_APP_VERSION` / `APP_VERSION` from Rust to Django so comparisons use the installed desktop app version, not only backend package metadata
- Minimize or hide the Tauri window after launching the installer so native installer prompts are visible

---

## Troubleshooting Checklist

When something isn't working across the integration boundary, trace the chain:

### Backend Won't Start

1. Is the port available? (`TcpListener::bind()` should succeed)
2. Does the executable exist at the expected resource path?
3. Is `CREATE_NO_WINDOW` set on Windows?
4. Are UNC paths stripped on Windows?
5. Check Tauri logs for spawn errors
6. Check Django logs for startup errors (missing migrations, import errors)

### Auth Not Working in Tauri

1. What's the request origin? (Should be `tauri://localhost` or `https://tauri.localhost`)
2. Is `CORS_ALLOWED_ORIGIN_REGEXES` configured for Tauri origins?
3. Is the session token being stored in localStorage after login?
4. Is the axios interceptor adding `Authorization: Session <token>`?
5. Is `HybridSessionAuthentication` in DRF's `DEFAULT_AUTHENTICATION_CLASSES`?
6. Check browser devtools Network tab for CORS preflight failures

### Build Failing

1. **PyInstaller:** Check hidden imports -- are all Django apps listed? Any dynamic imports?
2. **Resource copy:** Did the PyInstaller output get copied to `src-tauri/resources/python-backend/`?
3. **Vite build:** Any TypeScript errors? Missing env vars?
4. **Tauri build:** Check `tauri.conf.json` bundle resource globs
5. **CSP:** Does `connect-src` include the backend URL?

### Works in Browser, Fails in Tauri

1. Is the code behind an `isTauriApp()` check?
2. Are Tauri imports dynamic (`await import(...)`) not static?
3. Is the API base URL using the dynamic port (not hardcoded 8000)?
4. Are cookies being relied on? (Switch to session token header in Tauri)

---

## Scripts

Two automation scripts live in `scripts/` alongside this SKILL.md.

### ./scripts/scaffold.py -- Generate Integration Boilerplate

Creates all Tauri + Django + React integration files for a new project, plus mandatory `scripts/start.sh`, GitHub release automation, and the configurable filesystem update checker: Rust backend lifecycle, Django hybrid auth, update APIs/services, React Tauri/update detection, build scripts, release scripts, workflow configuration, and app configuration.

```bash
python3 {baseDir}/scripts/scaffold.py \
  --project-root /path/to/project \
  --app-name "My App" \
  --app-id com.example.myapp
```

**All arguments:**

| Argument | Required | Default | Description |
|---|---|---|---|
| `--project-root` | Yes | -- | Path to the project root |
| `--app-name` | Yes | -- | Human-readable app name |
| `--app-id` | Yes | -- | Reverse-domain identifier (e.g. `com.example.myapp`) |
| `--port-range` | No | `8000-8010` | Backend port range as `START-END` |
| `--django-apps` | No | `api` | Comma-separated Django app names for PyInstaller |
| `--settings-module` | No | `config.settings.base` | Django settings module path |
| `--dry-run` | No | -- | Preview files without writing |
| `--force` | No | -- | Overwrite existing files |

**Generated files:**

| Layer | File | Purpose |
|---|---|---|
| Rust | `frontend/src-tauri/src/lib.rs` | Backend lifecycle, port selection, health polling, cleanup |
| Rust | `frontend/src-tauri/build.rs` | Resource sync, dotenv loading |
| Rust | `frontend/src-tauri/Cargo.toml` | Dependencies and plugins |
| Rust | `frontend/src-tauri/tauri.conf.json` | CSP, bundle resources, window config |
| Rust | `frontend/src-tauri/capabilities/default.json` | Plugin permissions |
| Python | `backend/tauri_entry.py` | PyInstaller entry point |
| Python | `backend/api/authentication.py` | HybridSessionAuthentication |
| Python | `backend/api/views/health.py` | Health check endpoint |
| Python | `backend/api/services/update_service.py` | Configurable update-source path, installer discovery, safe installer launch |
| Python | `backend/api/views/updates.py` | Update check/settings/install API views |
| Python | `backend/pyinstaller.spec` | PyInstaller bundling config |
| TypeScript | `frontend/src/utils/tauri.ts` | isTauriApp(), port management |
| TypeScript | `frontend/src/services/api-tauri.ts` | Dynamic URL, session tokens, axios interceptor |
| TypeScript | `frontend/src/services/update-service.ts` | Update check/settings/install API client helpers |
| TypeScript | `frontend/src/components/LoadingScreen.tsx` | Backend readiness UI |
| TypeScript | `frontend/src/components/UpdateButton.tsx` | Check/install update UI pattern |
| Shell | `scripts/build-backend.sh` | PyInstaller build + copy to resources |
| PowerShell | `scripts/build-backend.ps1` | Windows equivalent |
| Shell | `scripts/start.sh` | Mandatory one-command local runner for Django + React development |
| GitHub Actions | `.github/workflows/release.yml` | Mandatory tag/manual release workflow that builds and publishes installers |
| Shell | `scripts/release.sh` | Mandatory release helper that bumps versions, commits, tags, and triggers CI |
| Docs | `dev/RELEASES/.gitkeep` | Canonical release notes directory for `RELEASE_vX.X.X.md` files |
| Environment | `.env.example` | Documents `APP_UPDATE_SOURCE_PATH`, `APP_CONFIG_PATH`, installer-pattern overrides, and updater/signing env vars |

Skips files that already exist unless `--force` is passed. After scaffolding, the script prints next steps (dependency installation, health/update URL wiring, release workflow setup, update-source path configuration, settings config).

### ./scripts/validate.py -- Check Setup Correctness

Inspects an existing project and validates cross-layer configuration consistency across all three layers, including mandatory `scripts/start.sh` and GitHub release automation.

```bash
python3 {baseDir}/scripts/validate.py \
  --project-root /path/to/project \
  --fix-suggestions
```

**All arguments:**

| Argument | Required | Default | Description |
|---|---|---|---|
| `--project-root` | Yes | -- | Path to the project root |
| `--format` | No | `text` | Output format: `text` or `json` |
| `--fix-suggestions` | No | -- | Include fix suggestions for failures/warnings |

**What it checks:**

| Category | Key Checks |
|---|---|
| Tauri Configuration | CSP origins (ipc, localhost, 127.0.0.1), bundle resources, devUrl, frontendDist |
| Cargo Dependencies | Required crates (tauri, reqwest, serde), blocking feature, tauri-build |
| Build Script | `tauri_build::build()` call present |
| Rust Entry Point | Port selection, backend-ready event, health polling, process cleanup |
| Django Authentication | HybridSessionAuthentication, SessionTokenAuthentication |
| Django Settings | CORS origins, CSRF trusted origins, CORS_ALLOW_CREDENTIALS, auth classes, session config |
| Health Endpoint | Exists, uses AllowAny permission |
| Tauri Entry Point | --noreload, BACKEND_PORT, migrations |
| Tauri Utilities | isTauriApp(), window globals, port getter/setter |
| Static Import Check | No top-level `@tauri-apps/*` imports (must be dynamic) |
| Session Token | localStorage management, Authorization: Session interceptor |
| Loading Screen | backend-ready listener, health polling fallback |
| Filesystem Update System | Django update service/API, configurable `update_source_path`, installer pattern/version checks, frontend update helpers/UI, env documentation |
| Port Consistency | Rust port range matches Django CORS/CSRF config, devUrl matches Vite |
| Environment Files | TAURI_SIGNING_PRIVATE_KEY, GITHUB_PAT_UPDATER, APP_UPDATE_SOURCE_PATH |
| Start Script | `scripts/start.sh`, executable bit, `uv`, `bun`, backend/frontend startup, cleanup trap |
| Release Automation | `.github/workflows/release.yml`, executable `scripts/release.sh`, canonical `dev/RELEASES/` release-notes path |

**Exit codes:** `0` = all checks pass, `1` = failures found, `2` = script error

**JSON output** (for CI integration):

```bash
python3 {baseDir}/scripts/validate.py --project-root . --format json
```

---

## Integration

- **Cross-reference:** `architecture-review` skill for layer boundary assessment, `design-patterns` for cross-layer communication patterns, `deployment-automation` for CI/CD pipeline implementation
- **Memory:** Log project-specific quirks, build issues, and platform gotchas to `MEMORY.md`

---

_Nexus skill -- Tauri + Django + React technical integration reference_
