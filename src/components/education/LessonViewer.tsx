import type { LessonBlock } from '@/data/education/types';

function LessonBlockView({ block }: { block: LessonBlock }) {
  if (block.type === 'paragraph') {
    return <p className="text-sm leading-relaxed text-zinc-300">{block.text}</p>;
  }
  if (block.type === 'bulletList') {
    return (
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-300">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="rounded-lg border border-sky-800/40 bg-sky-950/20 px-4 py-3 text-sm leading-relaxed text-zinc-200">
      <span className="mr-2" aria-hidden>
        {block.emoji}
      </span>
      {block.text}
    </div>
  );
}

export function LessonViewer({
  title,
  subtitle,
  emoji,
  chapters,
}: {
  title: string;
  subtitle?: string;
  emoji?: string;
  chapters: readonly {
    id: string;
    title: string;
    emoji?: string;
    blocks: readonly LessonBlock[];
  }[];
}) {
  return (
    <article className="space-y-8">
      <header className="space-y-2 border-b border-zinc-800 pb-6">
        {emoji ? (
          <p className="text-3xl" aria-hidden>
            {emoji}
          </p>
        ) : null}
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">{title}</h2>
        {subtitle ? <p className="text-sm text-zinc-400">{subtitle}</p> : null}
      </header>

      {chapters.map((chapter) => (
        <section
          key={chapter.id}
          className="space-y-4 border-l-2 border-sky-700/40 pl-5"
        >
          <h3 className="text-lg font-semibold text-zinc-100">
            {chapter.emoji ? (
              <span className="mr-2" aria-hidden>
                {chapter.emoji}
              </span>
            ) : null}
            {chapter.title}
          </h3>
          <div className="space-y-3">
            {chapter.blocks.map((block, i) => (
              <LessonBlockView key={`${chapter.id}-${i}`} block={block} />
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}
