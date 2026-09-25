import { TransactionEntryInput, EntryType } from '@pb/types';

export class TransactionCalculator {
  /**
   * Formats a Matka number to a 2-digit string.
   * e.g., 0 -> "00", 1 -> "01", 99 -> "99".
   */
  static formatNumber(val: number): string {
    const clamped = Math.max(0, Math.min(99, Math.floor(val)));
    return clamped.toString().padStart(2, '0');
  }

  /**
   * Generates Crossing (Cross) number combinations.
   * Digits: array of unique digits e.g. [1, 3, 5, 7]
   * withJoda: if true, include 11, 33, 55, 77
   */
  static generateCross(digits: number[], withJoda: boolean, amount: number): TransactionEntryInput[] {
    const uniqueDigits = Array.from(new Set(digits)).filter(d => d >= 0 && d <= 9);
    const results: TransactionEntryInput[] = [];

    for (let i = 0; i < uniqueDigits.length; i++) {
      for (let j = 0; j < uniqueDigits.length; j++) {
        if (!withJoda && i === j) continue;
        const numStr = `${uniqueDigits[i]}${uniqueDigits[j]}`;
        results.push({
          entryType: 'DARA',
          numberValue: numStr,
          amount,
        });
      }
    }

    return results;
  }

  /**
   * Generates From-To series with optional Palti (inversion).
   * e.g., 12 to 14 -> 12, 13, 14.
   * If withPalti is true, also emits 21, 31, 41 (skipping duplicates like 22).
   */
  static generateFromTo(fromNumber: number, toNumber: number, withPalti: boolean, amount: number): TransactionEntryInput[] {
    const numbersSet = new Set<string>();
    const start = Math.max(0, Math.min(fromNumber, toNumber));
    const end = Math.min(99, Math.max(fromNumber, toNumber));

    for (let n = start; n <= end; n++) {
      const formatted = this.formatNumber(n);
      numbersSet.add(formatted);

      if (withPalti) {
        const d1 = formatted[0];
        const d2 = formatted[1];
        if (d1 !== d2) {
          numbersSet.add(`${d2}${d1}`);
        }
      }
    }

    return Array.from(numbersSet).map(num => ({
      entryType: 'DARA',
      numberValue: num,
      amount,
    }));
  }

  /**
   * Generates N random numbers across 00-99.
   */
  static generateRandom(count: number, amount: number): TransactionEntryInput[] {
    const safeCount = Math.min(100, Math.max(1, count));
    const all = Array.from({ length: 100 }, (_, i) => this.formatNumber(i));
    
    // Fisher-Yates shuffle
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }

    return all.slice(0, safeCount).map(num => ({
      entryType: 'DARA',
      numberValue: num,
      amount,
    }));
  }
}
