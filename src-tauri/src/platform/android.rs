//! Registers the Kotlin `VoicePlatformPlugin` (floating mic, foreground service,
//! accessibility insertion). Its commands are handled entirely in Kotlin.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("voice-platform")
        .setup(|_app, api| {
            api.register_android_plugin("com.personal.voiceapp.platform", "VoicePlatformPlugin")?;
            Ok(())
        })
        .build()
}
