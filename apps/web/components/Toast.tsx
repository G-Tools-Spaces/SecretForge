'use client';

import { createContext, useCallback, useContext, useState } from 'react';

interface ToastCtx {
  show: (message: string, type?: 'info' | 'error') => void;
}

const ToastContext = createContext<ToastCtx>({ show: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: string }>>([]);

  const show = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type === 'error' ? 'error' : ''}`}>
          {t.type === 'error' ? '⚠ ' : ''}
          {t.message}
        </div>
      ))}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
