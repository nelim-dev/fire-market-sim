'use client';

import { useGameState } from '@/hooks/useGameState';
import {
  selectEducationBrowseMode,
  selectEducationSelectedLesson,
  selectEducationSelectedTest,
} from '@/logic/modules/education/selectors';
import { getTestCatalogEntry } from '@/data/education/catalog';
import { LessonViewer } from './LessonViewer';
import { TestViewer } from './TestViewer';
import { RightPanelPlaceholder } from '@/components/game/RightPanelPlaceholder';

export function EducationRightPanel() {
  const browseMode = useGameState(selectEducationBrowseMode);
  const lesson = useGameState(selectEducationSelectedLesson);
  const test = useGameState(selectEducationSelectedTest);

  if (browseMode === 'lessons') {
    if (!lesson) {
      return <RightPanelPlaceholder title="Выберите лекцию слева" />;
    }
    return (
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <LessonViewer
          title={lesson.title}
          subtitle={lesson.subtitle}
          emoji={lesson.emoji}
          chapters={lesson.chapters}
        />
      </div>
    );
  }

  if (!test) {
    return <RightPanelPlaceholder title="Выберите тест слева" />;
  }

  const catalogEntry = getTestCatalogEntry(test.id);
  if (catalogEntry && !catalogEntry.available) {
    return <RightPanelPlaceholder title={`${catalogEntry.title} — скоро`} />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <TestViewer testId={test.id} title={test.title} description={test.description} />
    </div>
  );
}
