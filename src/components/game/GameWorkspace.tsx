import type { ReactNode } from 'react';
import { RightPanelSection } from '@/components/game/RightPanelSection';

/**
 * Двухколоночный каркас: слева и справа независимый вертикальный скролл (min-h-0 + overflow-y-auto).
 */
export function GameWorkspace({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <aside className="min-h-0 w-full flex-1 overflow-y-auto border-b border-zinc-800 bg-zinc-950/95 p-3 sm:p-4 lg:h-full lg:w-[min(38vw,480px)] lg:min-w-[300px] lg:max-w-lg lg:flex-none lg:border-b-0 lg:border-r">
        {left}
      </aside>
      <RightPanelSection>{right}</RightPanelSection>
    </div>
  );
}
