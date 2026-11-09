// Keyboard shortcut defaults and the rules for changing them. Pure, shared by the screens and the settings service.

export const DEFAULT_COMBOS = {
  'help.open': 'F1',
  'qty.focus': 'F4',
  'customer.focus': 'F2',
  'search.focus': 'Ctrl+F',
  'palette.open': 'Ctrl+K',
  'checkout.open': 'Shift+Enter',
  'pay.cash': 'Enter',
  'pay.card': 'Ctrl+Enter',
  'qty.inc': '+',
  'qty.dec': '-',
  escape: 'Esc',
} as const;

export type ShortcutId = keyof typeof DEFAULT_COMBOS;
export const LETTER_IDS = ['P', 'C', 'S', 'H', 'R', 'I', 'M'] as const;
export type LetterId = (typeof LETTER_IDS)[number];

/** Only what the admin changed. Keys are a ShortcutId, or "letter.P" for a Quick Actions letter. */
export type ShortcutOverrides = Record<string, string>;

export interface Bindings {
  direct: Record<ShortcutId, string>;
  letters: Record<LetterId, string>;
}

export interface ComboKey {
  key: string;
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph']);

/** The name of a key press, as settings store it, e.g. "Ctrl+K". Null for a modifier on its own. */
export function comboOf(k: ComboKey): string | null {
  if (MODIFIERS.has(k.key)) return null;
  const physical = /^Key([A-Z])$/.exec(k.code)?.[1] ?? /^Digit(\d)$/.exec(k.code)?.[1];
  let name: string;
  if (/^[a-zA-Z0-9]$/.test(k.key)) name = k.key.toUpperCase();
  else if (/[^ -~]/.test(k.key) && physical) name = physical; // another layout, e.g. Arabic: use the physical key
  else if (k.key === 'Escape') name = 'Esc';
  else if (k.key === ' ') name = 'Space';
  else name = k.key;
  const symbol = name.length === 1 && !/[A-Z0-9]/.test(name); // + needs Shift on most keyboards; it is still just +
  return [k.ctrl || k.meta ? 'Ctrl' : '', k.alt ? 'Alt' : '', k.shift && !symbol ? 'Shift' : '', name].filter(Boolean).join('+');
}

export function resolveBindings(overrides: ShortcutOverrides): Bindings {
  const direct = { ...DEFAULT_COMBOS } as Record<ShortcutId, string>;
  for (const id of Object.keys(DEFAULT_COMBOS) as ShortcutId[]) if (Object.hasOwn(overrides, id)) direct[id] = overrides[id]!;
  const letters = Object.fromEntries(LETTER_IDS.map((l) => [l, Object.hasOwn(overrides, `letter.${l}`) ? overrides[`letter.${l}`]! : l])) as Record<LetterId, string>;
  return { direct, letters };
}

export const DEFAULT_BINDINGS: Bindings = resolveBindings({});

// Normal editing, closing or reloading the window.
const RESERVED = new Set([
  'Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Ctrl+Shift+V', 'Alt+F4', 'Ctrl+R', 'Ctrl+Shift+R', 'Ctrl+W', 'Ctrl+Q', 'Ctrl+M',
  'Ctrl+Shift+I', 'Ctrl+0', 'Ctrl++', 'Ctrl+-', 'Ctrl+=', 'F11', 'F12',
]);

const BAD_KEY = 'That key is needed for typing or the window. Choose a function key, or Ctrl or Alt with a letter.';

function comboProblem(id: ShortcutId, combo: string): string | null {
  if (combo === DEFAULT_COMBOS[id]) return null;
  if (RESERVED.has(combo)) return BAD_KEY;
  // The same order comboOf writes, so a stored value can always be pressed.
  const m = /^(Ctrl\+)?(Alt\+)?(Shift\+)?(.+)$/.exec(combo);
  if (!m) return BAD_KEY;
  const [, ctrl, alt, shift, key] = m;
  if (ctrl && alt) return BAD_KEY; // AltGr on Windows types characters
  if (/^F([1-9]|1[0-2])$/.test(key!)) return null;
  if ((key === '+' || key === '-') && shift) return BAD_KEY; // comboOf never adds Shift to a symbol
  const typing = /^[A-Z0-9]$/.test(key!) || key === 'Enter' || key === 'Esc' || key === '+' || key === '-';
  return typing && (ctrl || alt) ? null : BAD_KEY;
}

/** Returns what is wrong with a set of changes, or null if it can be saved. */
export function validateOverrides(overrides: ShortcutOverrides): string | null {
  for (const [id, combo] of Object.entries(overrides)) {
    if (id.startsWith('letter.')) {
      if (!(LETTER_IDS as readonly string[]).includes(id.slice(7))) return 'Unknown function.';
      if (!/^[A-Z]$/.test(combo)) return 'Use one letter from A to Z.';
    } else {
      if (!Object.hasOwn(DEFAULT_COMBOS, id)) return 'Unknown function.';
      const problem = comboProblem(id as ShortcutId, combo);
      if (problem) return problem;
    }
  }
  const b = resolveBindings(overrides);
  const combos = Object.values(b.direct);
  if (new Set(combos).size !== combos.length) return 'That key is already used by another function.';
  const letters = Object.values(b.letters);
  if (new Set(letters).size !== letters.length) return 'That letter is already used.';
  return null;
}
