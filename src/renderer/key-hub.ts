/** Anything that can carry a keydown listener: the window in the app, a fake in tests. */
export interface KeyTarget {
  addEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void, capture: boolean): void;
  removeEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void, capture: boolean): void;
}

type Scanner = (e: KeyboardEvent) => boolean;

/**
 * The app's only global keydown listener. The barcode scanner sees each key first, because a scan must be caught
 * whatever has focus; everything else then goes to one handler. Screens never add window listeners of their own.
 */
export class KeyHub {
  private target: KeyTarget | null = null;
  private scanner: Scanner | null = null;
  private handler: ((e: KeyboardEvent) => void) | null = null;
  private recorder: ((e: KeyboardEvent) => void) | null = null;
  private readonly listener = (e: KeyboardEvent) => this.handle(e);

  attach(target: KeyTarget): void {
    if (this.target === target) return;
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this.listener, true);
  }

  detach(): void {
    this.target?.removeEventListener('keydown', this.listener, true);
    this.target = null;
  }

  setHandler(fn: ((e: KeyboardEvent) => void) | null): void {
    this.handler = fn;
  }

  /** Returns the cleanup. A late cleanup from an older scanner leaves the newer one in place. */
  setScanner(fn: Scanner): () => void {
    this.scanner = fn;
    return () => {
      if (this.scanner === fn) this.scanner = null;
    };
  }

  /** While set, every key goes here and nowhere else (Admin: pressing a new shortcut). Returns the cleanup. */
  setRecorder(fn: (e: KeyboardEvent) => void): () => void {
    this.recorder = fn;
    return () => {
      if (this.recorder === fn) this.recorder = null;
    };
  }

  handle(e: KeyboardEvent): void {
    if (this.recorder) {
      e.preventDefault?.();
      e.stopPropagation?.();
      return this.recorder(e);
    }
    if (this.scanner?.(e)) return;
    this.handler?.(e);
  }
}
