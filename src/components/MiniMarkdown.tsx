import React from 'react';

/**
 * Just enough Markdown for chat replies: paragraphs, line breaks, headings, bullet and numbered
 * lists, tables, **bold**, *italic*, `code` and [links](https://…). Builds React elements directly (no
 * HTML strings), so model output can never inject markup. Half-written syntax while a reply is
 * still streaming simply shows as text until it closes.
 */

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: string[]; start: number }
  | { kind: 'table'; head: string[]; align: Array<'left' | 'center' | 'right'>; rows: string[][] };

const BULLET = /^\s*[-*+•]\s+(.*)$/;
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,4})\s+(.*?)\s*#*\s*$/;
/** The line under a table's header: | --- | :--: | ---: | */
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** A table row's cells; a pipe inside `code` or escaped as \| stays in its cell. */
export function tableCells(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inCode = false;
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (ch === '`') {
      inCode = !inCode;
      cell += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', lines: para });
    para = [];
  };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    // A table: a row with pipes, then a rule line, then rows until a line without a pipe.
    if (line.includes('|') && TABLE_RULE.test(lines[i + 1] ?? '') && (lines[i + 1] ?? '').includes('-')) {
      flush();
      const head = tableCells(line);
      const align = tableCells(lines[i + 1]).map((c): 'left' | 'center' | 'right' => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const cells = tableCells(lines[i]);
        rows.push(head.map((_, c) => cells[c] ?? ''));
        i++;
      }
      i--;
      blocks.push({ kind: 'table', head, align, rows });
      continue;
    }
    const h = HEADING.exec(line);
    const b = BULLET.exec(line);
    const n = NUMBER.exec(line);
    const last = blocks[blocks.length - 1];
    if (h) {
      flush();
      blocks.push({ kind: 'h', level: h[1].length, text: h[2] });
    } else if (b) {
      flush();
      if (last?.kind === 'ul' && !para.length) last.items.push(b[1]);
      else blocks.push({ kind: 'ul', items: [b[1]], start: 1 });
    } else if (n) {
      flush();
      if (last?.kind === 'ol') last.items.push(n[2]);
      else blocks.push({ kind: 'ol', items: [n[2]], start: Number(n[1]) || 1 });
    } else if ((last?.kind === 'ul' || last?.kind === 'ol') && !para.length && /^\s{2,}\S/.test(raw)) {
      // An indented line continues the list item above it.
      last.items[last.items.length - 1] += ` ${line.trim()}`;
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

// Inline: code first (its contents stay literal), then links, bold, italic.
const INLINE = /(`[^`\n]+`)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\4|(\*|_)(?=\S)([^*_\n]+?)(?<=\S)\6(?![\w*])/g;

export function renderInline(text: string, keyBase = 'i'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyBase}-${k++}`;
    if (m[1]) out.push(<code key={key} className="rounded-sm bg-ink/[0.07] px-1 font-mono text-[0.92em]">{m[1].slice(1, -1)}</code>);
    else if (m[2] && m[3])
      out.push(
        <a key={key} href={m[3]} target="_blank" rel="noopener noreferrer" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
          {renderInline(m[2], key)}
        </a>,
      );
    else if (m[5]) out.push(<strong key={key} className="font-semibold">{renderInline(m[5], key)}</strong>);
    else if (m[7]) out.push(<em key={key}>{renderInline(m[7], key)}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function MiniMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      {blocks.map((b, i) => {
        if (b.kind === 'h') {
          return (
            <p key={i} className={`font-semibold ${b.level <= 2 ? 'text-[1.05em]' : ''}`}>
              {renderInline(b.text, `h${i}`)}
            </p>
          );
        }
        if (b.kind === 'table') {
          return (
            <div key={i} className="thin-scroll overflow-x-auto">
              <table className="w-full border-collapse text-[0.92em] leading-snug">
                <thead>
                  <tr>
                    {b.head.map((cell, c) => (
                      <th key={c} style={{ textAlign: b.align[c] ?? 'left' }} className="border-b border-borderFolk px-1.5 py-1 align-bottom font-semibold">
                        {renderInline(cell, `t${i}-h${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r} className="even:bg-ink/[0.03]">
                      {row.map((cell, c) => (
                        <td key={c} style={{ textAlign: b.align[c] ?? 'left' }} className="border-b border-borderFolk/50 px-1.5 py-1 align-top">
                          {renderInline(cell, `t${i}-${r}-${c}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.kind !== 'p') {
          const List = b.kind === 'ul' ? 'ul' : 'ol';
          return (
            <List key={i} start={b.kind === 'ol' ? b.start : undefined} className={`space-y-0.5 pl-4 ${b.kind === 'ul' ? 'list-disc' : 'list-decimal'} marker:text-muted`}>
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item, `l${i}-${j}`)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(line, `p${i}-${j}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
