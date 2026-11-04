//! Fail-closed native gate for trusted remote actions on Windows.
 //! An active sign-in, locked session, UAC secure desktop or disconnected
 //! interactive desktop never authorizes unapproved remote input.
 use windows::Win32::Foundation::HANDLE;
 use windows::Win32::System::StationsAndDesktops::{
     CloseDesktop, GetUserObjectInformationW, OpenInputDesktop,
     DESKTOP_READOBJECTS, UOI_NAME,
 };
 
 pub fn interactive_desktop_unlocked() -> bool {
     let desk = match unsafe { OpenInputDesktop(Default::default(), false, DESKTOP_READOBJECTS) } {
         Ok(value) => value,
         Err(_) => return false,
     };
     let mut name = [0u16; 64];
     let result = unsafe {
         GetUserObjectInformationW(
             HANDLE(desk.0),
             UOI_NAME,
             Some(name.as_mut_ptr().cast()),
             (name.len() * std::mem::size_of::<u16>()) as u32,
             None,
         )
     };
     let _ = unsafe { CloseDesktop(desk) };
     if result.is_err() { return false; }
     let end = name.iter().position(|c| *c == 0).unwrap_or(0);
     String::from_utf16(&name[..end])
         .map(|n| n.eq_ignore_ascii_case("Default"))
         .unwrap_or(false)
 }
