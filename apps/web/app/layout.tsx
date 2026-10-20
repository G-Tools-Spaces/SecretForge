import type { Metadata } from 'next';
import Script from 'next/script';
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
        {/* Support/chat widget (loads after the page is idle). */}
        <Script
          src="https://widget.ping.gtools.in/widget.js"
          data-bot-id="bot_xtmb96a"
          strategy="lazyOnload"
        />
      </body>
    </html>
  );
}
