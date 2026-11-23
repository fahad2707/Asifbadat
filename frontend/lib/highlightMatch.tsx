export function HighlightMatch({ text, query }: { text: string; query: string }) {
  const source = String(text || '');
  const q = String(query || '').trim();
  if (!q) return <>{source}</>;
  const lower = source.toLowerCase();
  const needle = q.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const at = lower.indexOf(needle, cursor);
    if (at < 0) {
      parts.push({ text: source.slice(cursor), hit: false });
      break;
    }
    if (at > cursor) parts.push({ text: source.slice(cursor, at), hit: false });
    parts.push({ text: source.slice(at, at + q.length), hit: true });
    cursor = at + q.length;
  }
  return (
    <>
      {parts.map((part, index) =>
        part.hit ? (
          <mark key={index} className="bg-[#FFF4E5] text-[#1A1A1A] rounded-sm px-0.5">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </>
  );
}
