; Tauri NSIS hooks (bundle.windows.nsis.installerHooks).
; Updates run the old uninstaller with /UPDATE, so only a real uninstall removes launch at startup.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Personal Voice"
  ${EndIf}
!macroend
