; 把说明书、练习素材和 Photoshop 插件一起装进安装包，装完在桌面留两个入口。
!macro customInstall
  SetOutPath "$INSTDIR\使用说明"
  File "/oname=字造-零基础图文说明书-长图.png" "F:\dnowload\封面\字造-1.5.0\字造-零基础图文说明书-长图.png"
  File "/oname=字造-练习素材.zip" "F:\dnowload\封面\字造-1.5.0\字造-练习素材.zip"
  File "/oname=字造-Photoshop插件.zip" "F:\dnowload\封面\字造-1.5.0\字造-Photoshop插件.zip"
  File "/oname=先看这里.txt" "F:\dnowload\封面\字造-1.5.0\先看这里.txt"
  SetOutPath "$INSTDIR"
  CreateShortCut "$DESKTOP\字造 图文说明书.lnk" "$INSTDIR\使用说明\字造-零基础图文说明书-长图.png"
  CreateShortCut "$DESKTOP\字造 练习素材.lnk" "$INSTDIR\使用说明\字造-练习素材.zip"
!macroend

!macro customUnInstall
  Delete "$DESKTOP\字造 图文说明书.lnk"
  Delete "$DESKTOP\字造 练习素材.lnk"
!macroend
