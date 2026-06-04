'use client';

import type { ReactNode } from 'react';

type GameOverlayProps = {
  children: ReactNode;
  onBackdropClick?: () => void;
};

export function GameOverlay({ children, onBackdropClick }: GameOverlayProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onBackdropClick}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-zinc-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
