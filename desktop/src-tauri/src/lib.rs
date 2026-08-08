use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command as StdCommand, Stdio},
    str,
    sync::{
        atomic::{AtomicU32, AtomicU8, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Emitter;
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const SERVER_STARTUP_LOG_LIMIT: usize = 80;
const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_SHOW_ID: &str = "tray_show";
const TRAY_QUIT_ID: &str = "tray_quit";
const CYBER_CONFIG_DIR_ENV: &str = "CYBER_CONFIG_DIR";
const LEGACY_CLAUDE_CONFIG_DIR_ENV: &str = "CLAUDE_CONFIG_DIR";
const CYBER_PORTABLE_ROOT_ENV: &str = "CYBER_PORTABLE_ROOT";
const CYBERCODE_DESKTOP_PARENT_PID_ENV: &str = "CYBERCODE_DESKTOP_PARENT_PID";
const CYBER_PORTABLE_MARKER: &str = ".cybercode-portable";
const IMAGE_PREVIEW_MAX_BYTES: u64 = 10 * 1024 * 1024;
const SCREENSHOT_FILE_PREFIX: &str = "cybercode-screenshot-";
const SCREENSHOT_SOURCE_FILE_PREFIX: &str = "cybercode-screenshot-source-";
const SCREENSHOT_OVERLAY_LABEL: &str = "screenshot-overlay";
const SCREENSHOT_SOURCE_MAX_BYTES: u64 = 64 * 1024 * 1024;
const SCREENSHOT_RESULT_MAX_BYTES: usize = 32 * 1024 * 1024;
const SCREENSHOT_SELECTION_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const SERVER_STARTUP_WAIT_TIMEOUT: Duration = Duration::from_secs(60);
const SERVER_CONNECTION_WAIT_TIMEOUT: Duration = Duration::from_secs(65);
const SERVER_HEALTHCHECK_REQUEST_TIMEOUT: Duration = Duration::from_secs(1);
const SERVER_SHUTDOWN_REQUEST_TIMEOUT: Duration = Duration::from_millis(500);
const SERVER_GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(3500);
const SERVER_GRACEFUL_SHUTDOWN_POLL_INTERVAL: Duration = Duration::from_millis(25);
#[cfg(target_os = "macos")]
const COMPUTER_USE_HELPER_APP_NAME: &str = "CyberCode Computer Use.app";
#[cfg(target_os = "macos")]
const COMPUTER_USE_HELPER_EXECUTABLE_NAME: &str = "CyberCodeComputerUse";
#[cfg(target_os = "linux")]
const COMPUTER_USE_HELPER_EXECUTABLE_NAME: &str = "cybercode-computer-use";
static SCREENSHOT_SEQUENCE: AtomicU32 = AtomicU32::new(0);
const AGENT_BROWSER_DOCTOR_TIMEOUT: Duration = Duration::from_secs(60);
const AGENT_BROWSER_INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const AGENT_BROWSER_PREPARE_IDLE: u8 = 0;
const AGENT_BROWSER_PREPARE_RUNNING: u8 = 1;
const AGENT_BROWSER_PREPARE_READY: u8 = 2;
// IDLE -> RUNNING -> READY；失败回到 IDLE，下次调用可重试（旧实现用
// AtomicBool 一次性置位，失败后永远不会再尝试）。
static AGENT_BROWSER_PREPARE_STATE: AtomicU8 = AtomicU8::new(AGENT_BROWSER_PREPARE_IDLE);
// 环形缓冲记录 doctor/install 的输出与失败原因，Release 下也有处可查。
static AGENT_BROWSER_PREPARE_LOGS: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

#[derive(Default)]
struct ServerState(Arc<Mutex<ServerStatus>>);

struct ServerRuntime {
    url: String,
    auth_token: String,
    child: CommandChild,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ServerConnection {
    url: String,
    auth_token: String,
}

#[derive(Default)]
struct ServerStatus {
    runtime: Option<ServerRuntime>,
    startup_error: Option<String>,
    restart_in_progress: bool,
}

#[derive(Default)]
struct AppExitState {
    is_quitting: Mutex<bool>,
}

#[derive(Default)]
struct ScreenshotCaptureSession {
    active: bool,
    source_path: Option<PathBuf>,
    result: Option<Result<Option<String>, String>>,
}

#[derive(Default)]
struct ScreenshotCaptureState(Arc<(Mutex<ScreenshotCaptureSession>, Condvar)>);

/// 与 ServerState 平级的 adapter 子进程状态。
///
/// adapter sidecar（cybercode-sidecar adapters + platform flags）的生命周期
/// 跟 server 不同：它没有 HTTP 端口可探活，没配凭据时会自己干净退出，
/// 而且需要支持运行时热重启 —— 用户在设置页保存 IM 凭据后，
/// 前端会通过 invoke('restart_adapters_sidecar') 来重启它，让新凭据生效。
#[derive(Default)]
struct AdapterState(Mutex<Option<CommandChild>>);

#[derive(Default)]
struct TerminalState {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, TerminalSession>>,
}

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

#[derive(Serialize, Clone)]
struct TerminalSpawnResult {
    session_id: u32,
    shell: String,
    cwd: String,
}

#[derive(Serialize, Clone)]
struct TerminalOutputPayload {
    session_id: u32,
    data: String,
}

#[derive(Serialize, Clone)]
struct TerminalExitPayload {
    session_id: u32,
    code: u32,
    signal: Option<String>,
}

#[tauri::command]
fn get_server_url(state: State<'_, ServerState>) -> Result<String, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "desktop server state is unavailable".to_string())?;

    if let Some(runtime) = guard.runtime.as_ref() {
        return Ok(runtime.url.clone());
    }

    Err(guard
        .startup_error
        .clone()
        .unwrap_or_else(|| "desktop server did not start".to_string()))
}

#[tauri::command]
async fn get_server_connection(state: State<'_, ServerState>) -> Result<ServerConnection, String> {
    let status = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || wait_for_server_connection(status))
        .await
        .map_err(|err| format!("desktop server startup task failed: {err}"))?
}

fn wait_for_server_connection(
    status: Arc<Mutex<ServerStatus>>,
) -> Result<ServerConnection, String> {
    let deadline = Instant::now() + SERVER_CONNECTION_WAIT_TIMEOUT;

    loop {
        {
            let guard = status
                .lock()
                .map_err(|_| "desktop server state is unavailable".to_string())?;
            if let Some(runtime) = guard.runtime.as_ref() {
                return Ok(ServerConnection {
                    url: runtime.url.clone(),
                    auth_token: runtime.auth_token.clone(),
                });
            }
            if let Some(error) = guard.startup_error.as_ref() {
                return Err(error.clone());
            }
        }

        if Instant::now() >= deadline {
            return Err(format!(
                "desktop server did not become ready within {} seconds",
                SERVER_CONNECTION_WAIT_TIMEOUT.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

/// 前端在设置页保存 IM 凭据后调用，触发 adapter sidecar 热重启。
///
/// 流程：
///   1. kill 当前 adapter 子进程（如果在跑）
///   2. spawn 新的 adapter 子进程
///   3. 新 sidecar 内部的 loadConfig() 会读到最新的 ~/.cyber/adapters.json
///      并重新建立各平台的长连接或长轮询
///
/// 凭据缺失时 sidecar 自己会 warn + skip + 退出，所以这里不需要前置检查。
#[tauri::command]
fn restart_adapters_sidecar(app: AppHandle) -> Result<(), String> {
    stop_adapters_sidecar(&app);
    spawn_and_track_adapters_sidecar(&app);
    Ok(())
}

#[tauri::command]
async fn restart_server_sidecar(
    app: AppHandle,
    expected_url: String,
) -> Result<ServerConnection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(state) = app.try_state::<ServerState>() else {
            return Err("desktop server state is unavailable".to_string());
        };
        let status = Arc::clone(&state.0);
        let (should_restart, runtime) = {
            let mut guard = status
                .lock()
                .map_err(|_| "desktop server state is unavailable".to_string())?;
            if guard.restart_in_progress {
                (false, None)
            } else if let Some(runtime) = guard.runtime.as_ref() {
                if runtime.url != expected_url {
                    return Ok(ServerConnection {
                        url: runtime.url.clone(),
                        auth_token: runtime.auth_token.clone(),
                    });
                }
                if server_url_is_healthy(&runtime.url) {
                    return Ok(ServerConnection {
                        url: runtime.url.clone(),
                        auth_token: runtime.auth_token.clone(),
                    });
                }
                guard.restart_in_progress = true;
                guard.startup_error = None;
                (true, guard.runtime.take())
            } else {
                guard.restart_in_progress = true;
                guard.startup_error = None;
                (true, None)
            }
        };

        if !should_restart {
            return wait_for_server_connection(status);
        }

        stop_adapters_sidecar(&app);
        if let Some(runtime) = runtime {
            stop_server_runtime(runtime);
        }

        match start_server_sidecar(&app) {
            Ok(runtime) => {
                let connection = ServerConnection {
                    url: runtime.url.clone(),
                    auth_token: runtime.auth_token.clone(),
                };
                let Some(state) = app.try_state::<ServerState>() else {
                    stop_server_runtime(runtime);
                    return Err("desktop server state is unavailable".to_string());
                };
                let Ok(mut guard) = state.0.lock() else {
                    stop_server_runtime(runtime);
                    return Err("desktop server state is unavailable".to_string());
                };
                guard.runtime = Some(runtime);
                guard.startup_error = None;
                guard.restart_in_progress = false;
                drop(guard);

                spawn_and_track_adapters_sidecar(&app);
                Ok(connection)
            }
            Err(error) => {
                if let Some(state) = app.try_state::<ServerState>() {
                    if let Ok(mut guard) = state.0.lock() {
                        guard.runtime = None;
                        guard.startup_error = Some(error.clone());
                        guard.restart_in_progress = false;
                    }
                }
                Err(error)
            }
        }
    })
    .await
    .map_err(|error| format!("desktop server restart task failed: {error}"))?
}

#[tauri::command]
fn prepare_for_update_install(app: AppHandle) -> Result<(), String> {
    mark_app_quitting(&app);
    stop_server_sidecar(&app);
    stop_adapters_sidecar(&app);

    #[cfg(target_os = "windows")]
    {
        kill_windows_sidecars();
    }

    // Give Windows a short moment to release executable file handles before the
    // updater starts replacing bundled sidecars in the install directory.
    std::thread::sleep(Duration::from_millis(750));
    Ok(())
}

fn claude_config_home_dir() -> Result<PathBuf, String> {
    for key in [CYBER_CONFIG_DIR_ENV, LEGACY_CLAUDE_CONFIG_DIR_ENV] {
        if let Ok(path) = std::env::var(key) {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                return Ok(PathBuf::from(trimmed));
            }
        }
    }

    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "home directory is unavailable".to_string())?;

    Ok(PathBuf::from(home).join(".cyber"))
}

fn portable_root_from_executable(executable: &Path) -> Option<PathBuf> {
    let start = if executable.is_dir() {
        executable
    } else {
        executable.parent()?
    };

    start.ancestors().find_map(|candidate| {
        let marker = candidate.join(CYBER_PORTABLE_MARKER);
        if marker.is_file() {
            Some(
                candidate
                    .canonicalize()
                    .unwrap_or_else(|_| candidate.to_path_buf()),
            )
        } else {
            None
        }
    })
}

fn configure_portable_environment() {
    let configured_root = std::env::var_os(CYBER_PORTABLE_ROOT_ENV)
        .map(PathBuf::from)
        .filter(|root| root.join(CYBER_PORTABLE_MARKER).is_file())
        .map(|root| root.canonicalize().unwrap_or(root));
    let portable_root = configured_root.or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|executable| portable_root_from_executable(&executable))
    });
    let Some(portable_root) = portable_root else {
        return;
    };

    let config_dir = portable_root.join("data").join("config");
    if let Err(error) = std::fs::create_dir_all(&config_dir) {
        eprintln!(
            "[desktop] could not prepare portable config directory {}: {error}",
            config_dir.display()
        );
        return;
    }
    std::env::set_var(CYBER_PORTABLE_ROOT_ENV, &portable_root);
    std::env::set_var(CYBER_CONFIG_DIR_ENV, &config_dir);
    std::env::set_var(LEGACY_CLAUDE_CONFIG_DIR_ENV, &config_dir);
    eprintln!(
        "[desktop] portable runtime detected at {}",
        portable_root.display()
    );
}

