!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running CyberCode sidecars..."
  nsExec::ExecToLog 'taskkill /F /T /IM cybercode-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM cybercode-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM cybercode-sidecar.exe'
  Pop $0
  ; Compatibility cleanup for CyberCode releases before v1.1.2.
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar.exe'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping running CyberCode processes..."
  nsExec::ExecToLog 'taskkill /F /T /IM cybercode-desktop.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM cybercode-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM cybercode-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM cybercode-sidecar.exe'
  Pop $0
  ; Compatibility cleanup for CyberCode releases before v1.1.2.
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar.exe'
  Pop $0
  Sleep 1000
!macroend
