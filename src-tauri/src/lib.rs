mod commands;
mod platform;
#[cfg(desktop)]
mod tray;

#[cfg(desktop)]
use tauri::{Manager, PhysicalPosition, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Must be the first plugin: a second launch hands over to the running app and exits
    // before it installs a second push-to-talk hook (which would paste every transcript twice).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        if !args.iter().any(|arg| arg == platform::AUTOSTART_ARG) {
            tray::show_main(app);
        }
    }));
    #[cfg(target_os = "android")]
    let builder = builder.plugin(platform::android::plugin());
    // Android updates go through the browser and the package installer instead.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    let app = builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                tray::create(app)?;
                place_indicator(app)?;
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
            // Closing Settings keeps dictation running in the tray; Quit lives in the tray menu.
            #[cfg(desktop)]
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(mobile)]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            commands::insert_text,
            commands::set_push_to_talk_shortcut,
            commands::set_dictation_active,
            commands::show_indicator,
            commands::hide_indicator,
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

/// Bottom-centre of the primary work area, click-through.
#[cfg(desktop)]
fn place_indicator(app: &tauri::App) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(commands::INDICATOR_WINDOW) else {
        return Ok(());
    };
    window.set_ignore_cursor_events(true)?;
    if let Some(monitor) = window.primary_monitor()? {
        let area = monitor.work_area();
        let size = window.outer_size()?;
        let margin = (48.0 * monitor.scale_factor()) as i32;
        let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
        let y = area.position.y + area.size.height as i32 - size.height as i32 - margin;
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    Ok(())
}
