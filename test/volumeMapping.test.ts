import { describe, expect, it } from 'vitest';

import { dBToPercentage, percentageToDB } from '../src/platformAccessory';

describe('percentageToDB — default range (-100 to -20)', () => {
  it('0% maps to floor (-100)', () => {
    expect(percentageToDB(0, -100, -20)).toBe(-100);
  });

  it('100% maps to ceiling (-20)', () => {
    expect(percentageToDB(100, -100, -20)).toBe(-20);
  });

  it('50% maps to midpoint (-60)', () => {
    expect(percentageToDB(50, -100, -20)).toBe(-60);
  });
});

describe('percentageToDB — custom range (-80 to -30)', () => {
  it('0% maps to floor (-80)', () => {
    expect(percentageToDB(0, -80, -30)).toBe(-80);
  });

  it('100% maps to ceiling (-30)', () => {
    expect(percentageToDB(100, -80, -30)).toBe(-30);
  });

  it('50% maps to midpoint (-55)', () => {
    expect(percentageToDB(50, -80, -30)).toBe(-55);
  });
});

describe('percentageToDB — rounding', () => {
  it('rounds correctly for non-integer results', () => {
    // floor=-100, ceiling=-20, range=80. 33% → -100 + 0.33*80 = -100 + 26.4 = -73.6 → -74
    expect(percentageToDB(33, -100, -20)).toBe(-74);
  });
});

describe('percentageToDB — clamping', () => {
  it('clamps percentage below 0 to floor', () => {
    expect(percentageToDB(-10, -100, -20)).toBe(-100);
  });

  it('clamps percentage above 100 to ceiling', () => {
    expect(percentageToDB(110, -100, -20)).toBe(-20);
  });
});

describe('dBToPercentage — default range (-100 to -20)', () => {
  it('floor (-100) maps to 0%', () => {
    expect(dBToPercentage(-100, -100, -20)).toBe(0);
  });

  it('ceiling (-20) maps to 100%', () => {
    expect(dBToPercentage(-20, -100, -20)).toBe(100);
  });

  it('midpoint (-60) maps to 50%', () => {
    expect(dBToPercentage(-60, -100, -20)).toBe(50);
  });
});

describe('dBToPercentage — custom range (-80 to -30)', () => {
  it('floor (-80) maps to 0%', () => {
    expect(dBToPercentage(-80, -80, -30)).toBe(0);
  });

  it('ceiling (-30) maps to 100%', () => {
    expect(dBToPercentage(-30, -80, -30)).toBe(100);
  });

  it('midpoint (-55) maps to 50%', () => {
    expect(dBToPercentage(-55, -80, -30)).toBe(50);
  });
});

describe('dBToPercentage — clamping', () => {
  it('clamps below floor to 0%', () => {
    expect(dBToPercentage(-120, -100, -20)).toBe(0);
  });

  it('clamps above ceiling to 100%', () => {
    expect(dBToPercentage(0, -100, -20)).toBe(100);
  });
});

describe('round-trip consistency', () => {
  const floor = -100;
  const ceiling = -20;

  for (const pct of [0, 25, 50, 75, 100]) {
    it(`dBToPercentage(percentageToDB(${pct}%)) returns ${pct}%`, () => {
      expect(dBToPercentage(percentageToDB(pct, floor, ceiling), floor, ceiling)).toBe(pct);
    });
  }
});
