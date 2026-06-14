'use client';

import type { ReactNode } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { ChartHintToast } from '@/components/education/ChartHintToast';
import { selectEducationHintSchedulingActive } from '@/logic/modules/education/selectors';
import { selectUiChartHintsActive } from '@/logic/modules/uiState/selectors';

/**
 * Правая колонка GameWorkspace: подсказки — в правом верхнем углу панели (не поверх графика).
 */
export function RightPanelSection({ children }: { children: ReactNode }) {
  const schedulingActive = useGameState(selectEducationHintSchedulingActive);
  const chartSurfaceActive = useGameState(selectUiChartHintsActive);

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-900/35 py-4 lg:h-full">
      <ChartHintToast
        schedulingActive={schedulingActive}
        chartSurfaceActive={chartSurfaceActive}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="px-[10%]">{children}</div>
      </div>
    </section>
  );
}
