import type { EducationBrowseMode } from './state';

export type EducationBootstrapCommand = {
  type: 'education/bootstrap';
};

export type EducationSetBrowseModeCommand = {
  type: 'education/set-browse-mode';
  mode: EducationBrowseMode;
};

export type EducationSelectLessonCommand = {
  type: 'education/select-lesson';
  lessonId: string;
};

export type EducationSelectTestCommand = {
  type: 'education/select-test';
  testId: string;
};

export type EducationSubmitTestCommand = {
  type: 'education/submit-test';
  testId: string;
  answers: Readonly<Record<string, string>>;
};

export type EducationShowNextHintCommand = {
  type: 'education/show-next-hint';
};

export type EducationDismissHintCommand = {
  type: 'education/dismiss-hint';
};

/** Dev: показать подсказку немедленно (опционально по id). */
export type EducationForceShowHintCommand = {
  type: 'education/force-show-hint';
  hintId?: string;
  /** Показать сразу на графике, минуя pending/задержку. */
  chartSurfaceActive?: boolean;
};

export type EducationHintSchedulerTickCommand = {
  type: 'education/hint-scheduler-tick';
  chartSurfaceActive: boolean;
  nowMs?: number;
};

export type EducationOnChartHintsSurfaceCommand = {
  type: 'education/on-chart-hints-surface';
  active: boolean;
  nowMs?: number;
};

/** Зачёт теста без прохождения (dev / console tests / будущий persistence load). */
export type EducationGrantTestPassCommand = {
  type: 'education/grant-test-pass';
  testId: string;
};

export type EducationCommand =
  | EducationBootstrapCommand
  | EducationSetBrowseModeCommand
  | EducationSelectLessonCommand
  | EducationSelectTestCommand
  | EducationSubmitTestCommand
  | EducationShowNextHintCommand
  | EducationDismissHintCommand
  | EducationForceShowHintCommand
  | EducationHintSchedulerTickCommand
  | EducationOnChartHintsSurfaceCommand
  | EducationGrantTestPassCommand;
