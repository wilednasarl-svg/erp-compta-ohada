'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type DocumentCategory =
  | 'all'
  | 'pdf'
  | 'image'
  | 'spreadsheet'
  | 'document'
  | 'other';

export type OcrStatusFilter =
  | 'all'
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'skipped';

interface DocumentFiltersProps {
  readonly category: DocumentCategory;
  readonly onCategoryChange: (c: DocumentCategory) => void;
  readonly ocrStatus: OcrStatusFilter;
  readonly onOcrStatusChange: (s: OcrStatusFilter) => void;
  readonly uploadedFrom: string; // 'YYYY-MM-DD' or ''
  readonly onUploadedFromChange: (v: string) => void;
  readonly uploadedTo: string; // 'YYYY-MM-DD' or ''
  readonly onUploadedToChange: (v: string) => void;
  readonly onReset: () => void;
  readonly activeCount: number;
}

interface CategoryOption {
  readonly value: DocumentCategory;
  readonly label: string;
}

const CATEGORY_OPTIONS: readonly CategoryOption[] = [
  { value: 'all', label: 'Tous' },
  { value: 'pdf', label: 'PDF' },
  { value: 'image', label: 'Images' },
  { value: 'spreadsheet', label: 'Tableurs' },
  { value: 'document', label: 'Documents' },
  { value: 'other', label: 'Autres' },
];

interface OcrStatusOption {
  readonly value: OcrStatusFilter;
  readonly label: string;
}

const OCR_STATUS_OPTIONS: readonly OcrStatusOption[] = [
  { value: 'all', label: 'Tous statuts' },
  { value: 'pending', label: 'En attente' },
  { value: 'processing', label: 'OCR en cours' },
  { value: 'processed', label: 'OCR terminé' },
  { value: 'failed', label: 'OCR échoué' },
  { value: 'skipped', label: 'OCR ignoré' },
];

export function DocumentFilters({
  category,
  onCategoryChange,
  ocrStatus,
  onOcrStatusChange,
  uploadedFrom,
  onUploadedFromChange,
  uploadedTo,
  onUploadedToChange,
  onReset,
  activeCount,
}: DocumentFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Category segmented control */}
      <div className="space-y-1">
        <span className="eyebrow text-ink-mute">Catégorie</span>
        <div className="flex flex-wrap gap-1">
          {CATEGORY_OPTIONS.map((option) => {
            const isActive = option.value === category;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => onCategoryChange(option.value)}
                className={cn(
                  'press rounded-xs border px-2.5 py-1 text-xs transition-colors duration-fast',
                  isActive
                    ? 'border-accent bg-accent-soft text-accent-ink'
                    : 'border-line bg-canvas text-ink-soft hover:border-accent',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* OCR status select */}
      <div className="space-y-1">
        <Label htmlFor="doc-filter-ocr" className="eyebrow text-ink-mute">
          Statut OCR
        </Label>
        <select
          id="doc-filter-ocr"
          value={ocrStatus}
          onChange={(event) =>
            onOcrStatusChange(event.target.value as OcrStatusFilter)
          }
          className="h-10 rounded-xs border border-line bg-paper px-3 text-sm text-ink"
        >
          {OCR_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Date range: from */}
      <div className="space-y-1">
        <Label htmlFor="doc-filter-from" className="eyebrow text-ink-mute">
          Du
        </Label>
        <Input
          id="doc-filter-from"
          type="date"
          value={uploadedFrom}
          onChange={(event) => onUploadedFromChange(event.target.value)}
          className="rounded-xs border-line bg-paper"
        />
      </div>

      {/* Date range: to */}
      <div className="space-y-1">
        <Label htmlFor="doc-filter-to" className="eyebrow text-ink-mute">
          Au
        </Label>
        <Input
          id="doc-filter-to"
          type="date"
          value={uploadedTo}
          onChange={(event) => onUploadedToChange(event.target.value)}
          className="rounded-xs border-line bg-paper"
        />
      </div>

      {/* Reset button */}
      {activeCount > 0 ? (
        <button
          type="button"
          onClick={onReset}
          className="press h-10 rounded-xs px-2 text-sm text-ink-soft transition-colors duration-fast hover:text-accent-ink"
        >
          Réinitialiser ({activeCount})
        </button>
      ) : null}
    </div>
  );
}
