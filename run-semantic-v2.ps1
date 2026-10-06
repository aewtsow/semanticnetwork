param(
    [ValidateSet('serve', 'build', 'test')]
    [string]$Action = 'serve',
    [int]$Port = 8765
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$workspaceRoot = Split-Path (Split-Path $projectRoot -Parent) -Parent
$runtimeTemp = Join-Path $workspaceRoot '.codex-tmp/tmp'
New-Item -ItemType Directory -Path $runtimeTemp -Force | Out-Null
$savedVariables = @{}
foreach ($name in @('TEMP','TMP','PYTHONDONTWRITEBYTECODE','OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','PYTHONIOENCODING')) {
    $savedVariables[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
    $env:TEMP = $runtimeTemp
    $env:TMP = $runtimeTemp
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $env:OPENBLAS_NUM_THREADS = '4'
    $env:OMP_NUM_THREADS = '4'
    $env:PYTHONIOENCODING = 'utf-8'
    Push-Location $projectRoot
    try {
        switch ($Action) {
            'serve' { & 'C:\anaconda\envs\codex\python.exe' serve_semantic_v2.py --port $Port }
            'build' { & 'C:\anaconda\envs\codex\python.exe' prepare_semantic_v2.py --all }
            'test' {
                & 'C:\anaconda\envs\codex\python.exe' test_semantic_v2.py
                if ($LASTEXITCODE -ne 0) { throw 'Data regression failed.' }
                node test_semantic_v2.js
                if ($LASTEXITCODE -ne 0) { throw 'Model regression failed.' }
                node test_semantic_restore.js
                if ($LASTEXITCODE -ne 0) { throw 'Interaction regression failed.' }
                node test_pmi_fade.js
            }
        }
        if ($LASTEXITCODE -ne 0) { throw "Semantic command failed: $LASTEXITCODE" }
    } finally { Pop-Location }
} finally {
    foreach ($name in $savedVariables.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedVariables[$name], 'Process')
    }
}