#[cfg(target_os = "macos")]
fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::create_dir_all(destination)
        .map_err(|error| format!("create helper directory: {error}"))?;
    for entry in
        std::fs::read_dir(source).map_err(|error| format!("read helper directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("read helper entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("inspect helper entry: {error}"))?;
        if file_type.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            std::fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("copy helper file: {error}"))?;
        } else {
            return Err(format!(
                "unsupported helper bundle entry: {}",
                source_path.display()
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn helper_executable_path(app_bundle: &Path) -> PathBuf {
    app_bundle
        .join("Contents")
        .join("MacOS")
        .join(COMPUTER_USE_HELPER_EXECUTABLE_NAME)
}

#[cfg(target_os = "macos")]
fn install_computer_use_helper(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let source_root = app
        .path()
        .resource_dir()
        .map_err(|error| format!("resolve Computer Use resources: {error}"))?
        .join("resources")
        .join("computer-use");
    let source_app = source_root.join(COMPUTER_USE_HELPER_APP_NAME);
    if !helper_executable_path(&source_app).is_file() {
        return Ok(None);
    }

    let destination_root = claude_config_home_dir()?.join("computer-use");
    let destination_app = destination_root.join(COMPUTER_USE_HELPER_APP_NAME);
    let source_manifest = source_root.join("manifest.json");
    let destination_manifest = destination_root.join("manifest.json");
    let current_manifest_matches = std::fs::read(&source_manifest)
        .ok()
        .zip(std::fs::read(&destination_manifest).ok())
        .map(|(source, destination)| source == destination)
        .unwrap_or(false);
    if current_manifest_matches && helper_executable_path(&destination_app).is_file() {
        return Ok(Some(helper_executable_path(&destination_app)));
    }

    std::fs::create_dir_all(&destination_root)
        .map_err(|error| format!("create Computer Use helper state: {error}"))?;
    let staging_app = destination_root.join(format!(
        ".computer-use-helper-preparing-{}",
        std::process::id()
    ));
    let backup_app = destination_root.join(format!(
        ".computer-use-helper-backup-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&staging_app);
    let _ = std::fs::remove_dir_all(&backup_app);
    copy_directory(&source_app, &staging_app)?;

    if destination_app.exists() {
        std::fs::rename(&destination_app, &backup_app)
            .map_err(|error| format!("stage existing Computer Use helper: {error}"))?;
    }
    if let Err(error) = std::fs::rename(&staging_app, &destination_app) {
        if backup_app.exists() && !destination_app.exists() {
            let _ = std::fs::rename(&backup_app, &destination_app);
        }
        return Err(format!("activate Computer Use helper: {error}"));
    }
    let _ = std::fs::remove_dir_all(&backup_app);
    if source_manifest.is_file() {
        std::fs::copy(&source_manifest, &destination_manifest)
            .map_err(|error| format!("record Computer Use helper version: {error}"))?;
    }

    Ok(Some(helper_executable_path(&destination_app)))
}

#[cfg(target_os = "linux")]
fn install_computer_use_helper(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    use std::os::unix::fs::PermissionsExt;

    let source_root = app
        .path()
        .resource_dir()
        .map_err(|error| format!("resolve Computer Use resources: {error}"))?
        .join("resources")
        .join("computer-use");
    let source_helper = source_root.join(COMPUTER_USE_HELPER_EXECUTABLE_NAME);
    if !source_helper.is_file() {
        return Ok(None);
    }

    let destination_root = claude_config_home_dir()?.join("computer-use");
    let destination_helper = destination_root.join(COMPUTER_USE_HELPER_EXECUTABLE_NAME);
    let source_manifest = source_root.join("manifest.json");
    let destination_manifest = destination_root.join("manifest.json");
    let current_manifest_matches = std::fs::read(&source_manifest)
        .ok()
        .zip(std::fs::read(&destination_manifest).ok())
        .map(|(source, destination)| source == destination)
        .unwrap_or(false);
    if current_manifest_matches && destination_helper.is_file() {
        return Ok(Some(destination_helper));
    }

    std::fs::create_dir_all(&destination_root)
        .map_err(|error| format!("create Computer Use helper state: {error}"))?;
    let staging_helper = destination_root.join(format!(
        ".computer-use-helper-preparing-{}",
        std::process::id()
    ));
    let backup_helper = destination_root.join(format!(
        ".computer-use-helper-backup-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&staging_helper);
    let _ = std::fs::remove_file(&backup_helper);
    std::fs::copy(&source_helper, &staging_helper)
        .map_err(|error| format!("copy Computer Use helper: {error}"))?;
    std::fs::set_permissions(&staging_helper, std::fs::Permissions::from_mode(0o755))
        .map_err(|error| format!("make Computer Use helper executable: {error}"))?;

    if destination_helper.exists() {
        std::fs::rename(&destination_helper, &backup_helper)
            .map_err(|error| format!("stage existing Computer Use helper: {error}"))?;
    }
    if let Err(error) = std::fs::rename(&staging_helper, &destination_helper) {
        if backup_helper.exists() && !destination_helper.exists() {
            let _ = std::fs::rename(&backup_helper, &destination_helper);
        }
        return Err(format!("activate Computer Use helper: {error}"));
    }
    let _ = std::fs::remove_file(&backup_helper);
    if source_manifest.is_file() {
        std::fs::copy(&source_manifest, &destination_manifest)
            .map_err(|error| format!("record Computer Use helper version: {error}"))?;
    }

    Ok(Some(destination_helper))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn install_computer_use_helper(_app: &AppHandle) -> Result<Option<PathBuf>, String> {
    Ok(None)
}

#[tauri::command]
fn open_skills_config_dir() -> Result<(), String> {
    let skills_dir = claude_config_home_dir()?.join("skills");
    std::fs::create_dir_all(&skills_dir)
        .map_err(|err| format!("create skills directory: {err}"))?;

    #[cfg(target_os = "macos")]
    let mut command = StdCommand::new("open");
    #[cfg(target_os = "windows")]
    let mut command = StdCommand::new("explorer.exe");
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = StdCommand::new("xdg-open");

    command
        .arg(&skills_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("open skills directory: {err}"))
}

fn image_mime_type_for_path(path: &Path, requested_mime_type: Option<&str>) -> Option<String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())?;

    let inferred = match extension.as_str() {
        "apng" => "image/apng",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "ico" => "image/x-icon",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => return None,
    };

    let requested = requested_mime_type
        .map(str::trim)
        .filter(|value| value.starts_with("image/"))
        .unwrap_or(inferred);

    Some(requested.to_string())
}

#[tauri::command]
fn read_image_preview_data_url(path: String, mime_type: Option<String>) -> Result<String, String> {
    let file_path = PathBuf::from(path);
    let mime = image_mime_type_for_path(&file_path, mime_type.as_deref())
        .ok_or_else(|| "unsupported image type".to_string())?;

    let metadata =
        std::fs::metadata(&file_path).map_err(|err| format!("read image metadata: {err}"))?;
    if !metadata.is_file() {
        return Err("selected image path is not a file".to_string());
    }
    if metadata.len() > IMAGE_PREVIEW_MAX_BYTES {
        return Err(format!(
            "selected image is larger than {} MB",
            IMAGE_PREVIEW_MAX_BYTES / 1024 / 1024
        ));
    }

    let bytes = std::fs::read(&file_path).map_err(|err| format!("read image file: {err}"))?;
    Ok(format!(
        "data:{mime};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

fn screenshot_path(prefix: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    std::env::temp_dir().join(format!(
        "{prefix}{}-{timestamp}-{}.png",
        std::process::id(),
        SCREENSHOT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ))
}

fn screenshot_temp_path() -> PathBuf {
    screenshot_path(SCREENSHOT_FILE_PREFIX)
}

fn screenshot_source_temp_path() -> PathBuf {
    screenshot_path(SCREENSHOT_SOURCE_FILE_PREFIX)
}

fn completed_screenshot_path(path: &Path) -> Result<Option<String>, String> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() && metadata.len() > 0 => {
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        Ok(_) => {
            let _ = std::fs::remove_file(path);
            Ok(None)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("inspect screenshot file: {error}")),
    }
}

fn capture_source_command_result(
    path: &Path,
    output: std::process::Output,
    tool_name: &str,
) -> Result<PathBuf, String> {
    if let Some(captured_path) = completed_screenshot_path(path)? {
        return Ok(PathBuf::from(captured_path));
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("exit status {}", output.status)
    };
    Err(format!("{tool_name} failed: {detail}"))
}

#[derive(Clone, Copy)]
struct CaptureDisplay {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[cfg(target_os = "macos")]
fn ensure_screen_capture_permission() -> Result<(), String> {
    // SAFETY: These parameterless Core Graphics APIs are available on every
    // macOS version supported by the Tauri desktop build.
    unsafe {
        if CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() {
            return Ok(());
        }
    }
    Err("SCREEN_CAPTURE_PERMISSION_REQUIRED".to_string())
}

#[cfg(not(target_os = "macos"))]
fn ensure_screen_capture_permission() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn capture_screen_source_blocking(
    display: CaptureDisplay,
    computer_use_helper: Option<PathBuf>,
) -> Result<PathBuf, String> {
    let path = screenshot_source_temp_path();
    let scale_factor = display.scale_factor.max(1.0);
    let x = f64::from(display.x) / scale_factor;
    let y = f64::from(display.y) / scale_factor;
    let width = (f64::from(display.width) / scale_factor).max(1.0);
    let height = (f64::from(display.height) / scale_factor).max(1.0);

    if let Some(helper) = computer_use_helper {
        let payload = serde_json::json!({
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "outputPath": path.to_string_lossy(),
        })
        .to_string();
        let output = StdCommand::new(&helper)
            .args(["capture_png_to_file", "--payload", &payload])
            .output()
            .map_err(|error| format!("launch CyberCode Computer Use helper: {error}"))?;
        return capture_source_command_result(&path, output, "CyberCode Computer Use helper");
    }

    let rect = format!(
        "{},{},{},{}",
        x.round() as i32,
        y.round() as i32,
        width.round() as u32,
        height.round() as u32
    );
    let output = StdCommand::new("/usr/sbin/screencapture")
        .args(["-x", "-t", "png"])
        .arg(format!("-R{rect}"))
        .arg(&path)
        .output()
        .map_err(|error| format!("launch macOS screen capture: {error}"))?;

    capture_source_command_result(&path, output, "macOS screen capture")
}

#[cfg(target_os = "windows")]
fn capture_screen_source_blocking(
    display: CaptureDisplay,
    _computer_use_helper: Option<PathBuf>,
) -> Result<PathBuf, String> {
    const SCRIPT: &str = r#"
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CyberCodeCaptureDpi {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
'@
try { [void][CyberCodeCaptureDpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {}
$width = [int]$env:CYBERCODE_SCREENSHOT_WIDTH
$height = [int]$env:CYBERCODE_SCREENSHOT_HEIGHT
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.CopyFromScreen(
        [int]$env:CYBERCODE_SCREENSHOT_X,
        [int]$env:CYBERCODE_SCREENSHOT_Y,
        0,
        0,
        $bitmap.Size,
        [System.Drawing.CopyPixelOperation]::SourceCopy
    )
    $bitmap.Save($env:CYBERCODE_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
"#;

    let path = screenshot_source_temp_path();
    let output = StdCommand::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            SCRIPT,
        ])
        .env("CYBERCODE_SCREENSHOT_PATH", &path)
        .env("CYBERCODE_SCREENSHOT_X", display.x.to_string())
        .env("CYBERCODE_SCREENSHOT_Y", display.y.to_string())
        .env("CYBERCODE_SCREENSHOT_WIDTH", display.width.to_string())
        .env("CYBERCODE_SCREENSHOT_HEIGHT", display.height.to_string())
        .output()
        .map_err(|error| format!("capture the Windows display: {error}"))?;

    capture_source_command_result(&path, output, "Windows display capture")
}

#[cfg(target_os = "linux")]
fn linux_command_available(command: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|path| path.join(command).is_file()))
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn capture_screen_source_blocking(
    display: CaptureDisplay,
    computer_use_helper: Option<PathBuf>,
) -> Result<PathBuf, String> {
    let path = screenshot_source_temp_path();

    if let Some(helper) = computer_use_helper {
        let payload = serde_json::json!({
            "x": display.x,
            "y": display.y,
            "width": display.width,
            "height": display.height,
            "outputPath": path.to_string_lossy(),
        })
        .to_string();
        let output = StdCommand::new(&helper)
            .args(["capture_png_to_file", "--payload", &payload])
            .output()
            .map_err(|error| format!("launch CyberCode Computer Use helper: {error}"))?;
        match capture_source_command_result(&path, output, "CyberCode Computer Use helper") {
            Ok(captured) => return Ok(captured),
            Err(error)
                if error.contains("portal_unavailable")
                    || error.contains("capture_backend_unavailable") =>
            {
                eprintln!("[computer-use] native Linux capture unavailable: {error}");
            }
            Err(error) => return Err(error),
        }
    }

    if linux_command_available("grim") {
        let geometry = format!(
            "{},{} {}x{}",
            display.x, display.y, display.width, display.height
        );
        let output = StdCommand::new("grim")
            .args(["-g", &geometry])
            .arg(&path)
            .output()
            .map_err(|error| format!("launch grim: {error}"))?;
        return capture_source_command_result(&path, output, "grim");
    }

    if linux_command_available("gnome-screenshot") {
        let output = StdCommand::new("gnome-screenshot")
            .arg("-f")
            .arg(&path)
            .output()
            .map_err(|error| format!("launch GNOME Screenshot: {error}"))?;
        return capture_source_command_result(&path, output, "GNOME Screenshot");
    }

    if linux_command_available("spectacle") {
        let output = StdCommand::new("spectacle")
            .args(["--current", "--background", "--nonotify", "--output"])
            .arg(&path)
            .output()
            .map_err(|error| format!("launch Spectacle: {error}"))?;
        return capture_source_command_result(&path, output, "Spectacle");
    }

    if linux_command_available("scrot") {
        let output = StdCommand::new("scrot")
            .arg(&path)
            .output()
            .map_err(|error| format!("launch scrot: {error}"))?;
        return capture_source_command_result(&path, output, "scrot");
    }

    Err("no supported Linux screenshot tool was found (grim, gnome-screenshot, Spectacle, or scrot)".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn capture_screen_source_blocking(
    _display: CaptureDisplay,
    _computer_use_helper: Option<PathBuf>,
) -> Result<PathBuf, String> {
    Err("region screenshots are not supported on this platform".to_string())
}

fn begin_screen_capture(state: &ScreenshotCaptureState) -> Result<(), String> {
    let (lock, _) = &*state.0;
    let mut session = lock
        .lock()
        .map_err(|_| "screen capture state is unavailable".to_string())?;
    if session.active {
        return Err("a screen capture is already active".to_string());
    }
    session.active = true;
    session.source_path = None;
    session.result = None;
    Ok(())
}

fn set_screen_capture_source(
    state: &ScreenshotCaptureState,
    source_path: PathBuf,
) -> Result<(), String> {
    let (lock, _) = &*state.0;
    let mut session = lock
        .lock()
        .map_err(|_| "screen capture state is unavailable".to_string())?;
    if !session.active {
        return Err("screen capture is no longer active".to_string());
    }
    session.source_path = Some(source_path);
    Ok(())
}

fn resolve_screen_capture(
    state: &ScreenshotCaptureState,
    result: Result<Option<String>, String>,
) -> Result<(), String> {
    let (lock, condition) = &*state.0;
    let mut session = lock
        .lock()
        .map_err(|_| "screen capture state is unavailable".to_string())?;
    if !session.active {
        return Err("screen capture is no longer active".to_string());
    }
    if session.result.is_none() {
        session.result = Some(result);
        condition.notify_all();
    }
    Ok(())
}

fn wait_for_screen_capture_result(
    capture: Arc<(Mutex<ScreenshotCaptureSession>, Condvar)>,
) -> Result<Option<String>, String> {
    let (lock, condition) = &*capture;
    let mut session = lock
        .lock()
        .map_err(|_| "screen capture state is unavailable".to_string())?;
    let deadline = Instant::now() + SCREENSHOT_SELECTION_TIMEOUT;

    loop {
        if let Some(result) = session.result.take() {
            return result;
        }

        let now = Instant::now();
        if now >= deadline {
            return Ok(None);
        }
        let (next_session, timeout) = condition
            .wait_timeout(session, deadline.saturating_duration_since(now))
            .map_err(|_| "screen capture state is unavailable".to_string())?;
        session = next_session;
        if timeout.timed_out() && session.result.is_none() {
            return Ok(None);
        }
    }
}

fn clear_screen_capture(state: &ScreenshotCaptureState) -> Option<PathBuf> {
    let (lock, _) = &*state.0;
    let Ok(mut session) = lock.lock() else {
        return None;
    };
    session.active = false;
    session.result = None;
    session.source_path.take()
}

fn create_screenshot_overlay(app: &AppHandle, display: CaptureDisplay) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(SCREENSHOT_OVERLAY_LABEL) {
        let _ = existing.close();
    }

    let scale_factor = display.scale_factor.max(1.0);
    let overlay = tauri::WebviewWindowBuilder::new(
        app,
        SCREENSHOT_OVERLAY_LABEL,
        tauri::WebviewUrl::App("index.html?window=screenshot".into()),
    )
    .title("CyberCode Screenshot")
    .visible(false)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .shadow(false)
    .position(
        f64::from(display.x) / scale_factor,
        f64::from(display.y) / scale_factor,
    )
    .inner_size(
        f64::from(display.width) / scale_factor,
        f64::from(display.height) / scale_factor,
    )
    .build()
    .map_err(|error| format!("create screen capture overlay: {error}"))?;

    overlay
        .set_position(tauri::PhysicalPosition::new(display.x, display.y))
        .map_err(|error| format!("position screen capture overlay: {error}"))?;
    overlay
        .set_size(tauri::PhysicalSize::new(display.width, display.height))
        .map_err(|error| format!("size screen capture overlay: {error}"))?;
    overlay
        .show()
        .map_err(|error| format!("show screen capture overlay: {error}"))?;
    overlay
        .set_focus()
        .map_err(|error| format!("focus screen capture overlay: {error}"))?;
    Ok(())
}

fn decode_screenshot_png_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let encoded = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "screen capture result is not a PNG data URL".to_string())?;
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("decode screen capture result: {error}"))?;
    if bytes.len() > SCREENSHOT_RESULT_MAX_BYTES {
        return Err(format!(
            "screen capture result is larger than {} MB",
            SCREENSHOT_RESULT_MAX_BYTES / 1024 / 1024
        ));
    }
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("screen capture result has an invalid PNG signature".to_string());
    }
    Ok(bytes)
}

#[tauri::command]
fn read_screen_capture_source(state: State<'_, ScreenshotCaptureState>) -> Result<String, String> {
    let source_path = {
        let (lock, _) = &*state.0;
        let session = lock
            .lock()
            .map_err(|_| "screen capture state is unavailable".to_string())?;
        if !session.active {
            return Err("screen capture is no longer active".to_string());
        }
        session
            .source_path
            .clone()
            .ok_or_else(|| "screen capture source is not ready".to_string())?
    };

    let metadata = std::fs::metadata(&source_path)
        .map_err(|error| format!("read screen capture metadata: {error}"))?;
    if metadata.len() > SCREENSHOT_SOURCE_MAX_BYTES {
        return Err(format!(
            "screen capture source is larger than {} MB",
            SCREENSHOT_SOURCE_MAX_BYTES / 1024 / 1024
        ));
    }
    let bytes = std::fs::read(&source_path)
        .map_err(|error| format!("read screen capture source: {error}"))?;
    Ok(format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
fn complete_screen_capture(
    state: State<'_, ScreenshotCaptureState>,
    png_data_url: String,
) -> Result<(), String> {
    let bytes = decode_screenshot_png_data_url(&png_data_url)?;
    let path = screenshot_temp_path();
    std::fs::write(&path, bytes).map_err(|error| format!("save screen capture: {error}"))?;
    let result_path = path.to_string_lossy().into_owned();
    if let Err(error) = resolve_screen_capture(&state, Ok(Some(result_path))) {
        let _ = std::fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
fn cancel_screen_capture(state: State<'_, ScreenshotCaptureState>) -> Result<(), String> {
    resolve_screen_capture(&state, Ok(None))
}

#[tauri::command]
async fn capture_screen_region(
    app: AppHandle,
    state: State<'_, ScreenshotCaptureState>,
) -> Result<Option<String>, String> {
    let main_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "main window is unavailable".to_string())?;
    let monitor = main_window
        .current_monitor()
        .map_err(|error| format!("read current display: {error}"))?
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "no display is available for screen capture".to_string())?;
    let display = CaptureDisplay {
        x: monitor.position().x,
        y: monitor.position().y,
        width: monitor.size().width,
        height: monitor.size().height,
        scale_factor: monitor.scale_factor(),
    };
    begin_screen_capture(&state)?;

    let operation = async {
        let computer_use_helper = match install_computer_use_helper(&app) {
            Ok(helper) => helper,
            Err(error) => {
                eprintln!("[computer-use] helper installation failed: {error}");
                None
            }
        };
        if computer_use_helper.is_none() {
            ensure_screen_capture_permission()?;
        }
        main_window
            .hide()
            .map_err(|error| format!("hide CyberCode before screen capture: {error}"))?;

        let source_path = tauri::async_runtime::spawn_blocking(move || {
            thread::sleep(Duration::from_millis(140));
            capture_screen_source_blocking(display, computer_use_helper)
        })
        .await
        .map_err(|error| format!("screen capture task failed: {error}"))??;
        set_screen_capture_source(&state, source_path)?;
        create_screenshot_overlay(&app, display)?;

        tauri::async_runtime::spawn_blocking({
            let capture = state.0.clone();
            move || wait_for_screen_capture_result(capture)
        })
        .await
        .map_err(|error| format!("screen selection task failed: {error}"))?
    }
    .await;

    if let Some(overlay) = app.get_webview_window(SCREENSHOT_OVERLAY_LABEL) {
        let _ = overlay.close();
    }
    if let Some(source_path) = clear_screen_capture(&state) {
        let _ = std::fs::remove_file(source_path);
    }
    let _ = main_window.show();
    let _ = main_window.set_focus();

    operation
}

fn mark_app_quitting(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppExitState>() {
        if let Ok(mut is_quitting) = state.is_quitting.lock() {
            *is_quitting = true;
        }
    }
}

fn is_app_quitting(app: &AppHandle) -> bool {
    app.try_state::<AppExitState>()
        .and_then(|state| state.is_quitting.lock().ok().map(|value| *value))
        .unwrap_or(false)
}

fn should_hide_to_tray(app: &AppHandle, label: &str) -> bool {
    if label != MAIN_WINDOW_LABEL {
        return false;
    }

    !is_app_quitting(app)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn setup_system_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(TRAY_SHOW_ID, "Show CyberCode")
        .separator()
        .text(TRAY_QUIT_ID, "Quit CyberCode")
        .build()?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("CyberCode")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => show_main_window(app),
            TRAY_QUIT_ID => {
                mark_app_quitting(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;

    Ok(())
}

#[tauri::command]
fn terminal_spawn(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<TerminalSpawnResult, String> {
    let cwd_path = resolve_terminal_cwd(cwd)?;
    let shell = default_shell();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("open terminal pty: {err}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(cwd_path.as_os_str());
    for (key, value) in terminal_environment(&shell) {
        cmd.env(key, value);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| format!("spawn terminal shell: {err}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| format!("clone terminal reader: {err}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| format!("open terminal writer: {err}"))?;
    let killer = child.clone_killer();
    let session_id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "terminal state is unavailable".to_string())?;
        sessions.insert(
            session_id,
            TerminalSession {
                master: pair.master,
                writer: Mutex::new(writer),
                killer: Mutex::new(killer),
            },
        );
    }

    let output_app = app.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut pending_utf8 = Vec::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let data = decode_terminal_output(&mut pending_utf8, &buffer[..n]);
                    if !data.is_empty() {
                        let _ = output_app.emit(
                            "terminal-output",
                            TerminalOutputPayload { session_id, data },
                        );
                    }
                }
                Err(err) => {
                    let _ = output_app.emit(
                        "terminal-output",
                        TerminalOutputPayload {
                            session_id,
                            data: format!("\r\n[terminal read error: {err}]\r\n"),
                        },
                    );
                    break;
                }
            }
        }
        if !pending_utf8.is_empty() {
            let data = String::from_utf8_lossy(&pending_utf8).to_string();
            let _ = output_app.emit(
                "terminal-output",
                TerminalOutputPayload { session_id, data },
            );
        }
    });

    let exit_app = app.clone();
    thread::spawn(move || {
        let status = child.wait();
        if let Some(state) = exit_app.try_state::<TerminalState>() {
            if let Ok(mut sessions) = state.sessions.lock() {
                sessions.remove(&session_id);
            }
        }
        match status {
            Ok(status) => {
                let _ = exit_app.emit(
                    "terminal-exit",
                    TerminalExitPayload {
                        session_id,
                        code: status.exit_code(),
                        signal: status.signal().map(ToString::to_string),
                    },
                );
            }
            Err(err) => {
                let _ = exit_app.emit(
                    "terminal-output",
                    TerminalOutputPayload {
                        session_id,
                        data: format!("\r\n[terminal wait error: {err}]\r\n"),
                    },
                );
            }
        }
    });

    Ok(TerminalSpawnResult {
        session_id,
        shell,
        cwd: cwd_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn terminal_write(
    state: State<'_, TerminalState>,
    session_id: u32,
    data: String,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "terminal state is unavailable".to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "terminal session is not running".to_string())?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "terminal writer is unavailable".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|err| format!("write terminal input: {err}"))?;
    writer
        .flush()
        .map_err(|err| format!("flush terminal input: {err}"))?;
    Ok(())
}

#[tauri::command]
fn terminal_resize(
    state: State<'_, TerminalState>,
    session_id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "terminal state is unavailable".to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "terminal session is not running".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("resize terminal: {err}"))?;
    Ok(())
}

#[tauri::command]
fn terminal_kill(state: State<'_, TerminalState>, session_id: u32) -> Result<(), String> {
    let session = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "terminal state is unavailable".to_string())?;
        sessions.remove(&session_id)
    };

    if let Some(session) = session {
        let mut killer = session
            .killer
            .lock()
            .map_err(|_| "terminal killer is unavailable".to_string())?;
        killer
            .kill()
            .map_err(|err| format!("kill terminal shell: {err}"))?;
    }
    Ok(())
}

fn decode_terminal_output(pending: &mut Vec<u8>, chunk: &[u8]) -> String {
    pending.extend_from_slice(chunk);
    let mut output = String::new();

    loop {
        match str::from_utf8(pending) {
            Ok(text) => {
                output.push_str(text);
                pending.clear();
                break;
            }
            Err(err) => {
                let valid_up_to = err.valid_up_to();
                if valid_up_to > 0 {
                    let text = str::from_utf8(&pending[..valid_up_to])
                        .expect("valid_up_to marks a valid UTF-8 prefix");
                    output.push_str(text);
                    pending.drain(..valid_up_to);
                    continue;
                }

                match err.error_len() {
                    Some(error_len) => {
                        output.push('\u{fffd}');
                        pending.drain(..error_len);
                    }
                    None => break,
                }
            }
        }
    }

    output
}

fn terminal_environment(shell: &str) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();
    env.extend(login_shell_environment(shell));
    if let Ok(config_dir) = claude_config_home_dir() {
        let value = config_dir.to_string_lossy().to_string();
        env.insert(CYBER_CONFIG_DIR_ENV.to_string(), value.clone());
        env.insert(LEGACY_CLAUDE_CONFIG_DIR_ENV.to_string(), value);
    }
    ensure_utf8_locale(&mut env);
    env
}

fn ensure_utf8_locale(env: &mut HashMap<String, String>) {
    let fallback = default_utf8_locale();
    for key in ["LANG", "LC_CTYPE", "LC_ALL"] {
        let needs_fallback = env
            .get(key)
            .map(|value| !is_utf8_locale(value))
            .unwrap_or(true);
        if needs_fallback {
            env.insert(key.to_string(), fallback.to_string());
        }
    }
}

fn is_utf8_locale(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase().replace('-', "");
    normalized.contains("utf8")
}

fn default_utf8_locale() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "en_US.UTF-8"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "C.UTF-8"
    }
    #[cfg(not(unix))]
    {
        "C.UTF-8"
    }
}

#[cfg(not(target_os = "windows"))]
fn login_shell_environment(shell: &str) -> HashMap<String, String> {
    let Ok(mut child) = StdCommand::new(shell)
        .args(["-l", "-c", "env -0"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return HashMap::new();
    };

    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return HashMap::new();
                }
                let mut stdout = Vec::new();
                if let Some(mut pipe) = child.stdout.take() {
                    let _ = pipe.read_to_end(&mut stdout);
                }
                return parse_env_block(&stdout);
            }
            Ok(None) if Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return HashMap::new();
            }
            Err(_) => return HashMap::new(),
        }
    }
}

