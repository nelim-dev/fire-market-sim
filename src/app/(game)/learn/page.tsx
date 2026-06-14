'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { GameWorkspace } from '@/components/game/GameWorkspace';
import { EducationLeftPanel } from '@/components/education/EducationLeftPanel';
import { EducationRightPanel } from '@/components/education/EducationRightPanel';
import { gameLoop } from '@/logic/runners/GameLoop';

function LearnPageContent() {
  const searchParams = useSearchParams();
  const testParam = searchParams.get('test');

  useEffect(() => {
    const lm = gameLoop.getLogicManager();
    lm.dispatchCommand({ type: 'education/bootstrap' });
    if (testParam) {
      lm.dispatchCommand({ type: 'education/set-browse-mode', mode: 'tests' });
      lm.dispatchCommand({ type: 'education/select-test', testId: testParam });
    }
  }, [testParam]);

  return (
    <GameWorkspace
      left={<EducationLeftPanel />}
      right={<EducationRightPanel />}
    />
  );
}

export default function LearnPage() {
  return (
    <Suspense fallback={null}>
      <LearnPageContent />
    </Suspense>
  );
}
