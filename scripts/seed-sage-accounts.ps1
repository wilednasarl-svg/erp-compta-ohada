<#
  seed-sage-accounts.ps1
  ----------------------------------------------------------------------------
  Crée dans le plan comptable de l'organisation les comptes 8 chiffres (codes
  Sage zéro-paddés) référencés par le fichier d'import, afin que l'import des
  écritures matche EXACTEMENT (plus de `unknown_account`) — sans attendre aucun
  déploiement backend.

  Chaque compte est créé via POST /organizations/:org/chart-of-accounts sous un
  parent SYSCOHADA existant ( `code` commence par `parentCode` et est plus long ).

  ⚠️  Effet de bord : créer un sous-compte sous un compte actuellement POSTING
      le promeut en TITLE (non imputable). Si tu as déjà des écritures sur 4011,
      4452, etc., préfère remapper le fichier vers les codes courts (cf. réponse).

  ── Pré-requis ──────────────────────────────────────────────────────────────
  - $BASE_URL : URL de l'API backend (prod : https://backend-production-44c2.up.railway.app)
  - $TOKEN    : ton JWT d'accès (DevTools → Application → Local Storage →
                clé 'erp-compta-auth/v1' → champ accessToken)
  - $ORG_ID   : l'id de ton organisation (visible dans l'URL ou le store auth)

  ── Usage ───────────────────────────────────────────────────────────────────
    $env:BASE_URL = "https://backend-production-44c2.up.railway.app"
    $env:TOKEN    = "eyJ..."          # ton accessToken
    $env:ORG_ID   = "xxxxxxxx-...."   # ton organizationId
    powershell -ExecutionPolicy Bypass -File scripts/seed-sage-accounts.ps1
#>

$ErrorActionPreference = 'Stop'

$BaseUrl = $env:BASE_URL
$Token   = $env:TOKEN
$OrgId   = $env:ORG_ID

if (-not $BaseUrl -or -not $Token -or -not $OrgId) {
  Write-Host "Définis d'abord BASE_URL, TOKEN et ORG_ID (voir l'en-tête du script)." -ForegroundColor Red
  exit 1
}

# Comptes à créer : { code 8 chiffres ; parent SYSCOHADA existant ; libellé }.
$accounts = @(
  @{ code = '40110000'; parentCode = '4011'; label = 'Fournisseurs locaux' },
  @{ code = '44520000'; parentCode = '4452'; label = 'TVA récupérable sur achats' },
  @{ code = '44540000'; parentCode = '4454'; label = 'TVA récupérable sur services extérieurs' },
  @{ code = '60410000'; parentCode = '6041'; label = 'Achats stockés de matières consommables' },
  @{ code = '60420000'; parentCode = '604';  label = 'Achats de matières et fournitures consommables' },
  @{ code = '60213000'; parentCode = '602';  label = 'Achats de matières premières' },
  @{ code = '62421000'; parentCode = '624';  label = 'Entretien, réparations et maintenance' },
  @{ code = '62780000'; parentCode = '627';  label = 'Publicité, publications, relations publiques' }
)

$uri = "$BaseUrl/organizations/$OrgId/chart-of-accounts"
$headers = @{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/json' }

$created = 0; $skipped = 0; $failed = 0
foreach ($a in $accounts) {
  $body = @{ parentCode = $a.parentCode; code = $a.code; label = $a.label } | ConvertTo-Json -Compress
  try {
    Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body | Out-Null
    Write-Host ("✓ créé   {0}  (parent {1})  {2}" -f $a.code, $a.parentCode, $a.label) -ForegroundColor Green
    $created++
  } catch {
    $msg = $_.ErrorDetails.Message
    if ($msg -and ($msg -match 'CODE_TAKEN' -or $msg -match 'already')) {
      Write-Host ("• existe {0}  — ignoré" -f $a.code) -ForegroundColor DarkGray
      $skipped++
    } else {
      Write-Host ("✗ échec  {0}  → {1}" -f $a.code, $msg) -ForegroundColor Red
      $failed++
    }
  }
}

Write-Host ""
Write-Host ("Terminé : {0} créés, {1} déjà présents, {2} en échec." -f $created, $skipped, $failed) -ForegroundColor Cyan
if ($failed -gt 0) { exit 1 }
