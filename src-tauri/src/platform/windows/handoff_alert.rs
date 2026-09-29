//! Windows toast for a received handoff. Clicking it tells the webview to insert the text
//! and keeps Settings hidden.
//!
//! `tauri-plugin-notification` is initialized for desktop permission state, but its desktop
//! backend ignores click actions. The toast is shown with the Windows toast API so the
//! in-process `Activated` event can insert without opening Settings.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use windows::core::{IInspectable, HSTRING};
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::TypedEventHandler;
use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

const CLICK_DEBOUNCE: Duration = Duration::from_secs(2);

static RECENT_CLICKS: LazyLock<Mutex<HashMap<String, Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static OPEN_TOASTS: Mutex<Vec<ToastNotification>> = Mutex::new(Vec::new());

pub fn show_handoff_alert(
    app: &AppHandle,
    id: &str,
    title: &str,
    body: &str,
) -> Result<(), String> {
    if id.is_empty() {
        return Err("Missing handoff id.".into());
    }
    let _ = app.notification().permission_state();
    let launch = format!("handoff-alert:{id}");
    let markup = format!(
        "<toast launch=\"{}\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
        escape_xml(&launch),
        escape_xml(title),
        escape_xml(body),
    );
    let xml = XmlDocument::new().map_err(|error| error.to_string())?;
    xml.LoadXml(&HSTRING::from(markup))
        .map_err(|error| error.to_string())?;
    let toast =
        ToastNotification::CreateToastNotification(&xml).map_err(|error| error.to_string())?;
    let clicked = app.clone();
    let clicked_id = id.to_string();
    toast
        .Activated(&TypedEventHandler::<ToastNotification, IInspectable>::new(
            move |_, _| {
                notify_handoff_click(&clicked, &clicked_id);
                Ok(())
            },
        ))
        .map_err(|error| error.to_string())?;
    let notifier = toast_notifier(app).map_err(|error| error.to_string())?;
    notifier.Show(&toast).map_err(|error| error.to_string())?;
    if let Ok(mut open) = OPEN_TOASTS.lock() {
        open.push(toast);
        let extra = open.len().saturating_sub(8);
        if extra > 0 {
            open.drain(0..extra);
        }
    }
    Ok(())
}

/// Insert path for a toast click. A second delivery of the same id within two seconds is ignored,
/// because Windows can both raise `Activated` and start the already-running app.
pub fn notify_handoff_click(app: &AppHandle, id: &str) {
    if id.is_empty() || !remember_click(id) {
        return;
    }
    let _ = app.emit_to("main", "handoff-alert-click", id.to_string());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn remember_click(id: &str) -> bool {
    let Ok(mut recent) = RECENT_CLICKS.lock() else {
        return true;
    };
    let now = Instant::now();
    recent.retain(|_, at| now.duration_since(*at) < CLICK_DEBOUNCE);
    if recent.contains_key(id) {
        return false;
    }
    recent.insert(id.to_string(), now);
    true
}

fn toast_notifier(
    app: &AppHandle,
) -> windows::core::Result<windows::UI::Notifications::ToastNotifier> {
    let app_id = HSTRING::from(app.config().identifier.as_str());
    match ToastNotificationManager::CreateToastNotifierWithId(&app_id) {
        Ok(notifier) => Ok(notifier),
        Err(_) => ToastNotificationManager::CreateToastNotifier(),
    }
}

fn escape_xml(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}
