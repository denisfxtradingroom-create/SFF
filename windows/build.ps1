param([Parameter(Mandatory)]$Out,[string]$Node=(Get-Command node -ErrorAction SilentlyContinue).Source,[string]$ServerUrl="")
$ErrorActionPreference='Stop'
$Out=[IO.Path]::GetFullPath($Out)
$root=Split-Path $PSScriptRoot
Push-Location $PSScriptRoot
try {
$stage=Join-Path ([IO.Path]::GetTempPath()) ("sff-win-"+[guid]::NewGuid())
mkdir "$stage/payload" -Force | Out-Null
$csc="$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
$vb="$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/Microsoft.VisualBasic.dll"
$iconPath=Join-Path $PSScriptRoot 'mark.ico'
if(-not (Test-Path $iconPath)){
  $iconB64=Join-Path $PSScriptRoot 'mark.ico.b64'
  if(-not (Test-Path $iconB64)){throw 'Nedostaje windows/mark.ico ili windows/mark.ico.b64'}
  $iconPath=Join-Path $stage 'mark.ico'
  [IO.File]::WriteAllBytes($iconPath,[Convert]::FromBase64String((Get-Content $iconB64 -Raw).Trim()))
}
$wv2Dir=Join-Path $PSScriptRoot 'WebView2'
$core=Join-Path $wv2Dir 'Microsoft.Web.WebView2.Core.dll'
$forms=Join-Path $wv2Dir 'Microsoft.Web.WebView2.WinForms.dll'
$loader=Join-Path $wv2Dir 'WebView2Loader.dll'
if(-not ((Test-Path $core) -and (Test-Path $forms) -and (Test-Path $loader))){
  $pkgDir=Join-Path $stage 'webview2-package'
  $pkgZip=Join-Path $stage 'webview2.zip'
  Invoke-WebRequest 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.3650.58' -OutFile $pkgZip
  Expand-Archive -Path $pkgZip -DestinationPath $pkgDir -Force
  $core=(Get-ChildItem $pkgDir -Recurse -Filter 'Microsoft.Web.WebView2.Core.dll' | Where-Object {$_.FullName -match 'net462'} | Select-Object -First 1).FullName
  $forms=(Get-ChildItem $pkgDir -Recurse -Filter 'Microsoft.Web.WebView2.WinForms.dll' | Where-Object {$_.FullName -match 'net462'} | Select-Object -First 1).FullName
  $loader=(Get-ChildItem $pkgDir -Recurse -Filter 'WebView2Loader.dll' | Where-Object {$_.FullName -match 'win-x64|x64'} | Select-Object -First 1).FullName
  if(-not $core -or -not $forms -or -not $loader){throw 'WebView2 DLL fajlovi nisu pronađeni u NuGet paketu.'}
}
$clientSource=Get-Content .\Client.cs -Raw
if($ServerUrl){if(-not $ServerUrl.StartsWith('https://')){throw 'ServerUrl mora biti HTTPS.'};$clientSource=$clientSource.Replace('__SFF_SERVER_URL__',$ServerUrl.TrimEnd('/'))}
$clientPath=Join-Path $stage 'Client.cs';Set-Content -Path $clientPath -Value $clientSource -Encoding UTF8
& $csc /nologo /target:winexe /utf8output /codepage:65001 /win32icon:$iconPath "/r:$vb" /r:System.Windows.Forms.dll /r:System.Drawing.dll /platform:x64 "/r:$core" "/r:$forms" "/out:$stage/payload/SFF.exe" $clientPath
if($LASTEXITCODE){throw 'Launcher compilation failed'}
if(-not $ServerUrl){
  Copy-Item "$root/backend","$root/client" "$stage/payload" -Recurse
  if(Test-Path "$root/NOTICE-Node.txt"){Copy-Item "$root/NOTICE-Node.txt" "$stage/payload"}
  Copy-Item $Node "$stage/payload/node.exe"
  & $Node -p "process.release.name+' '+process.version" | Set-Content "$stage/payload/runtime.txt"
}
Copy-Item $core "$stage/payload/Microsoft.Web.WebView2.Core.dll"
Copy-Item $forms "$stage/payload/Microsoft.Web.WebView2.WinForms.dll"
Copy-Item $loader "$stage/payload/WebView2Loader.dll"
Copy-Item "$PSScriptRoot/WebView2/LICENSE.txt" "$stage/payload/WebView2-LICENSE.txt"
Copy-Item "$PSScriptRoot/WebView2/NOTICE.txt" "$stage/payload/WebView2-NOTICE.txt"
Copy-Item $iconPath "$stage/payload/SFF-Merkat-v3.ico"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory("$stage/payload","$stage/payload.zip")
& $csc /nologo /target:winexe /codepage:65001 /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:Microsoft.CSharp.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /win32icon:$iconPath "/resource:$stage/payload.zip,payload" "/out:$Out" .\Setup.cs
if($LASTEXITCODE){throw 'Installer compilation failed'}
} finally {Pop-Location}
