import Link from 'next/link';
import { GameWorkspace } from '@/components/game/GameWorkspace';
import { RightPanelPlaceholder } from '@/components/game/RightPanelPlaceholder';

export default function AchievementsPage() {
  return (
    <GameWorkspace
      left={
        <div className="space-y-4 text-sm text-zinc-400">
          <Link
            href="/"
            className="inline-block text-xs text-sky-500 hover:text-sky-400"
          >
            ← Портфель
          </Link>
          <h1 className="text-lg font-semibold text-zinc-100">Достижения</h1>
          <p>Раздел в разработке.</p>
        </div>
      }
      right={<RightPanelPlaceholder title="Детали достижения" />}
    />
  );
}
