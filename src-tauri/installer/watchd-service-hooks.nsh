; Registers flurer-watchd as a SERVICE_AUTO_START Windows service on
; install, and stops/removes it on uninstall — see
; docs/superpowers/specs/2026-08-16-usn-journal-watcher-design.md for why
; this is a separate elevated service rather than running the whole app
; elevated.
;
; NOTE: wired into tauri.conf.json via bundle.windows.nsis.installerHooks.
; The exact hook macro names (NSIS_HOOK_POSTINSTALL / NSIS_HOOK_PREUNINSTALL)
; match Tauri v2's NSIS template as of this writing but have not been
; exercised by an actual `tauri build` in this environment (no Windows/NSIS
; toolchain available here) — verify against the installed tauri-bundler
; version's nsis template on the first real Windows packaging run, same
; caveat as the watchd crate's raw Win32 FFI.
;
; The service binary is expected alongside flurer.exe in the install
; directory (added to the bundle's resources — see tauri.conf.json).

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Installing flurer-watchd service..."
  ; sc.exe create expects "binPath= <path>" with that exact space after the
  ; equals sign — an NSIS/sc.exe quirk, not a typo.
  nsExec::ExecToLog 'sc.exe create FlurerWatchd binPath= "$INSTDIR\flurer-watchd.exe" start= auto DisplayName= "Flurer Folder-Watch Service"'
  nsExec::ExecToLog 'sc.exe description FlurerWatchd "Reads the NTFS USN Journal so Flurer can show live folder sizes without flurer.exe itself needing admin rights."'
  nsExec::ExecToLog 'sc.exe start FlurerWatchd'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing flurer-watchd service..."
  nsExec::ExecToLog 'sc.exe stop FlurerWatchd'
  nsExec::ExecToLog 'sc.exe delete FlurerWatchd'
!macroend
