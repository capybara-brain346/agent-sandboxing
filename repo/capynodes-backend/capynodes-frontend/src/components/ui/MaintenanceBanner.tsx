'use client';

import { AlertTriangle } from 'lucide-react';

export function MaintenanceBanner() {
  return (
    <div className="fixed top-0 left-0 right-0 z-[120] bg-amber-500 text-white px-4 py-3 shadow-md">
      <div className="flex items-center justify-center gap-2 text-sm font-medium">
        <AlertTriangle size={16} className="flex-shrink-0" />
        <span>We're currently performing maintenance. Some features may be unavailable.</span>
      </div>
    </div>
  );
}
