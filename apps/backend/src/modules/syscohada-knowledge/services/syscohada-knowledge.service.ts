import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

export const SYSCOHADA_KNOWLEDGE_OPTIONS = Symbol('SYSCOHADA_KNOWLEDGE_OPTIONS');

export type SyscohadaDomain =
  | 'accounting-plan'
  | 'journals'
  | 'assets'
  | 'inventory'
  | 'tva'
  | 'reports'
  | 'ai';

export interface SyscohadaKnowledgeOptions {
  readonly sourcesDir?: string;
}

export interface SyscohadaCitation {
  readonly tome: number;
  readonly sourceTitle: string;
  readonly sourceFile: string;
  readonly lineStart: number;
  readonly lineEnd: number;
}

export interface SyscohadaSearchResult extends SyscohadaCitation {
  readonly excerpt: string;
  readonly score: number;
}

export interface SyscohadaAnswer {
  readonly answer: string;
  readonly citations: ReadonlyArray<SyscohadaCitation>;
}

export interface SyscohadaDomainReference {
  readonly domain: SyscohadaDomain;
  readonly tome: number;
  readonly topic: string;
  readonly keywords: ReadonlyArray<string>;
}

interface KnowledgeChunk extends SyscohadaSearchResult {
  readonly normalised: string;
}

const DOMAIN_REFERENCES: ReadonlyArray<SyscohadaDomainReference> = [
  {
    domain: 'accounting-plan',
    tome: 1,
    topic: 'Plan comptable, classes de comptes et subdivisions SYSCOHADA',
    keywords: ['compte', 'classe', 'plan comptable', 'subdivision', 'pcg'],
  },
  {
    domain: 'journals',
    tome: 1,
    topic: 'Tenue comptable, livre-journal, grand-livre, lettrage et écritures',
    keywords: ['journal', 'grand livre', 'lettrage', 'ecriture', 'debit', 'credit'],
  },
  {
    domain: 'assets',
    tome: 1,
    topic: 'Immobilisations, amortissements, cessions et dépréciations',
    keywords: ['immobilisation', 'amortissement', 'cession', 'depreciation', 'base amortissable'],
  },
  {
    domain: 'inventory',
    tome: 1,
    topic: 'Stocks, inventaire permanent/intermittent, coût et dépréciation',
    keywords: ['stock', 'inventaire', 'cout', 'marchandise', 'depreciation'],
  },
  {
    domain: 'tva',
    tome: 2,
    topic: 'Opérations fiscales, taxes, régularisations et traitements spécifiques',
    keywords: ['tva', 'taxe', 'impot', 'fiscal', 'regularisation'],
  },
  {
    domain: 'reports',
    tome: 3,
    topic: 'États financiers annuels, DSF, bilan, compte de résultat, TFT et notes annexes',
    keywords: ['bilan', 'resultat', 'tft', 'flux', 'dsf', 'note', 'etat financier'],
  },
  {
    domain: 'ai',
    tome: 3,
    topic: 'Assistance métier et réponses sourcées sur le référentiel SYSCOHADA',
    keywords: ['syscohada', 'ohada', 'guide', 'doctrine', 'referentiel'],
  },
];

@Injectable()
export class SyscohadaKnowledgeService {
  private readonly logger = new Logger(SyscohadaKnowledgeService.name);
  private chunks: KnowledgeChunk[] | null = null;

  constructor(
    @Optional()
    @Inject(SYSCOHADA_KNOWLEDGE_OPTIONS)
    private readonly options: SyscohadaKnowledgeOptions = {},
  ) {}

  getSupportedDomains(): SyscohadaDomain[] {
    return [...new Set(DOMAIN_REFERENCES.map((r) => r.domain))];
  }

  getDomainReferences(domain: SyscohadaDomain): SyscohadaDomainReference[] {
    return DOMAIN_REFERENCES.filter((r) => r.domain === domain);
  }

