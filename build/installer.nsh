; Custom NSIS Script for Work Tracker
; Ensures clean installation, upgrade, and uninstallation without file-locking errors

!macro customInit
  nsExec::Exec 'taskkill /F /IM "Work Tracker.exe" /T'
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "Work Tracker.exe" /T'
  Sleep 1000
!macroend

!macro customUninstall
  nsExec::Exec 'taskkill /F /IM "Work Tracker.exe" /T'
  RMDir /r "$INSTDIR"
  RMDir /r "$APPDATA\employee-work-tracker"
  RMDir /r "$APPDATA\worktracker"
  RMDir /r "$LOCALAPPDATA\employee-work-tracker-updater"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Work Tracker"
!macroend