#[cfg(target_os = "windows")]
fn login_shell_environment(_shell: &str) -> HashMap<String, String> {
    HashMap::new()
}

fn parse_env_block(bytes: &[u8]) -> HashMap<String, String> {
    bytes
        .split(|byte| *byte == 0)
        .filter_map(|entry| {
            if entry.is_empty() {
                return None;
            }
            let equals = entry.iter().position(|byte| *byte == b'=')?;
            if equals == 0 {
                return None;
            }
            let key = String::from_utf8_lossy(&entry[..equals]).to_string();
            let value = String::from_utf8_lossy(&entry[equals + 1..]).to_string();
            Some((key, value))
        })
        .collect()
}

fn resolve_terminal_cwd(cwd: Option<String>) -> Result<PathBuf, String> {
    let path = match cwd.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    }) {
        Some(path) => path,
        None => home_dir().unwrap_or(
            std::env::current_dir().map_err(|err| format!("resolve current directory: {err}"))?,
        ),
    };

    if path.is_dir() {
        Ok(path)
    } else {
        Err(format!(
            "terminal cwd is not a directory: {}",
            path.display()
        ))
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if PathBuf::from("/bin/zsh").exists() {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        })
    }
}

fn reserve_local_port() -> Result<u16, String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|err| format!("bind local port: {err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("read local port: {err}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn wait_for_server(
    url_host: &str,
    port: u16,
    startup_exit: &Arc<Mutex<Option<String>>>,
) -> Result<(), String> {
    let addr: SocketAddr = format!("{url_host}:{port}")
        .parse()
        .map_err(|err| format!("parse server address: {err}"))?;
    let deadline = Instant::now() + SERVER_STARTUP_WAIT_TIMEOUT;

    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Ok(());
        }
        if let Some(exit) = startup_exit.lock().ok().and_then(|guard| guard.clone()) {
            return Err(format!(
                "desktop server exited before listening on {url_host}:{port}: {exit}"
            ));
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    Err(format!(
        "desktop server did not start listening on {url_host}:{port} within {} seconds",
        SERVER_STARTUP_WAIT_TIMEOUT.as_secs()
    ))
}

fn push_server_startup_log(logs: &Arc<Mutex<VecDeque<String>>>, line: String) {
    let line = line.trim_end().to_string();
    if line.is_empty() {
        return;
    }

    let Ok(mut guard) = logs.lock() else {
        return;
    };
    if guard.len() >= SERVER_STARTUP_LOG_LIMIT {
        guard.pop_front();
    }
    guard.push_back(line);
}

fn format_server_startup_error(message: &str, logs: &Arc<Mutex<VecDeque<String>>>) -> String {
    let log_text = logs
        .lock()
        .ok()
        .map(|guard| guard.iter().cloned().collect::<Vec<_>>().join("\n"))
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| "No server stdout/stderr was captured before the timeout.".to_string());

    format!("{message}\n\nRecent server logs:\n{log_text}")
}

