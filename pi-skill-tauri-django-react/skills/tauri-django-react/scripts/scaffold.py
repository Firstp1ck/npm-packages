#!/usr/bin/env python3
"""
Scaffold Tauri + Django + React integration files for a new project.

Generates all cross-layer boilerplate: Rust backend lifecycle, Django hybrid auth,
React Tauri detection, build scripts, configuration files, and a mandatory root start.sh.

Usage:
    python3 scaffold.py --project-root /path/to/project --app-name "My App" --app-id com.example.myapp
    python3 scaffold.py --project-root /path/to/project --app-name "My App" --app-id com.example.myapp --dry-run
"""
import argparse
import json
import os
import sys
from pathlib import Path
from textwrap import dedent


# ---------------------------------------------------------------------------
# Template registry: (relative_path, template_function)
# ---------------------------------------------------------------------------

def get_templates(ctx: dict) -> list[tuple[str, str]]:
    """Return list of (relative_path, content) tuples for all integration files."""
    return [
        ("frontend/src-tauri/src/lib.rs", _tmpl_lib_rs(ctx)),
        ("frontend/src-tauri/build.rs", _tmpl_build_rs(ctx)),
        ("frontend/src-tauri/Cargo.toml", _tmpl_cargo_toml(ctx)),
        ("frontend/src-tauri/tauri.conf.json", _tmpl_tauri_conf(ctx)),
        ("frontend/src-tauri/capabilities/default.json", _tmpl_capabilities(ctx)),
        ("backend/tauri_entry.py", _tmpl_tauri_entry(ctx)),
        ("backend/api/authentication.py", _tmpl_authentication(ctx)),
        ("backend/api/views/health.py", _tmpl_health_view(ctx)),
        ("backend/pyinstaller.spec", _tmpl_pyinstaller_spec(ctx)),
        ("frontend/src/utils/tauri.ts", _tmpl_tauri_ts(ctx)),
        ("frontend/src/services/api-tauri.ts", _tmpl_api_tauri_ts(ctx)),
        ("frontend/src/components/LoadingScreen.tsx", _tmpl_loading_screen(ctx)),
        ("scripts/build-backend.sh", _tmpl_build_backend_sh(ctx)),
        ("scripts/build-backend.ps1", _tmpl_build_backend_ps1(ctx)),
        ("start.sh", _tmpl_start_sh(ctx)),
    ]


# ---------------------------------------------------------------------------
# Tauri / Rust templates
# ---------------------------------------------------------------------------

