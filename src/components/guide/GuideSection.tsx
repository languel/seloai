import React from 'react';

/** One section of a guide: a card with a heading, linkable by its id. */
export function GuideSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="rushnyk-card scroll-mt-3 rounded-sm p-3 space-y-2 text-[13px] leading-relaxed">
      <h2 id={`${id}-title`} className="text-base font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The row of section links under a guide's title. */
export function GuideNav({ label, sections }: { label: string; sections: Array<[string, string]> }) {
  return (
    <nav aria-label={label} className="mt-2 flex flex-wrap gap-1 text-[12px]">
      {sections.map(([id, title]) => (
        <a key={id} href={`#${id}`} className="rounded-sm border border-borderFolk bg-surface px-2 py-0.5 hover:border-ink/40">
          {title}
        </a>
      ))}
    </nav>
  );
}
