import { describe, it, expect } from 'vitest';
import { parseBudget } from '../../src/commands/contracts.js';

describe('mbd contract create --budget', () => {
  it('turns dollars into whole cents, because the API escrows integer credits', () => {
    expect(parseBudget('20')).toBe(2000);
    expect(parseBudget('12.50')).toBe(1250);
    expect(parseBudget('1.01')).toBe(101);
  });

  it('refuses budgets outside $1 to $50 before anything is escrowed (the hackathon float cap)', () => {
    for (const bad of ['0.5', '51', 'ten', '', '-5']) expect(() => parseBudget(bad)).toThrow('--budget');
  });
});
