# OCR des factures — PaddleOCR-VL via HuggingFace (gratuit)

Le module `documents` peut extraire le texte des factures (puis les champs
HT/TVA/TTC, n°, date, fournisseur) avec le modèle open-source
**PaddleOCR-VL-1.6**. Le modèle (~1 B params) tourne sur GPU, pas dans le
backend Node : on l'appelle via un **Space HuggingFace Gradio** (ZeroGPU),
donc **aucune infra GPU à héberger**.

## Sélection du moteur OCR

Le binding est piloté par variable d'environnement (voir
`documents.module.ts`, factory `OCR_PROVIDER`) :

| `OCR_ENGINE` | Provider | Usage |
|---|---|---|
| `paddle` | `PaddleOcrVlProvider` | PaddleOCR-VL (meilleure qualité facture) |
| `tesseract` | `TesseractOcrProvider` | OCR local tesseract.js (fallback) |
| `none` (ou absent) | `NullOcrProvider` | OCR désactivé |

`OCR_ENABLED=true` (héritage) reste équivalent à `tesseract`.

## Variables d'environnement (mode `paddle`)

```bash
OCR_ENGINE=paddle
HF_TOKEN=hf_xxx                       # token HuggingFace (read) — améliore le quota
PADDLE_OCR_SPACE=PaddlePaddle/PaddleOCR-VL-1.6_Online_Demo   # ou ton duplicata privé
PADDLE_OCR_ENDPOINT=/parse_doc        # à confirmer via l'onglet "Use via API" du Space
PADDLE_OCR_TIMEOUT_MS=120000          # budget par appel (cold-start GPU inclus)
```

## Dépendance

```bash
pnpm --filter backend add @gradio/client
```

Déclarée en `optionalDependencies` : si absente, le provider renvoie `null`
(OCR `skipped`) sans casser le build ni l'upload.

## Deux montages possibles

1. **100 % gratuit, moins privé** — appeler le Space **public** officiel
   avec ton `HF_TOKEN` (quota plus large qu'en anonyme). Les factures
   transitent par l'infra HF partagée → à éviter pour des données
   sensibles en volume.
2. **Privé** — dupliquer le Space sous ton compte en **privé** sur
   ZeroGPU. La confidentialité est meilleure, mais ZeroGPU sur un Space
   privé requiert en général un compte **HF PRO** (~9 $/mois).

## Limites connues

- **Quota ZeroGPU** : ~300 s/jour en accès programmatique → quelques
  dizaines de factures/jour. Au-delà : pointer `PADDLE_OCR_SPACE` vers un
  Inference Endpoint payant exposant la même API Gradio (zéro changement
  de code).
- **PDF non géré** : le Space attend une image. Les PDF renvoient `null`
  (`ocr_status='skipped'`). Rastériser la 1ʳᵉ page d'un PDF est un suivi.
- **Confidence** : heuristique (le Space ne renvoie pas de score par
  token) — `0.85` si résultat non vide, `0` sinon.
