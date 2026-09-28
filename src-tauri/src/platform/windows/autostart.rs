//! Launch at sign-in: one `HKCU\...\Run` value pointing at this executable.
//! The NSIS uninstaller removes it (`windows/hooks.nsh`); updates keep it.

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, WIN32_ERROR};
use windows::Win32::System::Registry::{
    RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ,
};

use crate::platform::AUTOSTART_ARG;

const RUN_KEY: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Run");
const VALUE_NAME: PCWSTR = w!("Personal Voice");

/// The exact Run command for this executable.
fn command() -> Result<String, String> {
    let exe =
        std::env::current_exe().map_err(|e| format!("Could not find the app's location: {e}"))?;
    Ok(format!("\"{}\" {AUTOSTART_ARG}", exe.display()))
}

fn check(status: WIN32_ERROR, action: &str) -> Result<(), String> {
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!("Windows couldn't {action} (error {}).", status.0))
    }
}

/// True only when the Run value launches this executable; an entry left by another copy counts as off.
pub fn launch_at_login() -> Result<bool, String> {
    let mut size = 0u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            RUN_KEY,
            VALUE_NAME,
            RRF_RT_REG_SZ,
            None,
            None,
            Some(&mut size),
        )
    };
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(false);
    }
    check(status, "read the startup setting")?;
    let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            RUN_KEY,
            VALUE_NAME,
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    check(status, "read the startup setting")?;
    let value = String::from_utf16_lossy(&buffer[..(size as usize / 2)]);
    Ok(value.trim_end_matches('\0') == command()?)
}

pub fn set_launch_at_login(enabled: bool) -> Result<(), String> {
    if !enabled {
        let status = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN_KEY, VALUE_NAME) };
        return if status == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            check(status, "turn off launch at startup")
        };
    }
    let wide: Vec<u16> = command()?.encode_utf16().chain([0]).collect();
    let status = unsafe {
        RegSetKeyValueW(
            HKEY_CURRENT_USER,
            RUN_KEY,
            VALUE_NAME,
            REG_SZ.0,
            Some(wide.as_ptr().cast()),
            (wide.len() * 2) as u32,
        )
    };
    check(status, "turn on launch at startup")
}
