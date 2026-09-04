import type { ReactNode } from 'react';

/** Минимальный безопасный рендер markdown-подмножества (заголовки, списки, таблицы, абзацы, жирный, ссылки). Без HTML-инъекций. */
export function renderMarkdown(src: string): ReactNode {
  const lines = src.replace(/\r/g, '').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const inline = (text: string): ReactNode[] => {
    const parts: ReactNode[] = [];
    const re = /(\*\*(.+?)\*\*)|(\[(.+?)\]\((\/[^\s)]*|https?:\/\/[^\s)]+)\))/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      if (m[2]) parts.push(<b key={key++}>{m[2]}</b>);
      else if (m[4]) parts.push(<a key={key++} href={m[5]} className="text-brand-500 underline">{m[4]}</a>);
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i += 1; continue; }
    if (line.startsWith('## ')) { out.push(<h2 key={key++}>{inline(line.slice(3))}</h2>); i += 1; continue; }
    if (line.startsWith('### ')) { out.push(<h3 key={key++}>{inline(line.slice(4))}</h3>); i += 1; continue; }
    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) { rows.push(lines[i]!.split('|').slice(1, -1).map((c) => c.trim())); i += 1; }
      const body = rows.filter((r) => !r.every((c) => /^-+$/.test(c)));
      const [head, ...rest] = body;
      out.push(<div key={key++} className="overflow-x-auto"><table><thead><tr>{head?.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{rest.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^(-|\d+\.)\s/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^(-|\d+\.)\s/.test(lines[i]!)) { items.push(lines[i]!.replace(/^(-|\d+\.)\s/, '')); i += 1; }
      out.push(ordered ? <ol key={key++}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol> : <ul key={key++}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(## |### |\||-\s|\d+\.\s)/.test(lines[i]!)) { para.push(lines[i]!); i += 1; }
    out.push(<p key={key++}>{inline(para.join(' '))}</p>);
  }
  return <div className="prose-tm">{out}</div>;
}
