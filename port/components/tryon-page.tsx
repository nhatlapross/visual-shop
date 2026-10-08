'use client';

import React from 'react';
import { AIARTryOnStudio } from '@/components/ui/ai-ar-tryon';
import '../explore.css';

export default function TryOnPage() {
  return (
    <div className="tryon-fullscreen-page">
      <AIARTryOnStudio />
    </div>
  );
}