def _tmpl_lib_rs(ctx: dict) -> str:
    return dedent(f"""\
        use std::net::TcpListener;
        use std::process::{{Child, Command}};
        use std::sync::Mutex;
        use std::time::Duration;

        use serde_json::json;
        use tauri::{{AppHandle, Emitter, Manager}};

        const DEFAULT_BACKEND_PORT: u16 = {ctx["port_start"]};
        const MAX_PORT_OFFSET: u16 = {ctx["port_end"] - ctx["port_start"]};
        const HEALTH_CHECK_MAX_RETRIES: u32 = 60;
        const HEALTH_CHECK_INTERVAL_MS: u64 = 500;

        struct BackendState {{
            child: Child,
            port: u16,
        }}

        fn find_available_port() -> Option<u16> {{
            for offset in 0..=MAX_PORT_OFFSET {{
                let port = DEFAULT_BACKEND_PORT + offset;
                if TcpListener::bind(("127.0.0.1", port)).is_ok() {{
                    return Some(port);
                }}
            }}
            None
        }}

        fn resolve_backend_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {{
            let resource_dir = app
                .path()
                .resource_dir()
                .map_err(|e| format!("Failed to get resource dir: {{e}}"))?;

            let mut backend_dir = resource_dir.join("python-backend");

            // Strip Windows UNC prefix that Python cannot handle
            #[cfg(target_os = "windows")]
            {{
                let s = backend_dir.to_string_lossy().to_string();
                if let Some(stripped) = s.strip_prefix("\\\\\\\\?\\\\") {{
                    backend_dir = std::path::PathBuf::from(stripped);
                }}
            }}

            let exe_name = if cfg!(target_os = "windows") {{
                "tauri_entry.exe"
            }} else {{
                "tauri_entry"
            }};

            let backend_path = backend_dir.join(exe_name);
            if !backend_path.exists() {{
                return Err(format!("Backend executable not found: {{backend_path:?}}"));
            }}

            Ok(backend_path)
        }}

        fn spawn_backend(app: &AppHandle, port: u16) -> Result<Child, String> {{
            let backend_path =
                resolve_backend_path(app).map_err(|e| format!("Resolve path: {{e}}"))?;
            let backend_dir = backend_path.parent().unwrap();

            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("App data dir: {{e}}"))?;
            std::fs::create_dir_all(&app_data)
                .map_err(|e| format!("Create app data dir: {{e}}"))?;

            let db_path = app_data.join("db.sqlite3");

            let mut cmd = Command::new(&backend_path);
            cmd.current_dir(backend_dir);
            cmd.env("BACKEND_PORT", port.to_string());
            cmd.env(
                "DJANGO_DATABASE_PATH",
                db_path.to_string_lossy().to_string(),
            );
            cmd.env(
                "TAURI_APP_DATA_DIR",
                app_data.to_string_lossy().to_string(),
            );

            #[cfg(target_os = "windows")]
            {{
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }}

            cmd.spawn()
                .map_err(|e| format!("Failed to spawn backend: {{e}}"))
        }}

        fn poll_health(app: &AppHandle, port: u16) -> Result<(), String> {{
            let client = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(2))
                .build()
                .map_err(|e| format!("HTTP client: {{e}}"))?;

            let url = format!("http://127.0.0.1:{{}}/api/health/", port);

            for _attempt in 0..HEALTH_CHECK_MAX_RETRIES {{
                match client.get(&url).send() {{
                    Ok(resp) if resp.status().is_success() => {{
                        let _ = app.emit("backend-ready", json!({{ "port": port }}));
                        return Ok(());
                    }}
                    _ => std::thread::sleep(Duration::from_millis(HEALTH_CHECK_INTERVAL_MS)),
                }}
            }}

            let msg = format!("Backend did not become healthy after {{HEALTH_CHECK_MAX_RETRIES}} retries");
            let _ = app.emit("backend-error", json!({{ "error": &msg }}));
            Err(msg)
        }}

        fn kill_backend_process(state: &Mutex<Option<BackendState>>) {{
            if let Some(mut backend) = state.lock().unwrap().take() {{
                #[cfg(target_os = "windows")]
                {{
                    use std::os::windows::process::CommandExt;
                    let _ = Command::new("taskkill")
                        .args(["/F", "/T", "/PID", &backend.child.id().to_string()])
                        .creation_flags(0x08000000)
                        .output();
                }}
                #[cfg(not(target_os = "windows"))]
                {{
                    let _ = backend.child.kill();
                }}
            }}
        }}

        #[cfg_attr(mobile, tauri::mobile_entry_point)]
        pub fn run() {{
            tauri::Builder::default()
                .manage(Mutex::new(None::<BackendState>))
                .plugin(tauri_plugin_opener::init())
                .plugin(tauri_plugin_fs::init())
                .plugin(tauri_plugin_shell::init())
                .plugin(tauri_plugin_process::init())
                .plugin(tauri_plugin_notification::init())
                .plugin(tauri_plugin_http::init())
                .plugin(tauri_plugin_updater::Builder::new().build())
                .setup(|app| {{
                    let handle = app.handle().clone();

                    std::thread::spawn(move || {{
                        let port = match find_available_port() {{
                            Some(p) => p,
                            None => {{
                                let _ = handle.emit(
                                    "backend-error",
                                    json!({{ "error": "No available port" }}),
                                );
                                return;
                            }}
                        }};

                        match spawn_backend(&handle, port) {{
                            Ok(child) => {{
                                if let Some(state) = handle.try_state::<Mutex<Option<BackendState>>>() {{
                                    *state.lock().unwrap() = Some(BackendState {{ child, port }});
                                }}
                                if let Err(e) = poll_health(&handle, port) {{
                                    log::error!("Health poll failed: {{e}}");
                                }}
                            }}
                            Err(e) => {{
                                let _ = handle.emit(
                                    "backend-error",
                                    json!({{ "error": e }}),
                                );
                            }}
                        }}
                    }});

                    Ok(())
                }})
                .on_window_event(|window, event| {{
                    if let tauri::WindowEvent::CloseRequested {{ api, .. }} = event {{
                        #[cfg(target_os = "windows")]
                        {{
                            api.prevent_close();
                            let _ = window.hide();
                        }}
                        #[cfg(not(target_os = "windows"))]
                        {{
                            let _ = api;
                            if let Some(state) = window.try_state::<Mutex<Option<BackendState>>>() {{
                                kill_backend_process(&state);
                            }}
                        }}
                    }}
                }})
                .build(tauri::generate_context!())
                .expect("error while building tauri application")
                .run(|app, event| {{
                    if let tauri::RunEvent::ExitRequested {{ .. }} = event {{
                        if let Some(state) = app.try_state::<Mutex<Option<BackendState>>>() {{
                            kill_backend_process(&state);
                        }}
                    }}
                }});
        }}
    """)


