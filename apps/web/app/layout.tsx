import type { Metadata } from 'next';
import './globals.css';
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'SecretForge',
  description: 'Team secrets vault — centralized env var management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
