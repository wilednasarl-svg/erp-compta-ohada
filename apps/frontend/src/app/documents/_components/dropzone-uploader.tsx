'use client';

import { Upload, X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

interface DropzoneUploaderProps {
  readonly file: File | null;
  readonly onFileChange: (file: File | null) => void;
  readonly accept: string;
  readonly maxSizeMb: number;
  readonly disabled?: boolean;
}

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * 1024;

/** Formate une taille d'octets en B / KB / MB lisible. */
function formatSize(bytes: number): string {
  if (bytes < BYTES_PER_KB) {
    return `${bytes} o`;
  }
  if (bytes < BYTES_PER_MB) {
    return `${(bytes / BYTES_PER_KB).toFixed(1)} Ko`;
  }
  return `${(bytes / BYTES_PER_MB).toFixed(1)} Mo`;
}

export function DropzoneUploader({
  file,
  onFileChange,
  accept,
  maxSizeMb,
  disabled = false,
}: DropzoneUploaderProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const maxBytes = maxSizeMb * BYTES_PER_MB;
  const isOversized = file !== null && file.size > maxBytes;

  const openPicker = (): void => {
    if (disabled) {
      return;
    }
    inputRef.current?.click();
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const picked = event.target.files?.[0] ?? null;
    onFileChange(picked);
  };

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) {
      return;
    }
    const picked = event.dataTransfer.files?.[0] ?? null;
    onFileChange(picked);
  };

  const handleDragEnter = (event: React.DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleClear = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    onFileChange(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={openPicker}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={disabled}
        aria-label="Zone de dépôt de fichier : glissez un fichier ou cliquez pour parcourir"
        className={cn(
          'press flex w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-line bg-canvas px-4 py-8 text-center transition-colors duration-fast',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          isDragging && 'border-accent bg-accent-soft',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        {file === null ? (
          <>
            <Upload className="h-4 w-4 text-ink-soft" strokeWidth={1.5} />
            <span className="text-sm text-ink">
              Glissez un fichier ici ou cliquez pour parcourir
            </span>
            <span className="text-xs text-ink-mute">
              PDF, images, Excel/Word, CSV — max {maxSizeMb} Mo
            </span>
          </>
        ) : (
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col text-left">
              <span className="truncate text-sm text-ink">{file.name}</span>
              <span className="font-mono text-xs tabular-nums text-ink-mute">
                {formatSize(file.size)}
              </span>
            </div>
            <button
              type="button"
              onClick={handleClear}
              disabled={disabled}
              aria-label="Retirer le fichier"
              className="press inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xs border border-line bg-paper text-ink-soft transition-colors duration-fast hover:bg-sunk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </button>

      {isOversized && (
        <p className="text-xs text-critical-ink">
          Fichier trop volumineux (max {maxSizeMb} Mo)
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        disabled={disabled}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}
