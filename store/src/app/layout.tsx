import type { Metadata, Viewport } from 'next';
import { DM_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { readEnv } from '@/server/env';
import './globals.css';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans' });

export function generateMetadata(): Metadata {
  return { title: readEnv().displayName, description: 'Fresh groceries for delivery or pickup.' };
}

export const viewport: Viewport = { themeColor: '#1c4a3c', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
