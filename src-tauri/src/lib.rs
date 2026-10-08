mod commands;
mod platform;
#[cfg(desktop)]
mod tray;

#[cfg(desktop)]
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Must be the first plugin: a second launch hands over to the running app and exits
    // before it installs a second push-to-talk hook (which would paste every transcript twice).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        if let Some(id) = args
            .iter()
            .find_map(|arg| arg.strip_prefix("handoff-alert:"))
        {
            if !id.is_empty() {
                platform::notify_handoff_click(app, id);
                return;
            }
        }
        if !args.iter().any(|arg| arg == platform::AUTOSTART_ARG) {
            tray::show_main(app);
        }
    }));
    #[cfg(target_os = "android")]
    let builder = builder.plugin(platform::android::plugin());
    // Android updates go through the browser and the package installer instead.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_notification::init());
    let app = builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                tray::create(app)?;
                place_indicator(app)?;
                watch_overlay(app.handle().clone());
                if let Err(error) = platform::start_push_to_talk(app.handle().clone()) {
                    eprintln!("{error}");
                }
                // Settings starts hidden; a launch at sign-in stays in the tray.
                if !std::env::args().any(|arg| arg == platform::AUTOSTART_ARG) {
                    tray::show_main(app.handle());
                }
            }
            #[cfg(mobile)]
            let _ = app;
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            {
                if window.label() == commands::INDICATOR_WINDOW {
                    match event {
                        WindowEvent::Moved(_)
                        | WindowEvent::Resized(_)
                        | WindowEvent::ScaleFactorChanged { .. } => {
                            if let Some(overlay) = window
                                .app_handle()
                                .get_webview_window(commands::INDICATOR_WINDOW)
                            {
                                let _ = platform::pin_overlay(&overlay);
                            }
                        }
                        _ => {}
                    }
                }
                // Close and minimize keep dictation in the tray. Quit lives only in the tray menu.
                if window.label() == "main" {
                    match event {
                        WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            tray::hide_main(window);
                        }
                        WindowEvent::Resized(_) if window.is_minimized().unwrap_or(false) => {
                            tray::hide_main(window);
                        }
                        _ => {}
                    }
                }
            }
            #[cfg(mobile)]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            commands::insert_text,
            commands::live_dictation_text,
            commands::insert_handoff_text,
            commands::show_handoff_alert,
            commands::capture_selection,
            commands::capture_snapshot,
            commands::describe_windows,
            #[cfg(windows)]
            commands::inspect_accessibility,
            #[cfg(windows)]
            commands::invoke_accessible_control,
            #[cfg(windows)]
            commands::focus_accessible_control,
            #[cfg(windows)]
            commands::list_installed_apps,
            commands::open_allowlisted_app,
            commands::press_allowlisted_shortcut,
            commands::computer_capture,
            commands::computer_click,
            commands::computer_restore,
            commands::set_push_to_talk_shortcut,
            commands::set_hotkeys,
            commands::set_hotkey_capture,
            commands::set_dictation_active,
            commands::sync_overlay,
            commands::resize_overlay,
            commands::resize_overlay_confirm,
            commands::peek_overlay_tip_side,
            commands::set_overlay_anchor,
            commands::begin_overlay_drag,
            commands::drag_overlay,
            commands::commit_overlay_position,
            commands::show_settings,
            commands::get_launch_at_login,
            commands::set_launch_at_login,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|_app, event| {
        if let tauri::RunEvent::Exit = event {
            platform::finish_pending_restore();
        }
    });
}

/// Bottom-right of the primary work area, clickable without stealing focus.
#[cfg(desktop)]
fn place_indicator(app: &tauri::App) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(commands::INDICATOR_WINDOW) else {
        return Ok(());
    };
    window.set_ignore_cursor_events(false)?;
    if let Err(error) = platform::prepare_overlay(&window) {
        eprintln!("{error}");
    }
    if let Err(error) = platform::pin_overlay(&window) {
        eprintln!("{error}");
    }
    Ok(())
}

/// Resolution, DPI, and taskbar changes do not always move the window, so re-pin on a short interval.
#[cfg(desktop)]
fn watch_overlay(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let handle = app.clone();
        if app
            .run_on_main_thread(move || {
                if let Some(window) = handle.get_webview_window(commands::INDICATOR_WINDOW) {
                    let _ = platform::pin_overlay(&window);
                }
            })
            .is_err()
        {
            break;
        }
    });
}
