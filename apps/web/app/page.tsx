'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Entry: send logged-in users to /projects, others to /login. */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('sf_access_token');
    const refresh = localStorage.getItem('sf_refresh_token');
    router.push(token || refresh ? '/projects' : '/login');
  }, [router]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="spinner" />
    </div>
  );
}
