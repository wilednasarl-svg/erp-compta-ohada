import { AnthropicLlmProvider } from '../services/anthropic-llm-provider';

describe('AnthropicLlmProvider', () => {
  const API_KEY = 'sk-ant-test-key';
  let provider: AnthropicLlmProvider;
  let fetchMock: jest.Mock;
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchMock;
    provider = new AnthropicLlmProvider(API_KEY);
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = originalFetch;
  });

  function mockClaudeOk(text: string): void {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text }],
      }),
    });
  }

  function mockClaude5xx(status = 500): void {
    fetchMock.mockResolvedValueOnce({ ok: false, status });
  }

  describe('suggestAccount', () => {
    it('builds the correct REST call (model, headers, system prompt)', async () => {
      mockClaudeOk(
        JSON.stringify({
          accountCode: '6132',
          confidence: 0.88,
          reasoning: 'Locations immobilières.',
        }),
      );

      await provider.suggestAccount({
        description: 'Loyer bureau Plateau',
        partner: 'SCI ABC',
        side: 'debit',
        historicalSamples: [
          { description: 'Loyer mai', accountCode: '6132', partner: 'SCI ABC' },
        ],
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe(API_KEY);
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['content-type']).toBe('application/json');
      const body = JSON.parse(init.body as string) as {
        model: string;
        max_tokens: number;
        system: string;
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.model).toBe('claude-haiku-4-5-20251001');
      expect(body.max_tokens).toBe(256);
      expect(body.system).toContain('SYSCOHADA');
      expect(body.messages[0].role).toBe('user');
      expect(body.messages[0].content).toContain('Loyer bureau Plateau');
    });

    it('parses a well-formed JSON response and clamps confidence to [0,1]', async () => {
      mockClaudeOk(
        JSON.stringify({
          accountCode: '6132',
          confidence: 1.5, // out of range
          reasoning: 'Locations immobilières.',
        }),
      );
      const result = await provider.suggestAccount({
        description: 'Loyer',
        partner: null,
        side: 'debit',
        historicalSamples: [],
      });
      expect(result).not.toBeNull();
      expect(result!.accountCode).toBe('6132');
      expect(result!.confidence).toBe(1);
    });

    it('strips ```json code fences before parsing', async () => {
      mockClaudeOk(
        '```json\n{"accountCode":"6132","confidence":0.7,"reasoning":"ok"}\n```',
      );
      const result = await provider.suggestAccount({
        description: 'Loyer',
        partner: null,
        side: 'debit',
        historicalSamples: [],
      });
      expect(result).not.toBeNull();
      expect(result!.accountCode).toBe('6132');
    });

    it('returns null on HTTP 500', async () => {
      mockClaude5xx(500);
      const result = await provider.suggestAccount({
        description: 'Loyer',
        partner: null,
        side: 'debit',
        historicalSamples: [],
      });
      expect(result).toBeNull();
    });

    it('returns null when fetch rejects (timeout/abort)', async () => {
      fetchMock.mockRejectedValueOnce(new Error('AbortError'));
      const result = await provider.suggestAccount({
        description: 'Loyer',
        partner: null,
        side: 'debit',
        historicalSamples: [],
      });
      expect(result).toBeNull();
    });

    it('returns null when response is not valid JSON', async () => {
      mockClaudeOk('definitely not json');
      const result = await provider.suggestAccount({
        description: 'Loyer',
        partner: null,
        side: 'debit',
        historicalSamples: [],
      });
      expect(result).toBeNull();
    });

    it('returns null when response is missing required fields', async () => {
      mockClaudeOk(JSON.stringify({ accountCode: '6132' }));
      const result = await provider.suggestAccount({
        description: 'Loyer',
        partner: null,
        side: 'debit',
        historicalSamples: [],
      });
      expect(result).toBeNull();
    });
  });

  describe('detectSemanticAnomaly', () => {
    it('parses a well-formed anomaly response', async () => {
      mockClaudeOk(
        JSON.stringify({
          isAnomaly: true,
          confidence: 0.92,
          reasoning: 'Compte 601 incompatible avec libellé "Salaire".',
        }),
      );
      const result = await provider.detectSemanticAnomaly({
        description: 'Salaire',
        accountCode: '601',
        partner: null,
        amount: 500000,
      });
      expect(result).not.toBeNull();
      expect(result!.isAnomaly).toBe(true);
      expect(result!.confidence).toBeCloseTo(0.92);
      expect(result!.reasoning).toContain('Salaire');
    });

    it('returns null on HTTP 500', async () => {
      mockClaude5xx(503);
      const result = await provider.detectSemanticAnomaly({
        description: 'Salaire',
        accountCode: '601',
        partner: null,
        amount: 500000,
      });
      expect(result).toBeNull();
    });

    it('returns null when isAnomaly is missing', async () => {
      mockClaudeOk(JSON.stringify({ confidence: 0.5, reasoning: 'unsure' }));
      const result = await provider.detectSemanticAnomaly({
        description: 'Salaire',
        accountCode: '601',
        partner: null,
        amount: 500000,
      });
      expect(result).toBeNull();
    });
  });

  it('exposes a stable id including the model name', () => {
    expect(provider.id).toContain('anthropic');
    expect(provider.id).toContain('haiku');
  });
});
