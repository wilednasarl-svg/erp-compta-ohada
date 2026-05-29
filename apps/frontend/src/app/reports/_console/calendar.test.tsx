import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Calendar } from './calendar';

const cell = (container: HTMLElement, iso: string): HTMLElement => {
  const el = container.querySelector<HTMLElement>(`[data-iso="${iso}"]`);
  if (!el) throw new Error(`cellule ${iso} introuvable`);
  return el;
};

describe('Calendar — mode single', () => {
  it('affiche le mois de la date ancre', () => {
    render(<Calendar mode="single" selected="2026-05-15" onSelect={vi.fn()} />);
    expect(screen.getByText(/mai 2026/i)).toBeInTheDocument();
  });

  it('sélectionne le jour cliqué', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Calendar mode="single" selected="2026-05-15" onSelect={onSelect} />,
    );
    await userEvent.click(cell(container, '2026-05-20'));
    expect(onSelect).toHaveBeenCalledWith('2026-05-20');
  });

  it('navigue au clavier (flèche droite) puis sélectionne avec Entrée (AC-P5)', () => {
    const onSelect = vi.fn();
    render(<Calendar mode="single" selected="2026-05-15" onSelect={onSelect} />);
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('2026-05-16');
  });

  it('descend d’une semaine avec la flèche bas (+7 jours)', () => {
    const onSelect = vi.fn();
    render(<Calendar mode="single" selected="2026-05-15" onSelect={onSelect} />);
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('2026-05-22');
  });

  it('bascule de mois via les boutons de navigation', async () => {
    render(<Calendar mode="single" selected="2026-05-15" onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Mois suivant' }));
    expect(screen.getByText(/juin 2026/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mois précédent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mois précédent' }));
    expect(screen.getByText(/avril 2026/i)).toBeInTheDocument();
  });
});

describe('Calendar — mode range (AC-P6)', () => {
  it('clic d’une date haute après une borne basse produit une plage ordonnée', async () => {
    const onRangeChange = vi.fn();
    const { container } = render(
      <Calendar mode="range" start="2026-05-10" end="" onRangeChange={onRangeChange} />,
    );
    await userEvent.click(cell(container, '2026-05-20'));
    expect(onRangeChange).toHaveBeenCalledWith({ start: '2026-05-10', end: '2026-05-20' });
  });

  it('ordonne la plage si la 2e date est antérieure à la borne basse', async () => {
    const onRangeChange = vi.fn();
    const { container } = render(
      <Calendar mode="range" start="2026-05-10" end="" onRangeChange={onRangeChange} />,
    );
    await userEvent.click(cell(container, '2026-05-05'));
    expect(onRangeChange).toHaveBeenCalledWith({ start: '2026-05-05', end: '2026-05-10' });
  });

  it('surligne les jours strictement compris dans la plage', () => {
    const { container } = render(
      <Calendar mode="range" start="2026-05-10" end="2026-05-20" onRangeChange={vi.fn()} />,
    );
    expect(cell(container, '2026-05-15').className).toContain('bg-accent-soft');
    // Les bornes sont « selected », pas « ranged ».
    expect(cell(container, '2026-05-10').getAttribute('aria-selected')).toBe('true');
    expect(cell(container, '2026-05-20').getAttribute('aria-selected')).toBe('true');
  });

  it('repart sur une nouvelle borne basse quand une plage complète existe', async () => {
    const onRangeChange = vi.fn();
    const { container } = render(
      <Calendar mode="range" start="2026-05-10" end="2026-05-20" onRangeChange={onRangeChange} />,
    );
    await userEvent.click(cell(container, '2026-05-25'));
    expect(onRangeChange).toHaveBeenCalledWith({ start: '2026-05-25', end: '' });
  });
});