fn resolve_app_root(_app: &AppHandle) -> Result<PathBuf, String> {
    // 历史用途：此前 sidecar launcher 用 dynamic file:// import 加载磁盘上
    // 的 src/server/index.ts 和 preload.ts，所以 Tauri 必须把整个 src/ +
    // node_modules/ 当 Resource 一起 ship 到 .app/Contents/Resources/app/。
    //
    // 现在 launcher 改成静态 import + bun build --compile 整棵静态打进二进制，
    // sidecar 不再读磁盘上的 src/ 或 node_modules/。CLAUDE_APP_ROOT 现在
    // 只剩一个名义上的"app 安装根目录"作用，给 conversationService 在
    // spawn CLI 子进程时通过 --app-root 透传。
    //
    // 我们直接用当前可执行文件所在目录作为 app_root：
    //   Dev:  desktop/src-tauri/target/<profile>/  （rust 跑出来的 binary 那一层）
    //   Prod: <App>.app/Contents/MacOS/             （sidecar 二进制的同级目录）
    let exe = std::env::current_exe().map_err(|err| format!("resolve current exe path: {err}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "current exe has no parent dir".to_string())?
        .to_path_buf();
    Ok(dir)
}

fn desktop_parent_pid_env_value() -> String {
    std::process::id().to_string()
}

fn start_server_sidecar(app: &AppHandle) -> Result<ServerRuntime, String> {
    let host = "127.0.0.1";
    let port = reserve_local_port()?;
    let url = format!("http://{host}:{port}");
    let mut token_bytes = [0_u8; 32];
    getrandom::fill(&mut token_bytes)
        .map_err(|err| format!("generate local server token: {err}"))?;
    let auth_token = general_purpose::URL_SAFE_NO_PAD.encode(token_bytes);
    let app_root = resolve_app_root(app)?;
    let app_root_arg = app_root.to_string_lossy().to_string();
    let codegraph_asset_dir = app
        .path()
        .resource_dir()
        .map_err(|err| format!("resolve Code Graph resources: {err}"))?
        .join("resources")
        .join("codegraph");
    let codegraph_asset_dir_arg = codegraph_asset_dir.to_string_lossy().to_string();
    let rtk_binary = resolve_rtk_binary(app, &app_root)?;
    let rtk_binary_arg = rtk_binary.to_string_lossy().to_string();
    let agent_browser_binary = resolve_agent_browser_binary(app, &app_root)?;
    let agent_browser_binary_arg = agent_browser_binary.to_string_lossy().to_string();
    let browser_executable = resolve_browser_executable();
    prepare_agent_browser_runtime(&agent_browser_binary, browser_executable.is_some());
    let computer_use_helper = match install_computer_use_helper(app) {
        Ok(helper) => helper,
        Err(error) => {
            eprintln!("[computer-use] helper installation failed: {error}");
            None
        }
    };
    let computer_use_runtime_root = app
        .path()
        .resource_dir()
        .map_err(|err| format!("resolve Computer Use runtime resources: {err}"))?
        .join("resources")
        .join("computer-use-runtime");
    let computer_use_runtime_root_arg = computer_use_runtime_root.to_string_lossy().to_string();

    // 单一合并 sidecar：第一个参数选 server / cli / adapters 模式。
    let mut sidecar = app
        .shell()
        .sidecar("cybercode-sidecar")
        .map_err(|err| format!("resolve sidecar: {err}"))?;
    for (key, value) in terminal_environment(&default_shell()) {
        sidecar = sidecar.env(key, value);
    }
    sidecar = sidecar
        .env("SERVER_AUTH_TOKEN", &auth_token)
        .env("CYBERCODE_DESKTOP_PARENT_WATCH", "1")
        .env(
            CYBERCODE_DESKTOP_PARENT_PID_ENV,
            desktop_parent_pid_env_value(),
        )
        .env("CYBER_CODEGRAPH_ASSET_DIR", &codegraph_asset_dir_arg)
        .env("CYBER_RTK_PATH", &rtk_binary_arg)
        .env("CYBER_AGENT_BROWSER_PATH", &agent_browser_binary_arg)
        .env(
            "CYBER_COMPUTER_USE_RUNTIME_ROOT",
            &computer_use_runtime_root_arg,
        );
    if let Some(computer_use_helper) = computer_use_helper {
        sidecar = sidecar.env(
            "CYBER_COMPUTER_USE_HELPER_PATH",
            computer_use_helper.to_string_lossy().to_string(),
        );
    }
    if let Some(browser_executable) = browser_executable {
        sidecar = sidecar.env(
            "CYBER_AGENT_BROWSER_EXECUTABLE_PATH",
            browser_executable.to_string_lossy().to_string(),
        );
    }
    let sidecar = sidecar.args([
        "server",
        "--auth-required",
        "--app-root",
        &app_root_arg,
        "--host",
        host,
        "--port",
        &port.to_string(),
    ]);

    let startup_logs = Arc::new(Mutex::new(VecDeque::new()));
    let logs_for_task = Arc::clone(&startup_logs);
    let startup_exit = Arc::new(Mutex::new(None));
    let exit_for_task = Arc::clone(&startup_exit);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|err| format!("spawn server sidecar: {err}"))?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    let line = line.trim_end();
                    println!("[cybercode-server] {line}");
                    push_server_startup_log(&logs_for_task, format!("[stdout] {line}"));
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    let line = line.trim_end();
                    eprintln!("[cybercode-server] {line}");
                    push_server_startup_log(&logs_for_task, format!("[stderr] {line}"));
                }
                CommandEvent::Terminated(payload) => {
                    let line = format!(
                        "sidecar exited (code={:?}, signal={:?})",
                        payload.code, payload.signal
                    );
                    eprintln!("[cybercode-server] {line}");
                    push_server_startup_log(&logs_for_task, format!("[exit] {line}"));
                    if let Ok(mut guard) = exit_for_task.lock() {
                        *guard = Some(line);
                    }
                }
                _ => {}
            }
        }
    });

    if let Err(err) = wait_for_server(host, port, &startup_exit) {
        let _ = child.kill();
        return Err(format_server_startup_error(&err, &startup_logs));
    }

    Ok(ServerRuntime {
        url,
        auth_token,
        child,
    })
}

