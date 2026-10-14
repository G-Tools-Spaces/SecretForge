'use client';

import { UserProvider } from '@/lib/useUser';
import { ToastProvider } from '@/components/Toast';
import { ConfirmProvider } from '@/components/Confirm';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <UserProvider>{children}</UserProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
