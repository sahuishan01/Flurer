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

  DetailPrint "Registering flurer application paths..."
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\flurer.exe" "" "$INSTDIR\flurer.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\flurer.exe" "Path" "$INSTDIR"

  ; Add $INSTDIR to user PATH if not already present
  ReadRegStr $0 HKCU "Environment" "Path"
  Push "$0"
  Push "$INSTDIR"
  ; Check if $INSTDIR is already in $0
  StrCmp $0 "" +3 0
  ; If Path exists, check if INSTDIR already part of it
  Push "$0"
  Push "$INSTDIR"
  ; Simple append if not blank, else set directly
  WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR"
  ; Broadcast WM_SETTINGCHANGE so new shells inherit updated PATH immediately
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing flurer-watchd service..."
  nsExec::ExecToLog 'sc.exe stop FlurerWatchd'
  nsExec::ExecToLog 'sc.exe delete FlurerWatchd'

  DetailPrint "Unregistering flurer application paths..."
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\flurer.exe"
!macroend
