//! One local camera window supplies normalized pose only. No images/landmarks enter IPC.
use super::desktop_background;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const WINDOW: &str = "desktop-head-tracking";
static FILTER: Mutex<Option<(HeadPose, Instant)>> = Mutex::new(None);

#[cfg(debug_assertions)]
pub fn probe_report(caller: &str, error: Option<String>) -> Result<(), String> {
    if caller != WINDOW {
        return Err("Only the tracker can report its model probe".into());
    }
    if let Some(error) = error {
        eprintln!("head model probe FAILED: {error}");
    } else {
        eprintln!("head model probe PASSED: local MediaPipe worker initialized and synthetic-frame inference completed; no camera opened");
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HeadPose {
    x: f64,
    y: f64,
    z: f64,
}

fn valid(pose: HeadPose) -> bool {
    [pose.x, pose.y, pose.z]
        .iter()
        .all(|v| v.is_finite() && (-1.0..=1.0).contains(v))
}

pub fn reset(app: &AppHandle) {
    if let Ok(mut filter) = FILTER.lock() {
        *filter = None;
    }
    relay(app, HeadPose::default());
}

fn relay(app: &AppHandle, pose: HeadPose) {
    for (label, window) in app.webview_windows() {
        if desktop_background::is_surface(&label) {
            let _ = window.emit("desktop-head-pose", pose);
        }
    }
}

pub fn publish(app: &AppHandle, caller: &str, pose: HeadPose) -> Result<(), String> {
    if caller != WINDOW || app.get_webview_window(WINDOW).is_none() {
        return Err("Only the local head tracker can publish movement".into());
    }
    if !valid(pose) {
        return Err("Head movement must contain finite values within -1..1".into());
    }
    let now = Instant::now();
    let mut filter = FILTER.lock().map_err(|e| e.to_string())?;
    let previous = filter.as_ref().map(|(p, _)| *p).unwrap_or_default();
    let elapsed = filter
        .as_ref()
        .map(|(_, t)| now.duration_since(*t).as_secs_f64())
        .unwrap_or(0.04);
    let blend = 1.0 - (-elapsed / 0.065).exp();
    let smoothed = HeadPose {
        x: previous.x + (pose.x - previous.x) * blend,
        y: previous.y + (pose.y - previous.y) * blend,
        z: previous.z + (pose.z - previous.z) * blend,
    };
    *filter = Some((smoothed, now));
    drop(filter);
    relay(app, smoothed);
    Ok(())
}

pub fn open(app: &AppHandle) -> Result<(), String> {
    if desktop_background::status()?.phase != "running" {
        return Err("Enable the 3D background first".into());
    }
    if let Some(window) = app.get_webview_window(WINDOW) {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let handle = app.clone();
    let window = WebviewWindowBuilder::new(
        app,
        WINDOW,
        WebviewUrl::App(
            if cfg!(debug_assertions) && std::env::args().any(|a| a == "--head-tracking-probe") {
                "head-tracking.html?probe".into()
            } else {
                "head-tracking.html".into()
            },
        ),
    )
    .title("Personal Voice — Head Tracking")
    .additional_browser_args(desktop_background::browser_args(app))
    .inner_size(480.0, 640.0)
    .resizable(false)
    .on_navigation(|url| {
        url.path() == "/head-tracking.html"
            && (url.scheme() == "tauri"
                || url.host_str() == Some("tauri.localhost")
                || (url.host_str() == Some("localhost") && url.port() == Some(1420)))
    })
    .build()
    .map_err(|e| e.to_string())?;
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            reset(&handle);
        }
    });
    Ok(())
}

pub fn close(app: &AppHandle) {
    reset(app);
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_malformed_or_unbounded_pose() {
        assert!(valid(HeadPose {
            x: -1.0,
            y: 0.2,
            z: 1.0
        }));
        assert!(!valid(HeadPose {
            x: f64::NAN,
            ..HeadPose::default()
        }));
        assert!(!valid(HeadPose {
            z: 1.01,
            ..HeadPose::default()
        }));
        assert!(serde_json::from_str::<HeadPose>(r#"{"x":0,"y":0,"z":0,"image":"no"}"#).is_err());
    }
}
