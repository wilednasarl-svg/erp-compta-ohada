import { NullLlmProvider } from '../services/null-llm-provider';

describe('NullLlmProvider', () => {
  const provider = new NullLlmProvider();

  it('exposes a stable id', () => {
    expect(provider.id).toBe('null_v1');
  });

  it('returns null for suggestAccount regardless of input', async () => {
    const result = await provider.suggestAccount({
      description: 'Loyer bureau',
      partner: null,
      side: 'debit',
      historicalSamples: [],
    });
    expect(result).toBeNull();
  });

  it('returns null for detectSemanticAnomaly regardless of input', async () => {
    const result = await provider.detectSemanticAnomaly({
      description: 'Salaire',
      accountCode: '601',
      partner: null,
      amount: 500000,
    });
    expect(result).toBeNull();
  });
});
