/** "Child of Asha Rao" for a guest, '' for a main registrant. */
export function familyLabel(u) {
  if (!u?.primaryName) return '';
  const r = !u.relation || u.relation === 'other' ? 'guest' : u.relation;
  return `${r[0].toUpperCase()}${r.slice(1)} of ${u.primaryName}`;
}
