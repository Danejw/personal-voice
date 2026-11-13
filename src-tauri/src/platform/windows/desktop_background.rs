//! Experimental shell hosting. WorkerW and message 0x052c are undocumented Explorer
//! conventions, not a supported Windows wallpaper API. Never modify shell styles,
//! wallpaper preferences, input hooks, or process DPI awareness to make them work.
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use windows::core::{w, BOOL};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::HiDpi::{AreDpiAwarenessContextsEqual, GetWindowDpiAwarenessContext};
use windows::Win32::UI::WindowsAndMessaging::*;

const PREFIX: &str = "desktop-background-";
static OPERATION: Mutex<()> = Mutex::new(());
static STATE: Mutex<Option<Host>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static PALETTE: Mutex<&'static str> = Mutex::new("cyan");

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MonitorRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: &'static str,
    error: Option<String>,
    monitors: Vec<MonitorRect>,
    ready_surfaces: usize,
}

struct Host {
    status: Status,
    parent: isize,
    labels: Vec<String>,
    ready: Vec<String>,
    started: Instant,
}

pub fn is_surface(label: &str) -> bool {
    label.starts_with(PREFIX)
}

pub fn browser_args(app: &AppHandle) -> &str {
    app.config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .and_then(|w| w.additional_browser_args.as_deref())
        .unwrap_or("")
}

pub fn permits_command(label: &str, command: &str) -> bool {
    if label == super::head_tracking::WINDOW {
        return command == "desktop_head_pose"
            || (cfg!(debug_assertions) && command == "desktop_head_probe");
    }
    !is_surface(label) || command == "desktop_background_ready"
}

/// Only the Settings WebView may select a visual preset. No scripts or credentials enter surfaces.
pub fn set_palette(app: &AppHandle, requested: &str) -> Result<(), String> {
    let palette = match requested {
        "cyan" => "cyan",
        "violet" => "violet",
        "amber" => "amber",
        _ => return Err("Unsupported environment palette".into()),
    };
    *PALETTE.lock().map_err(|e| e.to_string())? = palette;
    for (label, _) in app.webview_windows() {
        if is_surface(&label) {
            app.emit_to(&label, "desktop-environment-changed", palette)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn status() -> Result<Status, String> {
    Ok(STATE
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|h| h.status.clone())
        .unwrap_or(Status {
            phase: "disabled",
            error: None,
            monitors: vec![],
            ready_surfaces: 0,
        }))
}

fn layout(app: &AppHandle) -> Result<Vec<MonitorRect>, String> {
    let mut result: Vec<_> = app
        .available_monitors()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|m| MonitorRect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
            scale: m.scale_factor(),
        })
        .collect();
    result.sort_by_key(|m| (m.x, m.y, m.width, m.height));
    if result.is_empty() {
        return Err("No displays found".into());
    }
    Ok(result)
}

unsafe extern "system" fn find_worker(window: HWND, parameter: LPARAM) -> BOOL {
    // Select only the wallpaper WorkerW immediately behind a desktop icon host.
    if unsafe { FindWindowExW(Some(window), None, w!("SHELLDLL_DefView"), None) }.is_ok() {
        if let Ok(worker) = unsafe { FindWindowExW(None, Some(window), w!("WorkerW"), None) } {
            unsafe {
                *(parameter.0 as *mut isize) = worker.0 as isize;
            }
            return BOOL(0);
        }
    }
    BOOL(1)
}

fn shell_host() -> Result<isize, String> {
    unsafe {
        let progman =
            FindWindowW(w!("Progman"), None).map_err(|_| "Explorer desktop is unavailable")?;
        // Bound the undocumented shell request: an unresponsive Explorer must not hang voice.
        let mut response = 0usize;
        if SendMessageTimeoutW(
            progman,
            0x052c,
            WPARAM(0),
            LPARAM(0),
            SMTO_ABORTIFHUNG,
            1000,
            Some(&mut response),
        )
        .0 == 0
        {
            return Err("Explorer did not respond to the desktop-host request".into());
        }
        let mut parent = 0isize;
        let _ = EnumWindows(Some(find_worker), LPARAM(&mut parent as *mut _ as isize));
        if parent == 0 {
            return Err("This Explorer desktop layout has no supported wallpaper host".into());
        }
        Ok(parent)
    }
}

