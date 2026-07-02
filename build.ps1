$srcDir = "E:\Add-in\blun-vtc-auditoria-v3\src"
$distDir = "E:\Add-in\blun-vtc-auditoria-v3\dist"

If (!(Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

$htmlTemplate = Get-Content -Path "$srcDir\vtc-comparador.html" -Raw
$cssContent = ""
If (Test-Path "$srcDir\css\vtc-comparador.css") {
    $cssContent = Get-Content -Path "$srcDir\css\vtc-comparador.css" -Raw
}

$jsFiles = @(
    "data-manager.js",
    "rule-manager.js",
    "stop-analyzer.js",
    "risk-engine.js",
    "ui.js",
    "main.js"
)

$jsContent = ""
foreach ($file in $jsFiles) {
    $path = "$srcDir\js\$file"
    if (Test-Path $path) {
        $jsContent += "// --- $file ---`n"
        $jsContent += (Get-Content -Path $path -Raw) + "`n`n"
    }
}

$htmlTemplate = $htmlTemplate.Replace('<!-- BUILD_INSERT_CSS -->', "<style>`n$cssContent`n</style>")
$htmlTemplate = $htmlTemplate.Replace('<!-- BUILD_INSERT_JS -->', "<script>`n$jsContent`n</script>")

Set-Content -Path "$distDir\vtc-comparador.html" -Value $htmlTemplate -Encoding UTF8

if (Test-Path "$srcDir\vtc-icon.svg") {
    Copy-Item -Path "$srcDir\vtc-icon.svg" -Destination "$distDir\vtc-icon.svg" -Force
}

Write-Host "Compilación completada exitosamente en dist/vtc-comparador.html"