def _tmpl_build_rs(ctx: dict) -> str:
    return dedent("""\
        use std::fs;
        use std::path::Path;

        fn load_dotenv(repo_root: &Path) {
            let env_path = repo_root.join(".env");
            if env_path.exists() {
                if let Ok(content) = fs::read_to_string(&env_path) {
                    for line in content.lines() {
                        let line = line.trim();
                        if line.is_empty() || line.starts_with('#') {
                            continue;
                        }
                        if let Some((key, value)) = line.split_once('=') {
                            let key = key.trim();
                            let value = value.trim().trim_matches('"');
                            println!("cargo:rustc-env={key}={value}");
                        }
                    }
                }
            }
        }

        fn sync_directory(src: &Path, dst: &Path) {
            if src.is_dir() {
                let _ = fs::create_dir_all(dst);
                if let Ok(entries) = fs::read_dir(src) {
                    for entry in entries.flatten() {
                        let src_path = entry.path();
                        let dst_path = dst.join(entry.file_name());
                        if src_path.is_dir() {
                            sync_directory(&src_path, &dst_path);
                        } else {
                            let _ = fs::copy(&src_path, &dst_path);
                        }
                    }
                }
            }
        }

        fn main() {
            let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
            let repo_root = manifest_dir
                .parent()
                .expect("frontend/")
                .parent()
                .expect("repo root");

            // Sync additional resources from repo root into src-tauri/resources/
            let resources_dir = manifest_dir.join("resources");
            let _ = fs::create_dir_all(&resources_dir);

            let templates_src = repo_root.join("templates");
            if templates_src.is_dir() {
                sync_directory(&templates_src, &resources_dir.join("templates"));
            }

            load_dotenv(repo_root);

            tauri_build::build();
        }
    """)


def _tmpl_cargo_toml(ctx: dict) -> str:
    crate_name = ctx["app_id"].rsplit(".", 1)[-1].replace("-", "_")
    return dedent(f"""\
        [package]
        name = "{crate_name}"
        version = "0.1.0"
        edition = "2021"

        [build-dependencies]
        tauri-build = {{ version = "2", features = [] }}

        [dependencies]
        tauri = {{ version = "2", features = ["devtools", "tray-icon"] }}
        tauri-plugin-opener = "2"
        tauri-plugin-fs = "2"
        tauri-plugin-shell = "2"
        tauri-plugin-process = "2"
        tauri-plugin-notification = "2"
        tauri-plugin-http = "2"
        tauri-plugin-updater = "2"
        serde = {{ version = "1", features = ["derive"] }}
        serde_json = "1"
        reqwest = {{ version = "0.12", features = ["blocking", "json"] }}
        log = "0.4"
        dotenvy = "0.15"

        [profile.release]
        strip = true
        lto = true
        codegen-units = 1
    """)


def _tmpl_tauri_conf(ctx: dict) -> str:
    port_start = ctx["port_start"]
    conf = {
        "$schema": "https://raw.githubusercontent.com/nicehash/tauri/master/.github/schema.json",
        "productName": ctx["app_name"],
        "identifier": ctx["app_id"],
        "build": {
            "frontendDist": "../dist",
            "devUrl": "http://localhost:5173",
            "beforeDevCommand": "bun run dev",
            "beforeBuildCommand": "bun run build",
        },
        "app": {
            "windows": [
                {
                    "title": ctx["app_name"],
                    "width": 1200,
                    "height": 800,
                    "minWidth": 800,
                    "minHeight": 600,
                }
            ],
            "security": {
                "csp": (
                    f"default-src 'self'; "
                    f"connect-src 'self' ipc: http://ipc.localhost "
                    f"http://localhost:{port_start} http://127.0.0.1:{port_start} https://*; "
                    f"img-src 'self' data: https: "
                    f"http://localhost:{port_start} http://127.0.0.1:{port_start}; "
                    f"font-src 'self' data:; "
                    f"style-src 'self' 'unsafe-inline';"
                )
            },
        },
        "bundle": {
            "active": True,
            "icon": [
                "icons/32x32.png",
                "icons/128x128.png",
                "icons/128x128@2x.png",
                "icons/icon.icns",
                "icons/icon.ico",
            ],
            "resources": [
                "resources/python-backend/**/*",
                "resources/templates/**/*",
            ],
            "targets": ["nsis", "dmg", "deb", "appimage"],
        },
        "plugins": {
            "updater": {
                "pubkey": "YOUR_PUBLIC_KEY_HERE",
                "endpoints": ["https://your-update-endpoint.example.com/update/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}"],
                "windows": {"installMode": "passive"},
            }
        },
    }
    return json.dumps(conf, indent=2) + "\n"


