//! Tray icon: the app stays running after the window is closed. Quit is only here.

use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, Window};

use crate::platform;

pub fn create(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Personal Voice", true, None::<&str>)?;
    let floating = MenuItem::with_id(app, "floating", "Show floating control", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", "Pause dictation", true, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &floating, &pause, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip(tooltip(false))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "floating" => {
                let _ = app.emit_to("main", "show-floating-control", true);
            }
            "pause" => {
                let paused = pause.is_checked().unwrap_or(false);
                platform::set_paused(paused);
                if let Some(tray) = app.tray_by_id("main") {
                    let _ = tray.set_tooltip(Some(tooltip(paused)));
                }
                let _ = app.emit_to("main", "dictation-paused", paused);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn tooltip(paused: bool) -> &'static str {
    if paused {
        "Personal Voice: dictation paused"
    } else {
        "Personal Voice"
    }
}

/// Close and minimize hide here. The window stays out of the taskbar until Open or a left-click.
pub fn hide_main(window: &Window) {
    let _ = window.hide();
    let _ = window.set_skip_taskbar(true);
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(false);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
