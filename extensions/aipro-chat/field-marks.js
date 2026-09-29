// Host-only record of what each observed field held when this run first saw
// it. The page reduces a value to a one-way mark; the mark is taken out of the
// observation here, before anything reaches the model or the review.
const MARK = /^\d{1,7}:[a-f0-9]{16}$/;
export const FIELD_MARK_LIMIT = 400;

// scope is the frame's complete address, kept in the host: two records of one
// screen differ only in their query. place is the field's place in its document as
// the page reports it, independent of which fields an observation returned. A
// field without a place has no record, and its check answers baseline_missing.
// baseline false: the document was still loading, so what it holds is not yet what
// the page will show. Such an observation updates nothing and starts no record.
export function takeFieldMarks(task, scope, descriptors, {baseline = true} = {}) {
  task.fieldMarks ||= new Map();
  return (Array.isArray(descriptors) ? descriptors : []).map(descriptor => {
    if (!descriptor || typeof descriptor !== 'object' || !Object.hasOwn(descriptor, 'valueMark') && !Object.hasOwn(descriptor, 'fieldPlace')) return {descriptor};
    const {valueMark, fieldPlace, ...visible} = descriptor;
    if (typeof scope !== 'string' || !scope || typeof fieldPlace !== 'string' || !fieldPlace) return {descriptor: visible};
    const fieldKey = JSON.stringify([scope, fieldPlace]);
    if (baseline && typeof valueMark === 'string' && MARK.test(valueMark)) {
      const known = task.fieldMarks.get(fieldKey);
      if (known) known.latest = valueMark;
      else if (task.fieldMarks.size < FIELD_MARK_LIMIT) task.fieldMarks.set(fieldKey, {first: valueMark, latest: valueMark});
    }
    return {descriptor: visible, fieldKey};
  });
}
// The address of a frame for the record above. A frame without an address of its
// own (about:blank, srcdoc) is told apart by the element that holds it.
export function fieldScope(frameURL, topURL, owner) {
  const own = typeof frameURL === 'string' && /^https?:/i.test(frameURL) ? frameURL : null;
  if (own) return own;
  if (typeof topURL !== 'string' || !/^https?:/i.test(topURL)) return null;
  return `${topURL}\n${JSON.stringify(['tag', 'id', 'name', 'title'].map(key => String(owner?.[key] || '').slice(0, 160)))}`;
}
// An action resolved this field as its target. Whatever the action did, the
// run can no longer claim that it left the field alone.
export function markFieldWritten(task, entry) {
  if (typeof entry?.fieldKey === 'string') (task.writtenFields ||= new Set()).add(entry.fieldKey);
}
export function fieldUnchanged(task, entry, currentMark) {
  const known = typeof entry?.fieldKey === 'string' ? task.fieldMarks?.get(entry.fieldKey) : null;
  if (!known || typeof currentMark !== 'string' || !MARK.test(currentMark)) return {passed: false, reason: 'baseline_missing'};
  if (task.writtenFields?.has(entry.fieldKey)) return {passed: false, reason: 'field_written'};
  return known.first === currentMark ? {passed: true, compared: 'first_observation'} : {passed: false, reason: 'value_changed'};
}
