// Keyboard-wedge scanner detection (plan §I).
// A scanner "types" a whole code within a few milliseconds and ends with a suffix key.
// Humans type much slower. Fast bursts ending in the suffix become one scan,
// even if focus is in another input.

export interface ScanBufferOptions {
  maxGapMs: number; // max time between characters of one scan
  minLength: number;
  suffix: 'Enter' | 'Tab';
  duplicateWindowMs: number; // same code again within this window = possible double scan
}

export const DEFAULT_SCAN_OPTIONS: ScanBufferOptions = {
  maxGapMs: 35,
  minLength: 4,
  suffix: 'Enter',
  duplicateWindowMs: 400,
};

export type ScanEvent = { code: string; possibleDuplicate: boolean };

export class ScanBuffer {
  private chars: string[] = [];
  private lastKeyAt = -Infinity;
  private lastScan: { code: string; at: number } | null = null;

  constructor(private readonly opts: ScanBufferOptions = DEFAULT_SCAN_OPTIONS) {}

  /** Feed one key. Returns a scan when a complete code has arrived. */
  key(key: string, at: number): ScanEvent | null {
    const gap = at - this.lastKeyAt;
    this.lastKeyAt = at;
    if (gap > this.opts.maxGapMs) this.chars = [];

    if (key === this.opts.suffix) {
      const code = this.chars.join('');
      this.chars = [];
      if (code.length < this.opts.minLength || gap > this.opts.maxGapMs) return null;
      const possibleDuplicate =
        this.lastScan !== null && this.lastScan.code === code && at - this.lastScan.at <= this.opts.duplicateWindowMs;
      this.lastScan = { code, at };
      return { code, possibleDuplicate };
    }
    if (key.length === 1) this.chars.push(key);
    return null;
  }
}