def _tmpl_capabilities(ctx: dict) -> str:
    caps = {
        "$schema": "https://raw.githubusercontent.com/nicehash/tauri/master/.github/capabilities-schema.json",
        "identifier": "default",
        "description": f"{ctx['app_name']} default capabilities",
        "windows": ["main"],
        "permissions": [
            "core:default",
            "opener:default",
            "fs:default",
            "shell:default",
            "process:default",
            "notification:default",
            "http:default",
            {
                "identifier": "http:default",
                "allow": [
                    {"url": "http://localhost:*"},
                    {"url": "http://127.0.0.1:*"},
                ],
            },
        ],
    }
    return json.dumps(caps, indent=2) + "\n"


# ---------------------------------------------------------------------------
# Django / Python templates
# ---------------------------------------------------------------------------

def _tmpl_tauri_entry(ctx: dict) -> str:
    settings_module = ctx["settings_module"]
    return dedent(f"""\
        #!/usr/bin/env python3
        \"\"\"
        PyInstaller entry point for the Django backend when bundled inside Tauri.

        Modes:
            Default:     Start the Django development server (--noreload)
            --init-db:   Run migrations and optionally create a superuser (called by installer)
        \"\"\"
        import argparse
        import os
        import sys
        from pathlib import Path


        def is_frozen() -> bool:
            return getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


        def setup_environment(db_path: Path | None = None) -> tuple[Path, Path]:
            if is_frozen():
                base_dir = Path(sys._MEIPASS)  # type: ignore[attr-defined]
            else:
                base_dir = Path(__file__).resolve().parent

            app_data_dir = Path(os.environ.get("TAURI_APP_DATA_DIR", str(base_dir / "data")))
            app_data_dir.mkdir(parents=True, exist_ok=True)

            if db_path is None:
                db_path = app_data_dir / "db.sqlite3"

            os.environ.setdefault("DJANGO_SETTINGS_MODULE", "{settings_module}")
            os.environ["DJANGO_DATABASE_PATH"] = str(db_path)
            os.environ.setdefault(
                "CORS_ALLOWED_ORIGINS", "tauri://localhost,https://tauri.localhost"
            )

            return app_data_dir, db_path


        def run_server() -> None:
            app_data_dir, db_path = setup_environment()

            import django

            django.setup()
            from django.core.management import execute_from_command_line

            execute_from_command_line(["manage.py", "migrate", "--noinput"])

            port = os.environ.get("BACKEND_PORT", "8000")
            execute_from_command_line(
                ["manage.py", "runserver", f"127.0.0.1:{{port}}", "--noreload"]
            )


        def init_database(
            db_path: Path,
            admin_user: str | None = None,
            admin_email: str | None = None,
            admin_password: str | None = None,
        ) -> int:
            setup_environment(db_path)

            import django

            django.setup()
            from django.core.management import execute_from_command_line

            execute_from_command_line(["manage.py", "migrate", "--noinput"])

            if admin_user and admin_password:
                from django.contrib.auth import get_user_model

                User = get_user_model()
                if not User.objects.filter(username=admin_user).exists():
                    User.objects.create_superuser(
                        admin_user, admin_email or "", admin_password
                    )

            return 0


        def main() -> None:
            parser = argparse.ArgumentParser(description="Tauri backend entry point")
            parser.add_argument("--init-db", action="store_true", help="Initialize database only")
            parser.add_argument("--db-path", type=Path, help="Database file path")
            parser.add_argument("--admin-user", help="Admin username for --init-db")
            parser.add_argument("--admin-email", help="Admin email for --init-db")
            parser.add_argument("--admin-password", help="Admin password for --init-db")
            parser.add_argument("--app-data-dir", type=Path, help="App data directory")
            args = parser.parse_args()

            if args.app_data_dir:
                os.environ["TAURI_APP_DATA_DIR"] = str(args.app_data_dir)

            if args.init_db:
                db_path = args.db_path or Path("db.sqlite3")
                sys.exit(
                    init_database(db_path, args.admin_user, args.admin_email, args.admin_password)
                )
            else:
                run_server()


        if __name__ == "__main__":
            main()
    """)