fn resolve_rtk_binary(app: &AppHandle, app_root: &Path) -> Result<PathBuf, String> {
    let binary_name = if cfg!(windows) { "rtk.exe" } else { "rtk" };
    let external_binary = app_root.join(binary_name);
    if external_binary.is_file() {
        return Ok(external_binary);
    }

    // Development builds still use the prepared resource directly. Packaged
    // builds use Tauri's externalBin copy so macOS signs and notarizes RTK.
    Ok(app
        .path()
        .resource_dir()
        .map_err(|err| format!("resolve RTK resources: {err}"))?
        .join("resources")
        .join("rtk")
        .join(binary_name))
}

fn resolve_agent_browser_binary(app: &AppHandle, app_root: &Path) -> Result<PathBuf, String> {
    let binary_name = if cfg!(windows) {
        "agent-browser.exe"
    } else {
        "agent-browser"
    };
    let external_binary = app_root.join(binary_name);
    if external_binary.is_file() {
        return Ok(external_binary);
    }

    Ok(app
        .path()
        .resource_dir()
        .map_err(|err| format!("resolve agent-browser resources: {err}"))?
        .join("resources")
        .join("agent-browser")
        .join(binary_name))
}

fn resolve_browser_executable() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("AGENT_BROWSER_EXECUTABLE_PATH")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
    {
        return Some(path);
    }

    let mut candidates = Vec::new();
    if cfg!(target_os = "macos") {
        candidates.extend([
            PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
            PathBuf::from("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
            PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"),
        ]);
    } else if cfg!(windows) {
        for root in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
            let Some(root) = std::env::var_os(root) else {
                continue;
            };
            let root = PathBuf::from(root);
            candidates.extend([
                root.join("Google/Chrome/Application/chrome.exe"),
                root.join("Microsoft/Edge/Application/msedge.exe"),
                root.join("BraveSoftware/Brave-Browser/Application/brave.exe"),
                root.join("Chromium/Application/chrome.exe"),
                // 国内常见 Chromium 系浏览器的默认安装路径
                root.join("360Chrome/Chrome/Application/360chrome.exe"),
                root.join("360/360se6/Application/360se.exe"),
                root.join("Tencent/QQBrowser/QQBrowser.exe"),
                root.join("SogouExplorer/SogouExplorer.exe"),
            ]);
        }
    } else {
        candidates.extend([
            PathBuf::from("/usr/bin/google-chrome"),
            PathBuf::from("/usr/bin/google-chrome-stable"),
            PathBuf::from("/usr/bin/chromium"),
            PathBuf::from("/usr/bin/chromium-browser"),
            PathBuf::from("/usr/bin/microsoft-edge"),
            PathBuf::from("/usr/bin/brave-browser"),
        ]);
    }

    // Windows 上注册表 App Paths 比固定路径猜解更可靠（覆盖自定义安装目录）。
    #[cfg(windows)]
    if let Some(path) = resolve_browser_from_registry() {
        return Some(path);
    }

    candidates.into_iter().find(|path| path.is_file())
}