fn publish(app: &AppHandle) {
    if let Ok(snapshot) = status() {
        let _ = app.emit_to("main", "desktop-background-status", snapshot);
    }
}

fn remove_surfaces(app: &AppHandle) {
    super::head_tracking::close(app);
    for (label, window) in app.webview_windows() {
        if is_surface(&label) {
            let _ = window.destroy();
        }
    }
}

fn fail(app: &AppHandle, error: String) {
    #[cfg(debug_assertions)]
    eprintln!("desktop background stopped: {error}");
    // Invalidate readiness before asynchronously destroying windows.
    if let Ok(mut state) = STATE.lock() {
        *state = Some(Host {
            status: Status {
                phase: "error",
                error: Some(error),
                monitors: vec![],
                ready_surfaces: 0,
            },
            parent: 0,
            labels: vec![],
            ready: vec![],
            started: Instant::now(),
        });
    }
    remove_surfaces(app);
    publish(app);
}

pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<Status, String> {
    let _operation = OPERATION.lock().map_err(|e| e.to_string())?;
    if !enabled {
        *STATE.lock().map_err(|e| e.to_string())? = None;
        remove_surfaces(app);
        publish(app);
        return status();
    }
    if matches!(status()?.phase, "starting" | "running") {
        return status();
    }
    let result = start(app);
    if let Err(error) = result {
        fail(app, error);
    }
    status()
}

fn start(app: &AppHandle) -> Result<(), String> {
    let monitors = layout(app)?;
    let parent = shell_host()?;
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed);
    let labels: Vec<_> = (0..monitors.len())
        .map(|i| format!("{PREFIX}{generation}-{i}"))
        .collect();
    *STATE.lock().map_err(|e| e.to_string())? = Some(Host {
        status: Status {
            phase: "starting",
            error: None,
            monitors: monitors.clone(),
            ready_surfaces: 0,
        },
        parent,
        labels: labels.clone(),
        ready: vec![],
        started: Instant::now(),
    });
    publish(app);
    for (index, monitor) in monitors.iter().enumerate() {
        let palette = *PALETTE.lock().map_err(|e| e.to_string())?;
        let payload = serde_json::json!({ "monitors": monitors, "index": index, "palette": palette });
        let label = &labels[index];
        let window =
            WebviewWindowBuilder::new(app, label, WebviewUrl::App("background.html".into()))
                .additional_browser_args(browser_args(app))
                .parent_raw(HWND(parent as *mut _))
                .title("Personal Voice Desktop Background")
                .visible(false)
                .focused(false)
                .focusable(false)
                .decorations(false)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(false)
                .initialization_script(format!("window.__PV_BACKGROUND__ = {payload};"))
                .on_navigation(|url| {
                    url.path() == "/background.html"
                        && (url.scheme() == "tauri"
                            || url.host_str() == Some("tauri.localhost")
                            || (url.host_str() == Some("localhost") && url.port() == Some(1420)))
                })
                .build()
                .map_err(|e| e.to_string())?;
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let monitor = monitor.clone();
        window
            .clone()
            .run_on_main_thread(move || {
                let result = attach(&window, parent, &monitor);
                let _ = send.send(result);
            })
            .map_err(|e| e.to_string())?;
        receive
            .recv_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())??;
    }
    Ok(())
}

