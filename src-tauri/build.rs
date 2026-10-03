fn main() {
    // Android's Kotlin plugin lives in the app (`gen/android/.../platform`), so its
    // command permissions are declared here instead of in a separate plugin crate.
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "voice-platform",
            tauri_build::InlinedPlugin::new()
                .commands(&[
                    "register_listener",
                    "remove_listener",
                    "check_permissions",
                    "request_permissions",
                    "get_status",
                    "set_start_on_boot",
                    "open_overlay_settings",
                    "open_accessibility_settings",
                    "open_app_settings",
                    "open_battery_settings",
                    "open_download",
                    "start_floating_mic",
                    "stop_floating_mic",
                    "set_indicator",
                    "set_overlay",
                    "show_settings",
                    "insert_text",
                    "insert_handoff_text",
                    "capture_selection",
                    "start_capture",
                    "stop_capture",
                    "enqueue_assistant_playback",
                    "clear_assistant_playback",
                    "list_cameras",
                    "capture_camera_photo",
                    "start_camera_frames",
                    "switch_camera",
                    "stop_camera_frames",
                ])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to run tauri-build");
}