def _tmpl_authentication(ctx: dict) -> str:
    return dedent("""\
        \"\"\"
        Hybrid authentication for Tauri desktop + browser web deployment.

        Tauri WebView runs from tauri://localhost, making cross-origin cookies unreliable.
        This module provides header-based session auth for Tauri alongside standard cookie
        auth for browsers.
        \"\"\"
        from django.conf import settings
        from django.contrib.auth import get_user_model
        from django.contrib.sessions.backends.db import SessionStore
        from rest_framework import authentication
        from rest_framework.exceptions import AuthenticationFailed

        User = get_user_model()


        class SessionTokenAuthentication:
            \"\"\"Authenticate via Authorization: Session <session_key> header.\"\"\"

            def authenticate(self, request):
                session_key = self._extract_key(request)
                if not session_key:
                    return None

                session = SessionStore(session_key=session_key)
                if not session.exists(session_key):
                    raise AuthenticationFailed("Invalid or expired session")

                user_id = session.get("_auth_user_id")
                if not user_id:
                    raise AuthenticationFailed("Session has no associated user")

                try:
                    user = User.objects.get(pk=user_id)
                except User.DoesNotExist:
                    raise AuthenticationFailed("User not found")

                # Sliding expiration
                session["_session_expiry"] = getattr(
                    settings, "SESSION_COOKIE_AGE", 1209600
                )
                session.save()

                return (user, None)

            @staticmethod
            def _extract_key(request) -> str | None:
                auth_header = authentication.get_authorization_header(request)
                if not auth_header:
                    return None
                parts = auth_header.decode("utf-8").split()
                if len(parts) == 2 and parts[0].lower() == "session":
                    return parts[1]
                return None


        class HybridSessionAuthentication(authentication.SessionAuthentication):
            \"\"\"
            Try header-based session token first (Tauri), then fall back to cookie
            session (browser).
            \"\"\"

            def authenticate(self, request):
                auth_header = authentication.get_authorization_header(request)
                if auth_header:
                    parts = auth_header.decode("utf-8").split()
                    if parts and parts[0].lower() == "session":
                        token_auth = SessionTokenAuthentication()
                        return token_auth.authenticate(request)
                return super().authenticate(request)
    """)


def _tmpl_health_view(ctx: dict) -> str:
    return dedent("""\
        from rest_framework import status
        from rest_framework.decorators import api_view, permission_classes
        from rest_framework.permissions import AllowAny
        from rest_framework.response import Response


        @api_view(["GET"])
        @permission_classes([AllowAny])
        def health_check(_request):
            return Response({"status": "ok"}, status=status.HTTP_200_OK)
    """)


def _tmpl_pyinstaller_spec(ctx: dict) -> str:
    hidden = ", ".join(f'"{app}"' for app in ctx["django_apps"])
    return dedent(f"""\
        # -*- mode: python ; coding: utf-8 -*-
        # PyInstaller spec for bundling the Django backend inside Tauri.
        # Run: pyinstaller pyinstaller.spec

        block_cipher = None

        a = Analysis(
            ["tauri_entry.py"],
            pathex=["."],
            binaries=[],
            datas=[],
            hiddenimports=[
                {hidden},
                "django.contrib.admin",
                "django.contrib.auth",
                "django.contrib.contenttypes",
                "django.contrib.sessions",
                "django.contrib.messages",
                "django.contrib.staticfiles",
                "rest_framework",
            ],
            hookspath=[],
            hooksconfig={{}},
            runtime_hooks=[],
            excludes=["pytest", "debug_toolbar", "django_extensions"],
            win_no_prefer_redirects=False,
            win_private_assemblies=False,
            cipher=block_cipher,
            noarchive=False,
        )

        pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

        exe = EXE(
            pyz,
            a.scripts,
            [],
            exclude_binaries=True,
            name="tauri_entry",
            debug=False,
            bootloader_ignore_signals=False,
            strip=False,
            upx=True,
            console=False,
        )

        coll = COLLECT(
            exe,
            a.binaries,
            a.zipfiles,
            a.datas,
            strip=False,
            upx=True,
            upx_exclude=[],
            name="python-backend",
        )
    """)


# ---------------------------------------------------------------------------
# React / TypeScript templates
# ---------------------------------------------------------------------------

