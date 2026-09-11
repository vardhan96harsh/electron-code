; Custom NSIS Script for Work Tracker
; Ensures clean installation, upgrade, and uninstallation without file-locking errors

!macro customInit
  DetailPrint "Ensuring Work Tracker is closed before installation..."
  nsExec::Exec 'taskkill /F /IM "Work Tracker.exe" /T'
!macroend

!macro customUnInstall
  DetailPrint "Closing Work Tracker before uninstallation..."
  nsExec::Exec 'taskkill /F /IM "Work Tracker.exe" /T'
  Sleep 1000
!macroend
