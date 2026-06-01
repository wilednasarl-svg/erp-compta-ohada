import {
  agingBucket,
  daysOverdue,
  dunningLevel,
  dunningLevelLabel,
} from '../dunning-rules';

describe('dunning-rules', () => {
  describe('daysOverdue', () => {
    it('compte les jours de retard d\'une échéance passée', () => {
      expect(daysOverdue('2026-05-01', '2026-06-01')).toBe(31);
    });

    it('rend ≤ 0 pour une échéance future ou du jour', () => {
      expect(daysOverdue('2026-06-15', '2026-06-01')).toBe(-14);
      expect(daysOverdue('2026-06-01', '2026-06-01')).toBe(0);
    });

    it('rend null sans échéance ou date invalide', () => {
      expect(daysOverdue(null, '2026-06-01')).toBeNull();
      expect(daysOverdue('', '2026-06-01')).toBeNull();
      expect(daysOverdue('pas-une-date', '2026-06-01')).toBeNull();
    });
  });

  describe('agingBucket', () => {
    it('classe selon les seuils 30/60/90', () => {
      expect(agingBucket(0)).toBe('notDue');
      expect(agingBucket(-5)).toBe('notDue');
      expect(agingBucket(1)).toBe('d1_30');
      expect(agingBucket(30)).toBe('d1_30');
      expect(agingBucket(31)).toBe('d31_60');
      expect(agingBucket(60)).toBe('d31_60');
      expect(agingBucket(61)).toBe('d61_90');
      expect(agingBucket(90)).toBe('d61_90');
      expect(agingBucket(91)).toBe('d90plus');
    });

    it('classe null en noDueDate', () => {
      expect(agingBucket(null)).toBe('noDueDate');
    });
  });

  describe('dunningLevel', () => {
    it('escalade selon le retard maximal', () => {
      expect(dunningLevel(null)).toBe('none');
      expect(dunningLevel(0)).toBe('none');
      expect(dunningLevel(10)).toBe('reminder');
      expect(dunningLevel(15)).toBe('reminder');
      expect(dunningLevel(16)).toBe('first');
      expect(dunningLevel(45)).toBe('first');
      expect(dunningLevel(46)).toBe('second');
      expect(dunningLevel(90)).toBe('second');
      expect(dunningLevel(91)).toBe('formal_notice');
    });
  });

  describe('dunningLevelLabel', () => {
    it('donne un libellé FR par palier', () => {
      expect(dunningLevelLabel('reminder')).toBe('Rappel');
      expect(dunningLevelLabel('formal_notice')).toBe('Mise en demeure');
    });
  });
});
