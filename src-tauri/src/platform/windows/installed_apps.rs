//! Start Menu shortcut discovery. Returns display names only; never accepts shell input.
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::os::windows::ffi::OsStrExt;
use windows::core::{w, PCWSTR};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub name: String,
}

fn start_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(roaming) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(roaming).join("Microsoft/Windows/Start Menu/Programs"));
    }
    if let Some(common) = std::env::var_os("ProgramData") {
        dirs.push(PathBuf::from(common).join("Microsoft/Windows/Start Menu/Programs"));
    }
    dirs
}

fn gather(dir: &Path, depth: usize, result: &mut Vec<(String, PathBuf)>) {
    if depth > 5 || result.len() >= 800 { return; }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if result.len() >= 800 { break; }
        let path = entry.path();
        if path.is_dir() { gather(&path, depth + 1, result); continue; }
        if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("lnk")) != Some(true) { continue; }
        if let Some(name) = path.file_stem().and_then(|v| v.to_str()) {
            if !name.trim().is_empty() { result.push((name.to_owned(), path)); }
        }
    }
}

fn shortcuts() -> Vec<(String, PathBuf)> {
    let mut result = Vec::new();
    for path in start_dirs() { gather(&path, 0, &mut result); }
    result.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    result
}

pub fn list_installed_apps() -> Vec<InstalledApp> {
    let mut names: Vec<String> = shortcuts().into_iter().map(|(name, _)| name).collect();
    names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    names.into_iter().take(200).map(|name| InstalledApp { name }).collect()
}

/// Launches only a shortcut actually discovered from known Start Menu folders.
pub fn open_start_menu_app(name: &str) -> Result<String, String> {
    if name.trim().is_empty() || name.chars().count() > 120 {
        return Err("Name an installed application.".into());
    }
    let matches: Vec<_> = shortcuts().into_iter()
        .filter(|(label, _)| label.eq_ignore_ascii_case(name)).collect();
    if matches.is_empty() { return Err("No matching Start Menu application was found.".into()); }
    if matches.len() > 1 { return Err("Multiple shortcuts have that name. Use an executable name instead.".into()); }
    let (label, path) = &matches[0];
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let result = unsafe { ShellExecuteW(None, w!("open"), PCWSTR(wide.as_ptr()), None, None, SW_SHOWNORMAL) };
    if (result.0 as isize) <= 32 { return Err(format!("Windows could not open {label}.")); }
    Ok(format!("Opened {label}."))
}
