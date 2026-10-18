// Model-authored labels and standalone requests must not hide or reorder text.
export function cleanModelText(value){
  return String(value??'').replace(/\s+/g,' ').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'').replace(/\s+/g,' ').trim();
}
