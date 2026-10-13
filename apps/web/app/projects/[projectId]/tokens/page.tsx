'use client';

import { ComingSoonPage } from '@/components/ComingSoonPage';

export default function TokensPage() {
  return (
    <ComingSoonPage
      title="Service tokens"
      description="Read-only tokens scoped to a single environment for CI and servers — expiring and revocable. Create and manage them from here."
      icon="tokens"
      phase="Phase 6"
    />
  );
}
