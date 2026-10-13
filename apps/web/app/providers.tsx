'use client';

import { UserProvider } from '@/lib/useUser';
import { ToastProvider } from '@/components/Toast';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <UserProvider>{children}</UserProvider>
    </ToastProvider>
  );
}
