; 字造 Photoshop 面板安装包
;
; 只做一件事：把 com.zizao.title-studio 放进用户的 CEP 扩展目录，并打开
; CSXS.12 的 PlayerDebugMode（未签名的 CEP 面板必需）。不写系统字体、不动
; 已安装的 Photoshop 文件、不碰工程文件。
;
; 卸载时删掉扩展目录，并把 PlayerDebugMode 还原成安装前的值。
;
; 编译参数：PAYLOAD（com.zizao.title-studio 所在目录）、OUTFILE、VERSION、
; VERSION4、README。

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
Name "字造 Photoshop 面板"
OutFile "${OUTFILE}"
InstallDir "$APPDATA\Adobe\CEP\extensions"
ShowInstDetails show
ShowUninstDetails show
BrandingText "字造 面板安装包 ${VERSION}"

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "打开安装位置"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION OpenInstallFolder
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${VERSION4}"
VIAddVersionKey /LANG=2052 "ProductName" "字造 Photoshop 面板"
VIAddVersionKey /LANG=2052 "FileDescription" "字造 Photoshop 面板安装包"
VIAddVersionKey /LANG=2052 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "字造"

Var PreviousDebugValue
Var PreviousDebugKind

Function .onInit
  ; 记住安装前的 PlayerDebugMode，卸载时按原样还原
  ClearErrors
  ReadRegStr $PreviousDebugValue HKCU "Software\Adobe\CSXS.12" "PlayerDebugMode"
  ${If} ${Errors}
    StrCpy $PreviousDebugKind "absent"
    StrCpy $PreviousDebugValue ""
  ${Else}
    StrCpy $PreviousDebugKind "string"
  ${EndIf}
FunctionEnd

Function OpenInstallFolder
  ExecShell "open" "$INSTDIR\com.zizao.title-studio"
FunctionEnd

Section "面板扩展" SEC_EXTENSION
  SectionIn RO
  SetOutPath "$INSTDIR\com.zizao.title-studio"
  File /r "${PAYLOAD}\*.*"
  !if "${README}" != ""
    SetOutPath "$INSTDIR\com.zizao.title-studio"
    File /oname=字造面板说明.md "${README}"
  !endif

  ; 未签名 CEP 面板需要这一项
  WriteRegStr HKCU "Software\Adobe\CSXS.12" "PlayerDebugMode" "1"

  ; 卸载程序读不到 $INSTDIR（静默卸载时它可能是空的），所以把路径和还原信息
  ; 都写进注册表，卸载时按记录来。
  WriteRegStr HKCU "Software\Zizao\PhotoshopPanel" "InstallDir" "$INSTDIR\com.zizao.title-studio"
  WriteRegStr HKCU "Software\Zizao\PhotoshopPanel" "Version" "${VERSION}"
  WriteRegStr HKCU "Software\Zizao\PhotoshopPanel" "PreviousDebugKind" "$PreviousDebugKind"
  WriteRegStr HKCU "Software\Zizao\PhotoshopPanel" "PreviousDebugValue" "$PreviousDebugValue"

  ; 同一份信息也留在目录里，方便人工核对
  WriteINIStr "$INSTDIR\com.zizao.title-studio\.zizao-install.ini" state PreviousDebugKind "$PreviousDebugKind"
  WriteINIStr "$INSTDIR\com.zizao.title-studio\.zizao-install.ini" state PreviousDebugValue "$PreviousDebugValue"
  WriteINIStr "$INSTDIR\com.zizao.title-studio\.zizao-install.ini" state Version "${VERSION}"

  WriteUninstaller "$INSTDIR\com.zizao.title-studio\卸载字造面板.exe"
SectionEnd

Section "Uninstall"
  ReadRegStr $2 HKCU "Software\Zizao\PhotoshopPanel" "InstallDir"
  ReadRegStr $0 HKCU "Software\Zizao\PhotoshopPanel" "PreviousDebugKind"
  ReadRegStr $1 HKCU "Software\Zizao\PhotoshopPanel" "PreviousDebugValue"

  ${If} $2 == ""
    ; 兜底：安装时没写注册表，就按卸载程序所在目录推断
    StrCpy $2 "$EXEDIR"
  ${EndIf}

  RMDir /r "$2"
  DeleteRegKey HKCU "Software\Zizao\PhotoshopPanel"

  ${If} $0 == "absent"
    DeleteRegValue HKCU "Software\Adobe\CSXS.12" "PlayerDebugMode"
  ${ElseIf} $0 == "string"
    WriteRegStr HKCU "Software\Adobe\CSXS.12" "PlayerDebugMode" "$1"
  ${EndIf}
SectionEnd
