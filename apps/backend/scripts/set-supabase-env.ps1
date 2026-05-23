# ------------------------------------------------------------------
# set-supabase-env.ps1
#
# Met à jour apps/backend/.env avec la DSN Supabase du projet
# olpmrcifaupxphlrzuxc (région eu-west-3, session pooler port 5432).
#
# Le mot de passe DB est demandé en saisie masquée (Read-Host
# -AsSecureString) : il n'apparaît ni dans l'historique shell ni dans
# le chat. Le fichier .env est déjà ignoré par git.
#
# Usage :
#   pwsh apps/backend/scripts/set-supabase-env.ps1
# ------------------------------------------------------------------

$ErrorActionPreference = 'Stop'

$ProjectRef = 'olpmrcifaupxphlrzuxc'
$Region     = 'eu-west-3'
$Host_      = "aws-0-$Region.pooler.supabase.com"
$User_      = "postgres.$ProjectRef"
$Port       = 5432
$Database   = 'postgres'

$EnvPath = Join-Path $PSScriptRoot '..\.env'
$EnvPath = (Resolve-Path -LiteralPath $EnvPath -ErrorAction SilentlyContinue)?.Path
if (-not $EnvPath) {
    $EnvPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
}

if (-not (Test-Path -LiteralPath $EnvPath)) {
    Write-Error "Fichier .env introuvable : $EnvPath"
    exit 1
}

Write-Host ''
Write-Host 'Configuration Supabase pour le backend' -ForegroundColor Cyan
Write-Host "  Project ref : $ProjectRef"
Write-Host "  Region      : $Region"
Write-Host "  Host        : $Host_"
Write-Host "  Port        : $Port (session pooler)"
Write-Host ''

$SecurePwd = Read-Host -Prompt 'DB password Supabase (saisie masquee)' -AsSecureString
$Bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePwd)
try {
    $PlainPwd = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
}

if ([string]::IsNullOrWhiteSpace($PlainPwd)) {
    Write-Error 'Password vide. Abandon.'
    exit 1
}

$EncodedPwd = [System.Uri]::EscapeDataString($PlainPwd)
$Dsn = "postgresql://${User_}:${EncodedPwd}@${Host_}:${Port}/${Database}"

$Lines = Get-Content -LiteralPath $EnvPath
$NewLines = New-Object System.Collections.Generic.List[string]
$SawDatabaseUrl = $false
$SawDbSsl = $false

foreach ($Line in $Lines) {
    if ($Line -match '^\s*DATABASE_URL=') {
        $NewLines.Add("DATABASE_URL=$Dsn")
        $SawDatabaseUrl = $true
    } elseif ($Line -match '^\s*DB_SSL=') {
        $NewLines.Add('DB_SSL=true')
        $SawDbSsl = $true
    } else {
        $NewLines.Add($Line)
    }
}

if (-not $SawDatabaseUrl) { $NewLines.Add("DATABASE_URL=$Dsn") }
if (-not $SawDbSsl)       { $NewLines.Add('DB_SSL=true') }

# Effacer le password en clair de la memoire des que possible.
$PlainPwd = $null
[System.GC]::Collect()

$NewLines | Set-Content -LiteralPath $EnvPath -Encoding utf8

Write-Host ''
Write-Host "OK : DATABASE_URL et DB_SSL mis a jour dans $EnvPath" -ForegroundColor Green
Write-Host ''
Write-Host 'Verifie ensuite avec :' -ForegroundColor Cyan
Write-Host '  pnpm --filter backend start:dev'
Write-Host '  curl http://localhost:3001/health/db'
Write-Host ''
