/**
 * Display names for compliance audit rows.
 *
 * The stored admin id is unchanged. A name is used only when the Admin
 * document has one. A missing or blank name becomes "Administrator" plus
 * the last four characters of the id. No personal name is invented.
 */

export type Actor = { id: string | null; name: string | null; label: string };

const OBJECT_ID = /^[a-f\d]{24}$/i;

export function actorFromName(id: unknown, name: string | null | undefined): Actor {
  const text = id == null ? '' : String(id);
  const valid = OBJECT_ID.test(text) ? text : null;
  const stored = typeof name === 'string' ? name.trim() : '';
  if (stored) return { id: valid, name: stored, label: stored };
  if (valid) return { id: valid, name: null, label: `Administrator ${valid.slice(-4)}` };
  return { id: null, name: null, label: 'User not recorded' };
}

export async function attachActors<T extends Record<string, unknown>>(
  rows: T[],
  idField: keyof T,
  lookup: (ids: string[]) => Promise<Array<{ _id: unknown; name?: string | null }>>
): Promise<Array<T & { actor: Actor }>> {
  const ids = [...new Set(rows.map((row) => {
    const value = row[idField];
    const text = value == null ? '' : String(value);
    return OBJECT_ID.test(text) ? text : '';
  }).filter(Boolean))];
  const found = ids.length ? await lookup(ids) : [];
  const names = new Map(found.map((admin) => [String(admin._id), admin.name ?? null]));
  return rows.map((row) => {
    const value = row[idField];
    const id = value == null ? null : String(value);
    const known = id != null && names.has(id) ? names.get(id) : null;
    return { ...row, actor: actorFromName(id, known) };
  });
}
