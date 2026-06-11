$dir = "d:\logistix\frontend\pages"
$files = Get-ChildItem -Path $dir -Filter "*.html" -File

foreach ($file in $files) {
    $content = [System.IO.File]::ReadAllText($file.FullName)
    $newContent = [System.Text.RegularExpressions.Regex]::Replace($content, '(?s)\s*<button[^>]*id="modify-dash-btn"[^>]*>.*?</button>', '')
    
    if ($content -ne $newContent) {
        [System.IO.File]::WriteAllText($file.FullName, $newContent, [System.Text.Encoding]::UTF8)
        Write-Host "Updated $($file.Name)"
    }
}
