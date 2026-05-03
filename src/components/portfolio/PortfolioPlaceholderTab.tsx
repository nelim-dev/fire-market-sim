type TabId = 'history' | 'stats';

const copy: Record<TabId, { title: string; body: string }> = {
  history: {
    title: 'История сделок',
    body: 'Здесь появится журнал покупок и продаж после реализации торговли (M4).',
  },
  stats: {
    title: 'Статистика портфеля',
    body: 'Доходность, сравнение с индексом, волатильность — в следующих вехах.',
  },
};

export function PortfolioPlaceholderTab({ tab }: { tab: TabId }) {
  const { title, body } = copy[tab];
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-8 text-center">
      <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
      <p className="mt-3 text-sm text-zinc-400">{body}</p>
    </div>
  );
}