/// 通过 `reg query HKLM/HKCU ...\App Paths\<exe>` 查系统登记的浏览器路径。
#[cfg(windows)]
fn resolve_browser_from_registry() -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    for (hive, exe_name) in [
        ("HKLM", "chrome.exe"),
        ("HKCU", "chrome.exe"),
        ("HKLM", "msedge.exe"),
        ("HKCU", "msedge.exe"),
        ("HKLM", "brave.exe"),
        ("HKCU", "brave.exe"),
        ("HKLM", "chromium.exe"),
        ("HKCU", "chromium.exe"),
    ] {
        let key = format!(r"{hive}\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}");
        let Ok(output) = StdCommand::new("reg")
            .args(["query", &key, "/ve"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            // 形如："    (默认)    REG_SZ    C:\...\chrome.exe"
            let Some(pos) = line.find("REG_SZ") else {
                continue;
            };
            let path = PathBuf::from(line[pos + "REG_SZ".len()..].trim());
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn push_agent_browser_prepare_log(line: &str) {
    let line = line.trim_end();
    if line.is_empty() {
        return;
    }
    let Ok(mut guard) = AGENT_BROWSER_PREPARE_LOGS.lock() else {
        return;
    };
    if guard.len() >= SERVER_STARTUP_LOG_LIMIT {
        guard.pop_front();
    }
    guard.push_back(line.to_string());
}

#[tauri::command]
fn get_agent_browser_prepare_logs() -> Vec<String> {
    AGENT_BROWSER_PREPARE_LOGS
        .lock()
        .map(|guard| guard.iter().cloned().collect())
        .unwrap_or_default()
}

/// 运行 agent-browser 子命令：捕获输出、强制超时，避免旧实现 Stdio::null
/// 全程静默、无超时导致失败后毫无线索。返回输出尾部（成功）或错误+输出尾部。
fn run_agent_browser_command(
    binary: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let mut command = StdCommand::new(binary);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|err| format!("spawn agent-browser {}: {err}", args.join(" ")))?;

    // 单独线程持续 drain 管道，避免子进程写满管道缓冲区后死锁。
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let stdout_reader = thread::spawn(move || {
        let mut buffer = String::new();
        if let Some(pipe) = stdout_pipe.as_mut() {
            let _ = pipe.read_to_string(&mut buffer);
        }
        buffer
    });
    let stderr_reader = thread::spawn(move || {
        let mut buffer = String::new();
        if let Some(pipe) = stderr_pipe.as_mut() {
            let _ = pipe.read_to_string(&mut buffer);
        }
        buffer
    });

    let deadline = Instant::now() + timeout;
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break Ok(()),
            Ok(Some(status)) => break Err(format!("exited with status {status}")),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(format!("timed out after {} seconds", timeout.as_secs()));
                }
                thread::sleep(Duration::from_millis(200));
            }
            Err(err) => break Err(format!("wait failed: {err}")),
        }
    };

    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    let combined = format!("{stdout}{stderr}");
    let tail = combined
        .lines()
        .rev()
        .take(20)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    match result {
        Ok(()) => Ok(tail),
        Err(err) if tail.trim().is_empty() => Err(err),
        Err(err) => Err(format!("{err}\nLast output:\n{tail}")),
    }
}

fn prepare_agent_browser_runtime(binary: &Path, has_system_browser: bool) {
    if has_system_browser || !binary.is_file() {
        return;
    }
    // 只有 IDLE 才能启动新一轮准备；失败会回到 IDLE 允许重试，READY 后短路。
    if AGENT_BROWSER_PREPARE_STATE
        .compare_exchange(
            AGENT_BROWSER_PREPARE_IDLE,
            AGENT_BROWSER_PREPARE_RUNNING,
            Ordering::SeqCst,
            Ordering::SeqCst,
        )
        .is_err()
    {
        return;
    }

    let binary = binary.to_path_buf();
    thread::spawn(move || {
        let result = prepare_agent_browser_runtime_inner(&binary);
        AGENT_BROWSER_PREPARE_STATE.store(
            if result.is_ok() {
                AGENT_BROWSER_PREPARE_READY
            } else {
                AGENT_BROWSER_PREPARE_IDLE
            },
            Ordering::SeqCst,
        );
    });
}

