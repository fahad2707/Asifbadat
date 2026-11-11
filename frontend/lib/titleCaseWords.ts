/** Capitalize the first letter of every word. Other characters in the word are left as typed. */
export function titleCaseWords(value: string): string {
  return String(value ?? '').replace(/(^|[^A-Za-z0-9]+)([A-Za-z])/g, (_m, sep: string, letter: string) => {
    return `${sep}${letter.toUpperCase()}`;
  });
}