def _tmpl_tauri_ts(ctx: dict) -> str:
    return dedent("""\
        /**
         * Tauri runtime detection and utilities.
         * All Tauri API imports are dynamic to maintain browser compatibility.
         */

        let tauriBackendPort: number = 8000;

        export function isTauriApp(): boolean {
            if (typeof window === "undefined") return false;
            return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
        }

        export function setTauriBackendPort(port: number): void {
            tauriBackendPort = port;
        }

        export function getTauriBackendPort(): number {
            return tauriBackendPort;
        }

        export async function openUrlInBrowser(url: string): Promise<void> {
            if (isTauriApp()) {
                const { open } = await import("@tauri-apps/plugin-opener");
                await open(url);
            } else {
                window.open(url, "_blank");
            }
        }

        export async function openFileWithDefaultApp(path: string): Promise<void> {
            if (isTauriApp()) {
                const { open } = await import("@tauri-apps/plugin-opener");
                await open(path);
            }
        }
    """)


def _tmpl_api_tauri_ts(ctx: dict) -> str:
    return dedent("""\
        /**
         * API client utilities for Tauri + Django integration.
         *
         * Provides dynamic base URL resolution, session token management,
         * and an axios interceptor for the Authorization: Session header.
         */
        import axios from "axios";
        import { isTauriApp, getTauriBackendPort } from "../utils/tauri";

        const SESSION_TOKEN_KEY = "session_token";

        // --- Base URL ---

        export function getBackendBaseUrl(): string {
            const envUrl = import.meta.env.VITE_API_BASE_URL;
            if (envUrl) return envUrl;

            if (isTauriApp()) {
                return `http://127.0.0.1:${getTauriBackendPort()}`;
            }

            const { protocol, hostname } = window.location;
            return `${protocol}//${hostname}:8000`;
        }

        export function getApiBaseUrl(): string {
            if (isTauriApp()) {
                return `${getBackendBaseUrl()}/api`;
            }
            return "/api";
        }

        // --- Axios client ---

        export const apiClient = axios.create({
            baseURL: getApiBaseUrl(),
            withCredentials: true,
            headers: { "Content-Type": "application/json" },
        });

        export function updateApiBaseUrl(port: number): void {
            apiClient.defaults.baseURL = isTauriApp()
                ? `http://127.0.0.1:${port}/api`
                : "/api";
        }

        // --- Session token (Tauri path) ---

        export function getSessionToken(): string | null {
            return localStorage.getItem(SESSION_TOKEN_KEY);
        }

        export function setSessionToken(token: string): void {
            localStorage.setItem(SESSION_TOKEN_KEY, token);
        }

        export function clearSessionToken(): void {
            localStorage.removeItem(SESSION_TOKEN_KEY);
        }

        apiClient.interceptors.request.use((config) => {
            const token = getSessionToken();
            if (token) {
                config.headers.Authorization = `Session ${token}`;
            }
            return config;
        });
    """)


