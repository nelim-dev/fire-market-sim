import type { ReactNode } from 'react';

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
      <aside className="min-h-0 w-full flex-1 overflow-y-auto border-b border-zinc-800 bg-zinc-950/95 p-3 sm:p-4 lg:h-full lg:w-[min(32vw,400px)] lg:min-w-[260px] lg:max-w-md lg:flex-none lg:border-b-0 lg:border-r">
        {left}
      </aside>
      <section className="min-h-0 flex-1 overflow-y-auto bg-zinc-900/35 p-4 lg:h-full">
        {right}
      </section>
    </div>
  );
}
