/** Simple fallback for objects that may not have a typed `_id` field. */
export function idOf(obj: any): string {
  return obj && obj._id ? obj._id.toString() : '';
}