def _tmpl_loading_screen(ctx: dict) -> str:
    return dedent("""\
        import { useCallback, useEffect, useRef, useState } from "react";
        import { isTauriApp, setTauriBackendPort } from "../utils/tauri";
        import { updateApiBaseUrl, getBackendBaseUrl } from "../services/api-tauri";

        interface LoadingScreenProps {
            onReady: () => void;
            maxRetries?: number;
            retryDelayMs?: number;
        }

        export default function LoadingScreen({
            onReady,
            maxRetries = 60,
            retryDelayMs = 500,
        }: LoadingScreenProps) {
            const [status, setStatus] = useState("Starting backend...");
            const [error, setError] = useState<string | null>(null);
            const hasCalledReady = useRef(false);

            const checkBackendHealth = useCallback(async (): Promise<boolean> => {
                try {
                    const baseUrl = getBackendBaseUrl();
                    const resp = await fetch(`${baseUrl}/api/health/`, {
                        signal: AbortSignal.timeout(2000),
                    });
                    return resp.ok;
                } catch {
                    return false;
                }
            }, []);

            // Tauri event listener (fast path)
            useEffect(() => {
                if (!isTauriApp()) {
                    onReady();
                    return;
                }

                let unlistenReady: (() => void) | undefined;
                let unlistenError: (() => void) | undefined;

                const setupListeners = async () => {
                    const { listen } = await import("@tauri-apps/api/event");

                    unlistenReady = await listen<{ port: number }>(
                        "backend-ready",
                        (event) => {
                            if (event.payload?.port) {
                                setTauriBackendPort(event.payload.port);
                                updateApiBaseUrl(event.payload.port);
                            }
                            if (!hasCalledReady.current) {
                                hasCalledReady.current = true;
                                onReady();
                            }
                        },
                    );

                    unlistenError = await listen<{ error: string }>(
                        "backend-error",
                        (event) => {
                            setError(event.payload?.error ?? "Backend failed to start");
                        },
                    );
                };

                void setupListeners();

                return () => {
                    unlistenReady?.();
                    unlistenError?.();
                };
            }, [onReady]);

            // Polling fallback
            useEffect(() => {
                if (!isTauriApp() || hasCalledReady.current) return;

                let cancelled = false;

                const poll = async () => {
                    await new Promise((r) => setTimeout(r, 2000));

                    for (let i = 0; i < maxRetries && !cancelled; i++) {
                        setStatus(`Waiting for backend... (${i + 1}/${maxRetries})`);
                        const ok = await checkBackendHealth();
                        if (ok && !hasCalledReady.current) {
                            hasCalledReady.current = true;
                            onReady();
                            return;
                        }
                        await new Promise((r) => setTimeout(r, retryDelayMs));
                    }

                    if (!cancelled && !hasCalledReady.current) {
                        setError("Backend did not start in time");
                    }
                };

                void poll();
                return () => {
                    cancelled = true;
                };
            }, [checkBackendHealth, maxRetries, retryDelayMs, onReady]);

            if (error) {
                return (
                    <div style={{ padding: 40, textAlign: "center" }}>
                        <h2>Failed to start</h2>
                        <p style={{ color: "#c33" }}>{error}</p>
                        <p>Try restarting the application.</p>
                    </div>
                );
            }

            return (
                <div style={{ padding: 40, textAlign: "center" }}>
                    <h2>Loading...</h2>
                    <p>{status}</p>
                </div>
            );
        }
    """)


# ---------------------------------------------------------------------------
# Build script templates
# ---------------------------------------------------------------------------

def _tmpl_build_backend_sh(ctx: dict) -> str:
    return dedent("""\
        #!/usr/bin/env bash
        set -euo pipefail

        SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
        PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
        BACKEND_DIR="$PROJECT_ROOT/backend"
        RESOURCES_DIR="$PROJECT_ROOT/frontend/src-tauri/resources/python-backend"

        echo "==> Building Python backend with PyInstaller..."
        cd "$BACKEND_DIR"
        pyinstaller pyinstaller.spec --noconfirm --clean

        echo "==> Copying backend to Tauri resources..."
        rm -rf "$RESOURCES_DIR"
        cp -r "$BACKEND_DIR/dist/python-backend" "$RESOURCES_DIR"

        echo "==> Backend build complete."
        echo "    Output: $RESOURCES_DIR"
    """)


def _tmpl_build_backend_ps1(ctx: dict) -> str:
    return dedent("""\
        $ErrorActionPreference = "Stop"

        $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
        $ProjectRoot = Split-Path -Parent $ScriptDir
        $BackendDir = Join-Path $ProjectRoot "backend"
        $ResourcesDir = Join-Path $ProjectRoot "frontend" "src-tauri" "resources" "python-backend"

        Write-Host "==> Building Python backend with PyInstaller..."
        Set-Location $BackendDir
        pyinstaller pyinstaller.spec --noconfirm --clean

        Write-Host "==> Copying backend to Tauri resources..."
        if (Test-Path $ResourcesDir) {
            Remove-Item -Recurse -Force $ResourcesDir
        }
        Copy-Item -Recurse (Join-Path $BackendDir "dist" "python-backend") $ResourcesDir

        Write-Host "==> Backend build complete."
        Write-Host "    Output: $ResourcesDir"
    """)


