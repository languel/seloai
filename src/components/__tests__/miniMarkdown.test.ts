import { describe, expect, it } from 'vitest';
import { parseBlocks, renderInline, tableCells } from '../MiniMarkdown';

const flat = (nodes: unknown[]): string =>
  nodes
    .map((n) => {
      if (typeof n === 'string') return n;
      const el = n as { type: string; props: { children: unknown } };
      const kids = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
      return `<${el.type}>${flat(kids)}</${el.type}>`;
    })
    .join('');

describe('the little Markdown renderer', () => {
  it('splits paragraphs, headings and lists', () => {
    const blocks = parseBlocks('This is the story.\nSecond line.\n\nKey elements:\n- **Well** – stone\n- Villagers\n\n1. one\n2. two\n## Next');
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'p', 'ul', 'ol', 'h']);
    expect(blocks[0]).toEqual({ kind: 'p', lines: ['This is the story.', 'Second line.'] });
    expect(blocks[2]).toMatchObject({ items: ['**Well** – stone', 'Villagers'] });
  });

  it('renders bold, italic, code and safe links as elements', () => {
    expect(flat(renderInline('the **Zmeyovo: Well** and *Lamia* `add_place`'))).toBe('the <strong>Zmeyovo: Well</strong> and <em>Lamia</em> <code>add_place</code>');
    expect(flat(renderInline('[docs](https://example.com) and [bad](javascript:alert(1))'))).toBe('<a>docs</a> and [bad](javascript:alert(1))');
  });

  it('leaves half-written syntax as text while streaming, and HTML as text always', () => {
    expect(flat(renderInline('a **half written'))).toBe('a **half written');
    expect(flat(renderInline('<b>not html</b>'))).toBe('<b>not html</b>');
    expect(flat(renderInline('snake_case_name and 2*3*4'))).toBe('snake_case_name and 2*3*4');
  });
});

describe('tables', () => {
  it('reads a table with its header, alignment and rows, padding short rows', () => {
    const blocks = parseBlocks('Here are the characters:\n\n| Name | Role | Voice |\n|------|:----:|------:|\n| **Lamia** (lamia) | Serpent Keeper | female, Portuguese |\n| Baba Rada | Herb-keeper |\n\nAfter.');
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'table', 'p']);
    expect(blocks[1]).toEqual({
      kind: 'table',
      head: ['Name', 'Role', 'Voice'],
      align: ['left', 'center', 'right'],
      rows: [
        ['**Lamia** (lamia)', 'Serpent Keeper', 'female, Portuguese'],
        ['Baba Rada', 'Herb-keeper', ''],
      ],
    });
  });

  it('keeps pipes inside code or escaped, and does not mistake a plain pipe for a table', () => {
    expect(tableCells('| `a|b` | c \\| d |')).toEqual(['`a|b`', 'c | d']);
    expect(parseBlocks('either this | or that').map((b) => b.kind)).toEqual(['p']);
    // While streaming, the header row before its rule line is just text.
    expect(parseBlocks('| Name | Role |').map((b) => b.kind)).toEqual(['p']);
  });
});