fn attach(
    window: &tauri::WebviewWindow,
    parent: isize,
    monitor: &MonitorRect,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let parent = HWND(parent as *mut _);
    unsafe {
        // Created as a native child from the outset; never change process DPI awareness.
        if !IsWindow(Some(parent)).as_bool()
            || !AreDpiAwarenessContextsEqual(
                GetWindowDpiAwarenessContext(hwnd),
                GetWindowDpiAwarenessContext(parent),
            )
            .as_bool()
        {
            return Err("Desktop host DPI awareness differs; refusing this host".into());
        }
        let extended = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            extended | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize,
        );
        if GetParent(hwnd).map_err(|e| e.to_string())? != parent {
            return Err("Desktop parenting verification failed".into());
        }
        let mut origin = POINT {
            x: monitor.x,
            y: monitor.y,
        };
        ScreenToClient(parent, &mut origin)
            .ok()
            .map_err(|e| e.to_string())?;
        SetWindowPos(
            hwnd,
            None,
            origin.x,
            origin.y,
            monitor.width as i32,
            monitor.height as i32,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED,
        )
        .map_err(|e| e.to_string())?;
    }
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn ready(
    _app: &AppHandle,
    window: &tauri::WebviewWindow,
    error: Option<String>,
) -> Result<(), String> {
    if !is_surface(window.label()) {
        return Err("Only background surfaces can report readiness".into());
    }
    let mut state = STATE.lock().map_err(|e| e.to_string())?;
    let Some(host) = state.as_mut() else {
        return Ok(());
    };
    if !host.labels.iter().any(|label| label == window.label()) {
        return Ok(());
    }
    if let Some(error) = error {
        host.status.error = Some(error);
        return Ok(());
    }
    if !host.ready.iter().any(|label| label == window.label()) {
        host.ready.push(window.label().into());
    }
    host.status.ready_surfaces = host.ready.len();
    // Keep every surface hidden until all renderers and HWND attachments are ready.
    drop(state);
    Ok(())
}

/// Called by one app-owned watcher. Fail closed on shell/layout loss; retry is explicit.
pub fn watch(app: &AppHandle, resumed: bool) {
    let Ok(_operation) = OPERATION.try_lock() else {
        return;
    };
    let snapshot = {
        let Ok(state) = STATE.lock() else {
            return;
        };
        let Some(host) = state.as_ref() else {
            return;
        };
        if !matches!(host.status.phase, "starting" | "running") {
            return;
        }
        if let Some(error) = host.status.error.clone() {
            drop(state);
            fail(app, error);
            return;
        }
        (
            host.parent,
            host.status.monitors.clone(),
            host.labels.clone(),
            host.ready.len() == host.labels.len(),
            host.started.elapsed(),
        )
    };
    let (parent, monitors, labels, ready, elapsed) = snapshot;
    let valid = !resumed
        && layout(app).is_ok_and(|m| m == monitors)
        && labels.iter().all(|label| {
            app.get_webview_window(label).is_some_and(|w| {
                w.hwnd().is_ok_and(|hwnd| unsafe {
                    IsWindow(Some(HWND(parent as *mut _))).as_bool()
                        && GetParent(hwnd).is_ok_and(|p| p.0 as isize == parent)
                })
            })
        });
    if !valid {
        #[cfg(debug_assertions)]
        {
            eprintln!(
                "host valid: {}, resumed: {resumed}, layout: {:?}",
                unsafe { IsWindow(Some(HWND(parent as *mut _))).as_bool() },
                layout(app)
            );
            for label in &labels {
                eprintln!(
                    "surface {label}: {:?}",
                    app.get_webview_window(label).map(|w| w
                        .hwnd()
                        .map(|h| unsafe { GetParent(h).map(|p| p.0 as isize) }))
                );
            }
        }
        fail(
            app,
            "Desktop shell, displays, or power state changed. Enable again to reattach.".into(),
        );
        return;
    }
    if !ready && elapsed > Duration::from_secs(20) {
        fail(app, "Background renderer did not become ready".into());
        return;
    }
    if ready && status().is_ok_and(|s| s.phase == "starting") {
        for label in labels {
            if let Some(window) = app.get_webview_window(&label) {
                if let Ok(hwnd) = window.hwnd() {
                    unsafe {
                        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                    }
                }
            }
        }
        if let Ok(mut state) = STATE.lock() {
            if let Some(host) = state.as_mut() {
                host.status.phase = "running";
            }
        }
        publish(app);
    }
}

pub fn shutdown(app: &AppHandle) {
    if let Ok(mut state) = STATE.lock() {
        *state = None;
    }
    remove_surfaces(app);
}

#[cfg(test)]
mod tests {
    use super::permits_command;

