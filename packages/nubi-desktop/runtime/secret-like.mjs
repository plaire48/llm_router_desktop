// Shared secret detector for memory admission and conversation export.
const SECRET=/(?:password|passwd|비밀번호|접속키|api[_ -]?key|secret|token|토큰|bearer|private key|otp|인증번호)[은는이가을를의]?\s*[:=]?\s*\S{4,}|\b(?:sk-|gh[pousr][_-]|xox[abpsr]-)[A-Za-z0-9_-]{8,}|\b\d{6}-\d{7}\b|\b\d{4}(?:[ -]?\d{4}){3}\b/i;
export const secretLike=text=>SECRET.test(String(text||''));