fn prepare_agent_browser_runtime_inner(binary: &Path) -> Result<(), String> {
    match run_agent_browser_command(
        binary,
        &["doctor", "--offline", "--quick"],
        AGENT_BROWSER_DOCTOR_TIMEOUT,
    ) {
        Ok(_) => return Ok(()),
        Err(error) => {
            push_agent_browser_prepare_log(&format!("[doctor] {error}"));
        }
    }

    let line = "no compatible browser found; preparing Chrome for Testing in the background";
    eprintln!("[agent-browser] {line}");
    push_agent_browser_prepare_log(line);

    match run_agent_browser_command(binary, &["install"], AGENT_BROWSER_INSTALL_TIMEOUT) {
        Ok(output) => {
            eprintln!("[agent-browser] browser runtime is ready");
            push_agent_browser_prepare_log("[install] browser runtime is ready");
            if !output.trim().is_empty() {
                push_agent_browser_prepare_log(&format!("[install] {output}"));
            }
            Ok(())
        }
        Err(error) => {
            eprintln!("[agent-browser] browser runtime preparation failed: {error}");
            push_agent_browser_prepare_log(&format!("[install] {error}"));
            Err(error)
        }
    }
}

fn build_server_shutdown_request(authority: &str, auth_token: &str) -> String {
    format!(
        "POST /internal/shutdown HTTP/1.1\r\nHost: {authority}\r\nAuthorization: Bearer {auth_token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )
}

fn server_url_is_healthy(url: &str) -> bool {
    let Some(authority) = url.strip_prefix("http://") else {
        return false;
    };
    let Ok(address) = authority.parse::<SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, SERVER_HEALTHCHECK_REQUEST_TIMEOUT)
    else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(SERVER_HEALTHCHECK_REQUEST_TIMEOUT));
    let _ = stream.set_write_timeout(Some(SERVER_HEALTHCHECK_REQUEST_TIMEOUT));
    let request = format!("GET /health HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = [0_u8; 128];
    let Ok(read) = stream.read(&mut response) else {
        return false;
    };
    let status = String::from_utf8_lossy(&response[..read]);
    status.starts_with("HTTP/1.1 200") || status.starts_with("HTTP/1.0 200")
}

fn request_server_shutdown(runtime: &ServerRuntime) -> bool {
    let Some(authority) = runtime.url.strip_prefix("http://") else {
        return false;
    };
    let Ok(address) = authority.parse::<SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, SERVER_SHUTDOWN_REQUEST_TIMEOUT)
    else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(SERVER_SHUTDOWN_REQUEST_TIMEOUT));
    let _ = stream.set_write_timeout(Some(SERVER_SHUTDOWN_REQUEST_TIMEOUT));
    let request = build_server_shutdown_request(authority, &runtime.auth_token);
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = [0_u8; 128];
    if let Ok(read) = stream.read(&mut response) {
        let status = String::from_utf8_lossy(&response[..read]);
        if !status.starts_with("HTTP/1.1 202") && !status.starts_with("HTTP/1.0 202") {
            eprintln!("[desktop] server did not acknowledge graceful shutdown");
        }
    }
    true
}

fn wait_for_server_shutdown(runtime: &ServerRuntime) {
    let Some(authority) = runtime.url.strip_prefix("http://") else {
        return;
    };
    let Ok(address) = authority.parse::<SocketAddr>() else {
        return;
    };
    let deadline = Instant::now() + SERVER_GRACEFUL_SHUTDOWN_TIMEOUT;

    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(50)).is_err() {
            return;
        }
        thread::sleep(SERVER_GRACEFUL_SHUTDOWN_POLL_INTERVAL);
    }
}

fn stop_server_runtime(runtime: ServerRuntime) {
    if request_server_shutdown(&runtime) {
        wait_for_server_shutdown(&runtime);
    }
    // CommandChild::kill is SIGKILL on Unix. It remains only as a bounded
    // fallback after the server has had time to close Agent-owned processes.
    let _ = runtime.child.kill();
}

fn stop_server_sidecar(app: &AppHandle) {
    let Some(state) = app.try_state::<ServerState>() else {
        return;
    };

    let Ok(mut guard) = state.0.lock() else {
        return;
    };

    let runtime = guard.runtime.take();
    drop(guard);

    if let Some(runtime) = runtime {
        stop_server_runtime(runtime);
    }
}

