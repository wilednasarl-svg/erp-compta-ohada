import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Démonte le DOM rendu entre chaque test pour éviter les fuites de portails
// (popover, calendrier) d'un test à l'autre.
afterEach(() => {
  cleanup();
});
