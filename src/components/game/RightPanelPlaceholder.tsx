/**
 * Правая панель: график, карточка инструмента, статистика (ТЗ §6) — позже.
 */
export function RightPanelPlaceholder({
  title = 'Рабочая область',
}: {
  title?: string;
}) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-8 text-center">
      <p className="text-sm font-medium text-zinc-400">{title}</p>
      <p className="mt-2 max-w-md text-xs text-zinc-600">
        Здесь будут график цены, детали выбранного инструмента и статистика
        (раздел 6 спецификации).
      </p>
    </div>
  );
}
