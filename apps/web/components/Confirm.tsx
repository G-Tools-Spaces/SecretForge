'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal } from '@/components/ui';

interface ConfirmOptions {
  title: string;
  message: string;
  /** Button label (default "Confirm"). */
  confirmLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

/** In-app replacement for window.confirm(): `if (!(await confirm({...}))) return;` */
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    resolver.current?.(false); // a newer dialog supersedes an unanswered one
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <Modal
          title={opts.title}
          onClose={() => settle(false)}
          footer={
            <>
              <button className="btn" onClick={() => settle(false)}>
                Cancel
              </button>
              <button
                className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => settle(true)}
                autoFocus
              >
                {opts.confirmLabel ?? 'Confirm'}
              </button>
            </>
          }
        >
          <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.5 }}>{opts.message}</p>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