def _tmpl_start_sh(ctx: dict) -> str:
    return dedent("""\
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

        echo "Preparing backend..."
        (
          cd "$BACKEND_DIR"
          uv sync --all-groups
          uv run python manage.py migrate
          if uv run python manage.py help seed_demo >/dev/null 2>&1; then
            uv run python manage.py seed_demo
          fi
        )

        echo "Preparing frontend..."
        (
          cd "$FRONTEND_DIR"
          bun install
        )

        echo "Starting backend at $BACKEND_URL"
        (
          cd "$BACKEND_DIR"
          uv run python manage.py runserver "${BACKEND_HOST}:${BACKEND_PORT}"
        ) &
        backend_pid=$!

        echo "Starting frontend at $FRONTEND_URL"
        (
          cd "$FRONTEND_DIR"
          VITE_API_BASE_URL="${VITE_API_BASE_URL:-${BACKEND_URL}/api}" bun run dev
        ) &
        frontend_pid=$!

        echo
        echo "Application is starting:"
        echo "  Frontend: $FRONTEND_URL"
        echo "  Backend:  $BACKEND_URL/api"
        echo
        echo "Press Ctrl+C to stop both processes."

        wait -n "$backend_pid" "$frontend_pid"
    """)


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def parse_port_range(value: str) -> tuple[int, int]:
    parts = value.split("-")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(f"Expected PORT_START-PORT_END, got: {value}")
    try:
        start, end = int(parts[0]), int(parts[1])
    except ValueError:
        raise argparse.ArgumentTypeError(f"Ports must be integers: {value}")
    if start > end or start < 1 or end > 65535:
        raise argparse.ArgumentTypeError(f"Invalid port range: {value}")
    return start, end


def build_context(args: argparse.Namespace) -> dict:
    port_start, port_end = parse_port_range(args.port_range)
    django_apps = [a.strip() for a in args.django_apps.split(",") if a.strip()]
    return {
        "app_name": args.app_name,
        "app_id": args.app_id,
        "port_start": port_start,
        "port_end": port_end,
        "django_apps": django_apps,
        "settings_module": args.settings_module,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scaffold Tauri + Django + React integration files"
    )
    parser.add_argument(
        "--project-root", required=True, type=Path,
        help="Path to the project root directory",
    )
    parser.add_argument("--app-name", required=True, help="Human-readable app name")
    parser.add_argument(
        "--app-id", required=True,
        help="Reverse-domain app identifier (e.g. com.example.myapp)",
    )
    parser.add_argument(
        "--port-range", default="8000-8010",
        help="Backend port range as START-END (default: 8000-8010)",
    )
    parser.add_argument(
        "--django-apps", default="api",
        help="Comma-separated Django app names for PyInstaller hidden imports",
    )
    parser.add_argument(
        "--settings-module", default="config.settings.base",
        help="Django settings module path (default: config.settings.base)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Show what would be created without writing files",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Overwrite existing files",
    )
    args = parser.parse_args()

    project_root = args.project_root.resolve()
    if not project_root.is_dir():
        print(f"Error: project root does not exist: {project_root}", file=sys.stderr)
        return 2

    ctx = build_context(args)
    templates = get_templates(ctx)

    created = []
    skipped = []
    would_create = []

    for rel_path, content in templates:
        target = project_root / rel_path

        if args.dry_run:
            marker = "exists" if target.exists() else "new"
            would_create.append((rel_path, marker))
            continue

        if target.exists() and not args.force:
            skipped.append(rel_path)
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

        if rel_path.endswith(".sh"):
            target.chmod(target.stat().st_mode | 0o755)

        created.append(rel_path)

    # Report
    if args.dry_run:
        print(f"\nDry run: {len(would_create)} files would be processed\n")
        for path, marker in would_create:
            print(f"  [{marker:>6}]  {path}")
        print()
        return 0

    if created:
        print(f"\nCreated {len(created)} files:\n")
        for path in created:
            print(f"  + {path}")

    if skipped:
        print(f"\nSkipped {len(skipped)} existing files (use --force to overwrite):\n")
        for path in skipped:
            print(f"  ~ {path}")

    print("\n--- Next steps ---")
    print("1. Install frontend Tauri dependencies:")
    print("     cd frontend && bun add @tauri-apps/api @tauri-apps/plugin-opener \\")
    print("       @tauri-apps/plugin-fs @tauri-apps/plugin-shell @tauri-apps/plugin-process \\")
    print("       @tauri-apps/plugin-notification @tauri-apps/plugin-http @tauri-apps/plugin-updater")
    print("2. Install backend dependencies:")
    print("     pip install django djangorestframework django-cors-headers pyinstaller")
    print("3. Add health URL to your Django urls.py:")
    print('     path("api/health/", health_check, name="health")')
    print("4. Add HybridSessionAuthentication to DRF settings:")
    print('     DEFAULT_AUTHENTICATION_CLASSES: ["api.authentication.HybridSessionAuthentication"]')
    print("5. Add CORS/CSRF settings for Tauri origins (see SKILL.md)")
    print("6. Use ./start.sh for local Django + React development")
    print("7. Run the validation script to check your setup:")
    print("     python3 validate.py --project-root .")
    print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
