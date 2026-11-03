param([Parameter(Mandatory)]$Jdk,[Parameter(Mandatory)]$Tools,[Parameter(Mandatory)]$Platform,[Parameter(Mandatory)]$KeyStore,[string]$Alias="sff",[Parameter(Mandatory)]$Out,[string]$ServerUrl="")
$ErrorActionPreference='Stop'
$env:JAVA_HOME=(Resolve-Path $Jdk).Path
$env:Path="$env:JAVA_HOME/bin;$env:Path"
$Tools=(Resolve-Path $Tools).Path
$jar=Join-Path (Resolve-Path $Platform).Path 'android.jar'
$stage=Join-Path ([IO.Path]::GetTempPath()) ("sff-build-"+[guid]::NewGuid())
New-Item -ItemType Directory "$stage/classes","$stage/dex" | Out-Null
function check {if($LASTEXITCODE -ne 0){throw "Android build failed ($LASTEXITCODE)"}}
$aapt2=Join-Path $Tools "aapt2"
if(Test-Path (Join-Path $Tools "aapt2.exe")){$aapt2=Join-Path $Tools "aapt2.exe"}
$zipalign=Join-Path $Tools "zipalign"
if(Test-Path (Join-Path $Tools "zipalign.exe")){$zipalign=Join-Path $Tools "zipalign.exe"}
& $aapt2 compile --dir "$PSScriptRoot/res" -o "$stage/res.zip";check
& $aapt2 link -o "$stage/base.apk" -I $jar --manifest "$PSScriptRoot/AndroidManifest.xml" "$stage/res.zip";check
$mainSource=Get-Content "$PSScriptRoot/Main.java" -Raw
if($ServerUrl){if(-not $ServerUrl.StartsWith('https://')){throw 'ServerUrl mora biti HTTPS.'};$mainSource=$mainSource.Replace('__SFF_SERVER_URL__',$ServerUrl.TrimEnd('/'))}
$mainPath=Join-Path $stage 'Main.java';Set-Content -Path $mainPath -Value $mainSource -Encoding UTF8
& "$env:JAVA_HOME/bin/javac" --release 8 -cp $jar -encoding UTF-8 -d "$stage/classes" $mainPath;check
& "$env:JAVA_HOME/bin/jar" cf "$stage/classes.jar" -C "$stage/classes" .;check
& "$env:JAVA_HOME/bin/java" -cp "$Tools/lib/d8.jar" com.android.tools.r8.D8 --min-api 28 --lib $jar --output "$stage/dex" "$stage/classes.jar";check
& "$env:JAVA_HOME/bin/jar" uf "$stage/base.apk" -C "$stage/dex" classes.dex;check
& $zipalign -f 4 "$stage/base.apk" "$stage/aligned.apk";check
& "$env:JAVA_HOME/bin/java" -jar "$Tools/lib/apksigner.jar" sign --ks $KeyStore --ks-key-alias $Alias --ks-pass env:SFF_KEY_PASS --out $Out "$stage/aligned.apk";check
& "$env:JAVA_HOME/bin/java" -jar "$Tools/lib/apksigner.jar" verify --verbose $Out;check
