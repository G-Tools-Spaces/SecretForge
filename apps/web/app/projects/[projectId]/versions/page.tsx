'use client';

import { ComingSoonPage } from '@/components/ComingSoonPage';

export default function VersionsPage() {
  return (
    <ComingSoonPage
      title="Versions"
      description="Every secret change is versioned. Browse full version history, diff values, and roll back to any previous version from here."
      icon="versions"
      phase="Phase 6"
    />
  );
}
