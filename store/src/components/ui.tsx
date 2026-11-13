import type { ButtonHTMLAttributes, InputHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-900 text-white hover:bg-brand-700',
  secondary: 'border border-line bg-surface text-ink-900 hover:bg-surface-soft',
};

export function Button({ variant = 'primary', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={`min-h-11 cursor-pointer rounded-full px-6 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`} {...rest} />;
}

export function Field({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-600">{label}</span>
      <input className="min-h-11 w-full rounded-field bg-surface-soft px-4 placeholder:text-ink-400 focus-visible:outline-2 focus-visible:outline-brand-700" {...rest} />
    </label>
  );
}
