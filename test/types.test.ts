import { describe, expect, it } from 'vitest';

import { ErrorCategory, ProcessorState } from '../src/types';

describe('ProcessorState enum', () => {
  it('Sleep equals 0', () => {
    expect(ProcessorState.Sleep).toBe(0);
  });

  it('Initializing equals 1', () => {
    expect(ProcessorState.Initializing).toBe(1);
  });

  it('Active equals 2', () => {
    expect(ProcessorState.Active).toBe(2);
  });

  it('has exactly 3 numeric members', () => {
    const numericValues = Object.values(ProcessorState).filter((v) => typeof v === 'number');
    expect(numericValues).toHaveLength(3);
  });

  it('numeric values are sequential starting at 0', () => {
    expect(ProcessorState.Sleep).toBeLessThan(ProcessorState.Initializing);
    expect(ProcessorState.Initializing).toBeLessThan(ProcessorState.Active);
  });
});

describe('ErrorCategory enum', () => {
  it('Transient equals "transient"', () => {
    expect(ErrorCategory.Transient).toBe('transient');
  });

  it('Recoverable equals "recoverable"', () => {
    expect(ErrorCategory.Recoverable).toBe('recoverable');
  });

  it('Fatal equals "fatal"', () => {
    expect(ErrorCategory.Fatal).toBe('fatal');
  });

  it('has exactly 3 members', () => {
    expect(Object.keys(ErrorCategory)).toHaveLength(3);
  });

  it('all values are lowercase strings', () => {
    for (const value of Object.values(ErrorCategory)) {
      expect(typeof value).toBe('string');
      expect(value).toBe(value.toLowerCase());
    }
  });
});