    #[test]
    fn scene_cannot_access_voice_clipboard_or_computer_commands() {
        for command in [
            "insert_text",
            "set_hotkeys",
            "computer_click",
            "set_desktop_background",
            "unknown",
        ] {
            assert!(!permits_command("desktop-background-1-0", command));
        }
        assert!(permits_command(
            "desktop-background-1-0",
            "desktop_background_ready"
        ));
        assert!(permits_command("main", "set_desktop_background"));
        assert!(permits_command("indicator", "sync_overlay"));
        assert!(permits_command(
            super::super::head_tracking::WINDOW,
            "desktop_head_pose"
        ));
        assert!(!permits_command(
            super::super::head_tracking::WINDOW,
            "insert_text"
        ));
        assert!(!permits_command(
            "desktop-background-1-0",
            "desktop_head_pose"
        ));
    }
}

/// Opt-in native smoke runner. No main view, tray, voice controllers, auth, or
/// input hooks, so it can run beside the installed app without touching its session.
#[cfg(debug_assertions)]
pub fn smoke_test(review: bool) {
    let mut context = tauri::generate_context!();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
    }
    context.config_mut().identifier = "com.personal.voiceapp.backgroundprobe".into();
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            crate::commands::desktop_background_ready,
            crate::commands::desktop_head_pose,
            #[cfg(debug_assertions)]
            crate::commands::desktop_head_probe
        ])
        .setup(move |app| {
            if review {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::TrayIconBuilder;
                let enable =
                    MenuItem::with_id(app, "enable", "Enable 3D background", true, None::<&str>)?;
                let disable =
                    MenuItem::with_id(app, "disable", "Disable 3D background", true, None::<&str>)?;
                let tracking =
                    MenuItem::with_id(app, "tracking", "Head tracking…", true, None::<&str>)?;
                let quit =
                    MenuItem::with_id(app, "quit", "Quit background test", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&enable, &disable, &tracking, &quit])?;
                let mut tray = TrayIconBuilder::with_id("background-review")
                    .tooltip("Personal Voice — 3D background test")
                    .menu(&menu)
                    .on_menu_event(|app, event| {
                        if event.id.as_ref() == "tracking" {
                            let app = app.clone();
                            std::thread::spawn(move || {
                                if let Err(error) = super::head_tracking::open(&app) {
                                    eprintln!("head tracker: {error}");
                                }
                            });
                            return;
                        }
                        if event.id.as_ref() == "quit" {
                            shutdown(app);
                            app.exit(0);
                            return;
                        }
                        let enabled = event.id.as_ref() == "enable";
                        let app = app.clone();
                        std::thread::spawn(move || {
                            eprintln!(
                                "background control: {}",
                                serde_json::to_string(&set_enabled(&app, enabled)).unwrap()
                            );
                        });
                    });
                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }
                tray.build(app)?;
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let foreground = unsafe { GetForegroundWindow() }.0 as isize;
                eprintln!(
                    "background start: {}",
                    serde_json::to_string(&set_enabled(&handle, true)).unwrap()
                );
                if review {
                    if std::env::args().any(|a| a == "--head-tracking-probe") {
                        std::thread::sleep(Duration::from_secs(3));
                        if let Err(error) = super::head_tracking::open(&handle) {
                            eprintln!("head tracker open failed: {error}");
                        }
                    }
                    return;
                }
                std::thread::sleep(Duration::from_secs(12));
                eprintln!(
                    "background after 12s: {}",
                    serde_json::to_string(&status()).unwrap()
                );
                eprintln!(
                    "background foreground preserved: {}",
                    foreground == unsafe { GetForegroundWindow() }.0 as isize
                );
                eprintln!(
                    "background disable: {}",
                    serde_json::to_string(&set_enabled(&handle, false)).unwrap()
                );
                std::thread::sleep(Duration::from_secs(1));
                eprintln!(
                    "background remaining surfaces: {}",
                    handle.webview_windows().len()
                );
                handle.exit(0);
            });
            super::super::super::watch_desktop_background(app.handle().clone());
            Ok(())
        })
        .build(context)
        .expect("background smoke runner");
    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { api, code, .. } if code.is_none() => api.prevent_exit(),
        tauri::RunEvent::Exit => shutdown(app),
        _ => {}
    });
}