  async answerQuestion(input: {
    readonly query: string;
    readonly domain?: SyscohadaDomain;
    readonly limit?: number;
  }): Promise<SyscohadaAnswer | null> {
    const results = await Promise.resolve(this.search(input));
    if (results.length === 0) return null;
    const citations = results.map(({ tome, sourceTitle, sourceFile, lineStart, lineEnd }) => ({
      tome,
      sourceTitle,
      sourceFile,
      lineStart,
      lineEnd,
    }));
    const body = results
      .map((r, i) => `Source ${i + 1} - Tome ${r.tome}: ${r.excerpt}`)
      .join('\n\n');
    return {
      answer:
        `Voici les éléments du Guide d'application SYSCOHADA correspondant à la question :\n\n` +
        body,
      citations,
    };
  }

  search(input: {
    readonly query: string;
    readonly domain?: SyscohadaDomain;
    readonly limit?: number;
  }): SyscohadaSearchResult[] {
    const queryTokens = this.tokens(input.query);
    if (queryTokens.length === 0) return [];
    const domainTokens = input.domain
      ? this.getDomainReferences(input.domain).flatMap((r) =>
          r.keywords.flatMap((k) => this.tokens(k)),
        )
      : [];

    return this.loadChunks()
      .map((chunk) => ({
        ...chunk,
        score: this.score(chunk.normalised, queryTokens, domainTokens),
      }))
      .filter((chunk) => chunk.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit ?? 3)
      .map(({ normalised: _normalised, ...chunk }) => chunk);
  }

  private loadChunks(): KnowledgeChunk[] {
    if (this.chunks) return this.chunks;
    const sourcesDir = this.resolveSourcesDir();
    if (!sourcesDir) {
      this.logger.warn(
        'SYSCOHADA sources not found. Expected .local/sources or SYSCOHADA_KNOWLEDGE_DIR.',
      );
      this.chunks = [];
      return this.chunks;
    }

    const files = readdirSync(sourcesDir)
      .filter((file) => /\.pdf\.\d+-end\.txt$/i.test(file))
      .sort();
    this.chunks = files.flatMap((file) =>
      this.chunkFile(join(sourcesDir, file), file, this.tomeFromFile(file)),
    );
    return this.chunks;
  }

  private chunkFile(path: string, file: string, tome: number): KnowledgeChunk[] {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    const chunks: KnowledgeChunk[] = [];
    const windowSize = 32;
    const overlap = 6;
    for (let start = 0; start < lines.length; start += windowSize - overlap) {
      const slice = lines.slice(start, start + windowSize);
      const text = slice
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ');
      if (text.length < 80) continue;
      chunks.push({
        tome,
        sourceTitle: this.titleFromFile(file),
        sourceFile: file,
        lineStart: start + 1,
        lineEnd: Math.min(lines.length, start + windowSize),
        excerpt: this.compact(text).slice(0, 850),
        score: 0,
        normalised: this.normalise(text),
      });
    }
    return chunks;
  }

  private resolveSourcesDir(): string | null {
    const explicit = this.options.sourcesDir ?? process.env.SYSCOHADA_KNOWLEDGE_DIR;
    if (explicit && existsSync(explicit)) return resolve(explicit);

    let current = process.cwd();
    for (let i = 0; i < 6; i += 1) {
      const candidate = join(current, '.local', 'sources');
      if (existsSync(candidate)) return candidate;
      const parent = resolve(current, '..');
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  private score(
    text: string,
    queryTokens: ReadonlyArray<string>,
    domainTokens: ReadonlyArray<string>,
  ): number {
    let score = 0;
    for (const token of queryTokens) {
      if (text.includes(token)) score += token.length >= 5 ? 3 : 1;
    }
    for (const token of domainTokens) {
      if (text.includes(token)) score += 1;
    }
    return score;
  }

  private tokens(text: string): string[] {
    return [
      ...new Set(
        this.normalise(text)
          .split(/\s+/)
          .filter((t) => t.length >= 3),
      ),
    ];
  }

  private normalise(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private compact(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private tomeFromFile(file: string): number {
    const match = file.match(/REVISE\s+(\d)/i);
    return match ? Number(match[1]) : 0;
  }

  private titleFromFile(file: string): string {
    return basename(file)
      .replace(/\.pdf\.\d+-end\.txt$/i, '')
      .replace(/_/g, ' ');
  }
}
