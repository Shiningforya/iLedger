$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot/../.."
Push-Location $root
try {
    $version = Get-Content "native/version.json" | ConvertFrom-Json
    cmake -S native/core -B native/.build/windows-core -A x64
    if ($LASTEXITCODE -ne 0) { throw "CMake configure failed" }
    cmake --build native/.build/windows-core --config Release
    if ($LASTEXITCODE -ne 0) { throw "Native core build failed" }
    dotnet publish native/windows/iLedger.csproj -c Release -r win-x64 -p:Platform=x64 -p:Version=$($version.version) -p:AssemblyVersion="$($version.version).$($version.build)" -p:FileVersion="$($version.version).$($version.build)" -o native/.build/windows-app
    if ($LASTEXITCODE -ne 0) { throw "WinUI build failed" }
} finally { Pop-Location }