/// 启动 adapter sidecar。返回 Result 主要为了把"无法 spawn"和"spawn 后立刻
/// 退出（凭据缺失）"区分开 —— 后者不算错误，是正常 default 状态。
fn start_adapters_sidecar(app: &AppHandle) -> Result<CommandChild, String> {
    let app_root = resolve_app_root(app)?;
    let app_root_arg = app_root.to_string_lossy().to_string();

    // adapter 内部的 WsBridge 默认连 ws://127.0.0.1:3456，但桌面端的 server
    // 用的是 reserve_local_port() 拿到的动态端口。这里把实际端口通过
    // ADAPTER_SERVER_URL env var 传过去 —— adapters/common/config.ts 的
    // loadConfig() 会读它。
    //
    // 如果 server 还没起来 / 没拿到 URL，回退到 3456 作为最后兜底（adapter
    // 自己有重连逻辑，等 server 上线就能连上）。
    let server_connection = app
        .try_state::<ServerState>()
        .and_then(|state| {
            state.0.lock().ok().and_then(|guard| {
                guard
                    .runtime
                    .as_ref()
                    .map(|runtime| (runtime.url.clone(), runtime.auth_token.clone()))
            })
        })
        .unwrap_or_else(|| ("http://127.0.0.1:3456".to_string(), String::new()));
    let (server_http_url, server_auth_token) = server_connection;
    // WsBridge 直接 `new WebSocket('${serverUrl}/ws/...')`，必须传 ws://；
    // 不会自动从 http 转。
    let server_ws_url = if let Some(rest) = server_http_url.strip_prefix("http://") {
        format!("ws://{rest}")
    } else if let Some(rest) = server_http_url.strip_prefix("https://") {
        format!("wss://{rest}")
    } else {
        server_http_url.clone()
    };

    let mut sidecar = app
        .shell()
        .sidecar("cybercode-sidecar")
        .map_err(|err| format!("resolve sidecar: {err}"))?;
    for (key, value) in terminal_environment(&default_shell()) {
        sidecar = sidecar.env(key, value);
    }
    let mut sidecar = sidecar.env("ADAPTER_SERVER_URL", &server_ws_url).env(
        CYBERCODE_DESKTOP_PARENT_PID_ENV,
        desktop_parent_pid_env_value(),
    );
    if !server_auth_token.is_empty() {
        sidecar = sidecar.env("SERVER_AUTH_TOKEN", &server_auth_token);
    }
    let sidecar = sidecar.args([
        "adapters",
        "--app-root",
        &app_root_arg,
        "--telegram",
        "--weixin",
        "--qq",
        "--dingtalk",
    ]);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|err| format!("spawn adapter sidecar: {err}"))?;

    // 用一个 async task 把 sidecar 的 stdout/stderr 转发出来。它退出时
    // 整个 task 也会自然结束。
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    println!("[cybercode-adapters] {}", line.trim_end());
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    eprintln!("[cybercode-adapters] {}", line.trim_end());
                }
                CommandEvent::Terminated(payload) => {
                    // exit code != 0 是常态：用户没配凭据时 sidecar 内部会
                    // warn + skip + process.exit(1)。这里只 info 一行，
                    // 不要当错误冒泡。
                    println!(
                        "[cybercode-adapters] sidecar exited (code={:?}, signal={:?})",
                        payload.code, payload.signal
                    );
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

/// spawn adapter sidecar 并把 child handle 存进 AdapterState。
/// 在启动 + 重启路径里复用，集中处理"无法 spawn"的日志。
fn spawn_and_track_adapters_sidecar(app: &AppHandle) {
    match start_adapters_sidecar(app) {
        Ok(child) => {
            if let Some(state) = app.try_state::<AdapterState>() {
                if let Ok(mut guard) = state.0.lock() {
                    *guard = Some(child);
                }
            }
        }
        Err(err) => {
            eprintln!("[desktop] failed to start adapter sidecar: {err}");
        }
    }
}

fn stop_adapters_sidecar(app: &AppHandle) {
    let Some(state) = app.try_state::<AdapterState>() else {
        return;
    };
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
}

#[cfg(target_os = "windows")]
fn kill_windows_sidecars() {
    for image_name in [
        "cybercode-sidecar-x86_64-pc-windows-msvc.exe",
        "cybercode-sidecar-aarch64-pc-windows-msvc.exe",
        "cybercode-sidecar.exe",
        // Clean up processes left by CyberCode releases before v1.1.2.
        "claude-sidecar-x86_64-pc-windows-msvc.exe",
        "claude-sidecar-aarch64-pc-windows-msvc.exe",
        "claude-sidecar.exe",
    ] {
        let _ = StdCommand::new("taskkill")
            .args(["/F", "/T", "/IM", image_name])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_server_shutdown_request, completed_screenshot_path, decode_screenshot_png_data_url,
        decode_terminal_output, default_utf8_locale, desktop_parent_pid_env_value,
        ensure_utf8_locale, parse_env_block, portable_root_from_executable, screenshot_temp_path,
        server_url_is_healthy, wait_for_server, CYBERCODE_DESKTOP_PARENT_PID_ENV,
        SERVER_CONNECTION_WAIT_TIMEOUT, SERVER_STARTUP_WAIT_TIMEOUT,
    };
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    #[test]
    fn server_wait_returns_immediately_after_sidecar_exit() {
        let startup_exit = Arc::new(Mutex::new(Some(
            "sidecar exited (code=Some(3), signal=None)".to_string(),
        )));
        let started = Instant::now();

        let error = wait_for_server("127.0.0.1", 0, &startup_exit).unwrap_err();

        assert!(error.contains("sidecar exited (code=Some(3), signal=None)"));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn frontend_wait_outlasts_the_sidecar_startup_window() {
        assert_eq!(SERVER_STARTUP_WAIT_TIMEOUT, Duration::from_secs(60));
        assert!(SERVER_CONNECTION_WAIT_TIMEOUT > SERVER_STARTUP_WAIT_TIMEOUT);
    }

    #[test]
    fn managed_sidecars_receive_the_desktop_owner_pid() {
        assert_eq!(
            CYBERCODE_DESKTOP_PARENT_PID_ENV,
            "CYBERCODE_DESKTOP_PARENT_PID"
        );
        assert_eq!(
            desktop_parent_pid_env_value().parse::<u32>().unwrap(),
            std::process::id()
        );
    }

    #[test]
    fn portable_root_is_detected_from_a_directly_launched_nested_executable() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("cybercode-portable-{unique}"));
        let executable = root
            .join("apps")
            .join("windows-x64")
            .join("CyberCode")
            .join("CyberCode.exe");
        std::fs::create_dir_all(executable.parent().expect("executable parent"))
            .expect("create executable directory");
        std::fs::write(root.join(".cybercode-portable"), "cybercode-portable-v1\n")
            .expect("create portable marker");
        std::fs::write(&executable, []).expect("create executable fixture");

        assert_eq!(
            portable_root_from_executable(&executable),
            Some(root.canonicalize().expect("canonical portable root"))
        );

        std::fs::remove_dir_all(root).expect("remove portable fixture");
    }

    #[test]
    fn graceful_shutdown_request_uses_the_ephemeral_server_token() {
        let request = build_server_shutdown_request("127.0.0.1:4567", "secret-token");

        assert!(request.starts_with("POST /internal/shutdown HTTP/1.1\r\n"));
        assert!(request.contains("Host: 127.0.0.1:4567\r\n"));
        assert!(request.contains("Authorization: Bearer secret-token\r\n"));
        assert!(request.ends_with("Connection: close\r\n\r\n"));
    }

    #[test]
    fn native_server_healthcheck_accepts_a_healthy_local_server() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind healthcheck fixture");
        let address = listener.local_addr().expect("read fixture address");
        let responder = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept healthcheck request");
            let mut request = [0_u8; 256];
            let _ = stream.read(&mut request).expect("read healthcheck request");
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
                .expect("write healthcheck response");
        });

        assert!(server_url_is_healthy(&format!("http://{address}")));
        responder.join().expect("join healthcheck responder");
    }

    #[test]
    fn screenshot_temp_path_is_a_unique_png_in_the_system_temp_directory() {
        let first = screenshot_temp_path();
        let second = screenshot_temp_path();

        assert_eq!(first.parent(), Some(std::env::temp_dir().as_path()));
        assert_eq!(
            first.extension().and_then(|value| value.to_str()),
            Some("png")
        );
        assert_ne!(first, second);
    }

    #[test]
    fn completed_screenshot_path_rejects_empty_files() {
        let path = screenshot_temp_path();
        std::fs::write(&path, []).expect("create empty screenshot fixture");

        assert_eq!(completed_screenshot_path(&path).unwrap(), None);
        assert!(!path.exists());
    }

    #[test]
    fn screenshot_result_accepts_png_data_urls() {
        assert_eq!(
            decode_screenshot_png_data_url("data:image/png;base64,iVBORw0KGgo=").unwrap(),
            b"\x89PNG\r\n\x1a\n"
        );
    }

    #[test]
    fn screenshot_result_rejects_non_png_payloads() {
        assert!(decode_screenshot_png_data_url("data:image/png;base64,dGV4dA==").is_err());
        assert!(decode_screenshot_png_data_url("data:image/jpeg;base64,iVBORw0KGgo=").is_err());
    }

    #[test]
    fn terminal_output_decoder_preserves_split_chinese_characters() {
        let mut pending = Vec::new();
        let bytes = "安装 Skills 成功\n".as_bytes();

        assert_eq!(decode_terminal_output(&mut pending, &bytes[..2]), "");
        assert_eq!(decode_terminal_output(&mut pending, &bytes[2..4]), "安");
        assert_eq!(
            decode_terminal_output(&mut pending, &bytes[4..]),
            "装 Skills 成功\n"
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn terminal_output_decoder_keeps_incomplete_suffix_pending() {
        let mut pending = Vec::new();
        let bytes = "中文".as_bytes();

        assert_eq!(decode_terminal_output(&mut pending, &bytes[..4]), "中");
        assert_eq!(pending, bytes[3..4]);
        assert_eq!(decode_terminal_output(&mut pending, &bytes[4..]), "文");
        assert!(pending.is_empty());
    }

    #[test]
    fn parse_env_block_reads_nul_delimited_values() {
        let env =
            parse_env_block(b"PATH=/opt/homebrew/bin:/usr/bin\0NODE_PATH=/tmp/node\0EMPTY=\0");

        assert_eq!(
            env.get("PATH").map(String::as_str),
            Some("/opt/homebrew/bin:/usr/bin")
        );
        assert_eq!(env.get("NODE_PATH").map(String::as_str), Some("/tmp/node"));
        assert_eq!(env.get("EMPTY").map(String::as_str), Some(""));
    }

    #[test]
    fn terminal_environment_forces_utf8_locale_when_shell_uses_c_locale() {
        let mut env = HashMap::from([
            ("LANG".to_string(), "C".to_string()),
            ("LC_CTYPE".to_string(), "POSIX".to_string()),
            ("LC_ALL".to_string(), "C".to_string()),
        ]);

        ensure_utf8_locale(&mut env);

        assert_eq!(
            env.get("LANG").map(String::as_str),
            Some(default_utf8_locale())
        );
        assert_eq!(
            env.get("LC_CTYPE").map(String::as_str),
            Some(default_utf8_locale())
        );
        assert_eq!(
            env.get("LC_ALL").map(String::as_str),
            Some(default_utf8_locale())
        );
    }

    #[test]
    fn terminal_environment_keeps_existing_utf8_locale() {
        let mut env = HashMap::from([
            ("LANG".to_string(), "zh_CN.UTF-8".to_string()),
            ("LC_CTYPE".to_string(), "en_US.UTF8".to_string()),
            ("LC_ALL".to_string(), "C.UTF-8".to_string()),
        ]);

        ensure_utf8_locale(&mut env);

        assert_eq!(env.get("LANG").map(String::as_str), Some("zh_CN.UTF-8"));
        assert_eq!(env.get("LC_CTYPE").map(String::as_str), Some("en_US.UTF8"));
        assert_eq!(env.get("LC_ALL").map(String::as_str), Some("C.UTF-8"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_portable_environment();

    let builder = tauri::Builder::default()
        .manage(ServerState::default())
        .manage(AdapterState::default())
        .manage(TerminalState::default())
        .manage(AppExitState::default())
        .manage(ScreenshotCaptureState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            get_server_connection,
            get_agent_browser_prepare_logs,
            restart_server_sidecar,
            restart_adapters_sidecar,
            prepare_for_update_install,
            open_skills_config_dir,
            read_image_preview_data_url,
            capture_screen_region,
            read_screen_capture_source,
            complete_screen_capture,
            cancel_screen_capture,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_kill
        ]);

    // macOS: native menu bar (traffic-light overlay style)
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|app| {
            let about_item = MenuItemBuilder::with_id("nav_about", "关于 CyberCode").build(app)?;
            let settings_item = MenuItemBuilder::with_id("nav_settings", "设置...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_submenu = SubmenuBuilder::new(app, "CyberCode")
                .item(&about_item)
                .separator()
                .item(&settings_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_submenu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .close_window()
                .build()?;

            MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .item(&view_submenu)
                .item(&window_submenu)
                .build()
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "nav_about" => {
                let _ = app.emit("native-menu-navigate", "about");
            }
            "nav_settings" => {
                let _ = app.emit("native-menu-navigate", "settings");
            }
            _ => {}
        });

    let app = builder
        .setup(|app| {
            setup_system_tray(app)?;

            // Login-shell discovery can take several seconds on machines with
            // Conda, Homebrew, or a large shell profile. Keep all sidecar startup
            // work off the Tauri event loop so the native window remains responsive.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                match start_server_sidecar(&app_handle) {
                    Ok(runtime) => {
                        if is_app_quitting(&app_handle) {
                            stop_server_runtime(runtime);
                            return;
                        }

                        let Some(state) = app_handle.try_state::<ServerState>() else {
                            stop_server_runtime(runtime);
                            return;
                        };
                        let Ok(mut guard) = state.0.lock() else {
                            stop_server_runtime(runtime);
                            eprintln!("[desktop] server state lock poisoned during startup");
                            return;
                        };
                        guard.runtime = Some(runtime);
                        guard.startup_error = None;
                        drop(guard);

                        // The adapter sidecar reads the dynamic server URL from
                        // ServerState, so it starts only after the runtime is stored.
                        spawn_and_track_adapters_sidecar(&app_handle);
                    }
                    Err(err) => {
                        eprintln!("[desktop] failed to start local server: {err}");
                        if let Some(state) = app_handle.try_state::<ServerState>() {
                            if let Ok(mut guard) = state.0.lock() {
                                guard.runtime = None;
                                guard.startup_error = Some(err);
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if should_hide_to_tray(app_handle, &label) => {
            api.prevent_close();
            if let Some(window) = app_handle.get_webview_window(&label) {
                let _ = window.hide();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            show_main_window(app_handle);
        }
        RunEvent::ExitRequested { .. } => {
            mark_app_quitting(app_handle);
            stop_server_sidecar(app_handle);
            stop_adapters_sidecar(app_handle);
        }
        RunEvent::Exit => {
            mark_app_quitting(app_handle);
            stop_server_sidecar(app_handle);
            stop_adapters_sidecar(app_handle);
        }
        _ => {}
    });
}
