!macro customInit
  nsExec::Exec 'taskkill /F /IM "Living Wallpaper.exe" /T'
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "Living Wallpaper.exe" /T'
!macroend
