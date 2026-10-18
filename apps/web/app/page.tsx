'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, Me } from '@/lib/api';

/** Entry: send logged-in users to /projects, others to /login. */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Credentials are httpOnly cookies (invisible to JS), so ask the API who
    // we are — api() silently refreshes the session when only the refresh
    // cookie remains.
    api<Me>('/auth/me')
      .then(() => router.push('/projects'))
      .catch(() => router.push('/login'));
  }, [router]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="spinner" />
    </div>
  );
}
