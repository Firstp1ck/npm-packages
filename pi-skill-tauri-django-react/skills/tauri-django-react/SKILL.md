---
name: tauri-django-react
description: Agents should invoke this skill for Tauri + Django + React desktop apps, especially backend lifecycle, CORS/auth, frontend integration, build packaging, dual desktop/web deployment, Rust commands, and platform-specific gotchas.
---

# Tauri + Django + React Integration Patterns

Dense technical reference for building desktop applications that use Tauri as the native shell, Django as the backend API, and React as the frontend UI. Every pattern is battle-tested in the Externe Analytik project and designed for reuse across projects.

This skill is self-contained; it must not depend on package-level `docs/` files at runtime.

---

## Quick Start

### Identify the Integration Concern

1. **Which layers are involved?** If the question spans two or more of Rust/Python/TypeScript, this skill applies.
2. **Is it a lifecycle issue?** Port selection, process spawning, health checking, cleanup -> Backend Lifecycle section.
3. **Is it an auth issue?** Cookies not working in Tauri, CORS errors, session tokens -> Cross-Origin Auth section.
4. **Is it a build issue?** PyInstaller fails, bundle missing files, `tauri build` errors -> Build Pipeline section.
5. **Is it a dual-mode issue?** Works in browser but not Tauri (or vice versa) -> Frontend Integration section.

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

#[cfg(target_os = "windows")]
{
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
}

let child = cmd.spawn()?;
```

- Backend path resolved from `resource_dir/python-backend/tauri_entry` (+ `.exe` on Windows)
- `CREATE_NO_WINDOW` (0x08000000) prevents a visible console window on Windows
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
| `updater` | Auto-update from GitHub releases | Public key + endpoint in `tauri.conf.json`, PAT via `option_env!()` for private repos |
| `fs` | Filesystem access from frontend | Scope paths in `tauri.conf.json` capabilities |
| `shell` | Run shell commands from frontend | Scope allowed commands |
| `opener` | Open URLs and files in default app | No special config needed |
| `notification` | Desktop notifications | Windows: requires AUMID setup |
| `autostart` | Launch on system boot | Platform-specific registration |

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

- Django: `manage.py runserver 0.0.0.0:8000`
- React: `vite dev` (port 5173) with proxy to Django
- Tauri: `tauri dev` wraps Vite dev server in WebView
- All three run concurrently

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

Creates all Tauri + Django + React integration files for a new project. Generates 14 files across three layers: Rust backend lifecycle, Django hybrid auth, React Tauri detection, build scripts, and configuration.

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
| Python | `backend/pyinstaller.spec` | PyInstaller bundling config |
| TypeScript | `frontend/src/utils/tauri.ts` | isTauriApp(), port management |
| TypeScript | `frontend/src/services/api-tauri.ts` | Dynamic URL, session tokens, axios interceptor |
| TypeScript | `frontend/src/components/LoadingScreen.tsx` | Backend readiness UI |
| Shell | `scripts/build-backend.sh` | PyInstaller build + copy to resources |
| PowerShell | `scripts/build-backend.ps1` | Windows equivalent |

Skips files that already exist unless `--force` is passed. After scaffolding, the script prints next steps (dependency installation, URL wiring, settings config).

### ./scripts/validate.py -- Check Setup Correctness

Inspects an existing project and validates cross-layer configuration consistency. Checks 14 categories across all three layers.

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
| Port Consistency | Rust port range matches Django CORS/CSRF config, devUrl matches Vite |
| Environment Files | TAURI_SIGNING_PRIVATE_KEY, GITHUB_PAT_UPDATER |

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
