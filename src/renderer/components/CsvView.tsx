import { useMemo, useState } from 'react';

/** RFC 4180-ish parser: quotes, escaped quotes, newlines inside quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const candidates = ['\t', ',', ';', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    const n = sample.split(d).length;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

const NUMERIC = /^-?\d+(?:[.,]\d+)?$/;

export function CsvView({ text }: { text: string }) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [desc, setDesc] = useState(false);
  const [filter, setFilter] = useState('');

  const { header, rows, delimiter } = useMemo(() => {
    const delimiter = detectDelimiter(text);
    const all = parseDelimited(text, delimiter);
    const width = Math.max(0, ...all.map((r) => r.length));
    const pad = (r: string[]) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r);
    return { header: pad(all[0] ?? []), rows: all.slice(1).map(pad), delimiter };
  }, [text]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = q ? rows.filter((r) => r.some((c) => c.toLowerCase().includes(q))) : rows.slice();
    if (sortCol !== null) {
      list = list.sort((a, b) => {
        const x = a[sortCol] ?? '';
        const y = b[sortCol] ?? '';
        const cmp =
          NUMERIC.test(x.trim()) && NUMERIC.test(y.trim())
            ? parseFloat(x.replace(',', '.')) - parseFloat(y.replace(',', '.'))
            : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
        return desc ? -cmp : cmp;
      });
    }
    return list;
  }, [rows, filter, sortCol, desc]);

  if (!header.length) return <div className="preview-note">This file is empty.</div>;

  const delimName = delimiter === '\t' ? 'tab' : delimiter === ',' ? 'comma' : delimiter === ';' ? 'semicolon' : delimiter;

  return (
    <div className="csv">
      <div className="csv-toolbar">
        <input
          className="input small"
          type="search"
          placeholder="Filter rows"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted">
          {shown.length === rows.length ? `${rows.length} rows` : `${shown.length} of ${rows.length} rows`} · {header.length} columns · {delimName}-separated
        </span>
      </div>
      <div className="csv-scroll">
        <table className="csv-table">
          <thead>
            <tr>
              <th className="csv-index">#</th>
              {header.map((h, i) => (
                <th
                  key={i}
                  onClick={() => {
                    if (sortCol === i) setDesc(!desc);
                    else {
                      setSortCol(i);
                      setDesc(false);
                    }
                  }}
                  className={sortCol === i ? 'sorted' : ''}
                  title="Sort"
                >
                  {h || `Column ${i + 1}`}
                  {sortCol === i && <span className="sort-arrow">{desc ? ' ▼' : ' ▲'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 5000).map((r, ri) => (
              <tr key={ri}>
                <td className="csv-index">{ri + 1}</td>
                {r.map((c, ci) => (
                  <td key={ci} className={NUMERIC.test(c.trim()) ? 'num' : ''}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > 5000 && <div className="preview-note">Showing the first 5000 rows.</div>}
      </div>
    </div>
  );
}
