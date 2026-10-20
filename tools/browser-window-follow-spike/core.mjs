const keys = ['x', 'y', 'width', 'height'];
const norm = value => String(value).replaceAll('/', '\\').toLowerCase();
export const sameRect = (a, b) => !!a && !!b && keys.every(k => a[k] === b[k]);
export const errorPx = (a, b) => Math.max(...keys.map(k => Math.abs(a[k] - b[k])));

export function paneRect(client, insets, dpi) {
  if (!keys.every(k => Number.isFinite(client[k])) || !Array.isArray(insets) ||
      insets.length !== 4 || !insets.every(v => Number.isFinite(v) && v >= 0) ||
      !Number.isFinite(dpi) || dpi < 48 || dpi > 768) throw Error('invalid_geometry');
  const [top, right, bottom, left] = insets.map(v => Math.round(v * dpi / 96));
  const result = { x: client.x + left, y: client.y + top,
    width: client.width - left - right, height: client.height - top - bottom };
  if (result.width < 320 || result.height < 200) throw Error('pane_too_small');
  return result;
}

export function selectProof(windows, nonce, executable) {
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(nonce)) throw Error('invalid_nonce');
  const title = `Nubi window ${nonce}`;
  const matches = windows.filter(w => w.visible && norm(w.path) === norm(executable) &&
    (w.title === title || w.title.startsWith(title + ' - ') || w.title.startsWith(title + ' — ')));
  if (matches.length > 1) throw Error('proof_ambiguous');
  return matches[0] || null;
}

export function assertBinding(current, bound) {
  if (!current || current.id !== bound.id || current.processId !== bound.processId ||
      norm(current.path) !== norm(bound.path)) throw Error('binding_changed');
}

export function nwmBounds(physical, scale) {
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 8) throw Error('invalid_scale');
  // NWM 2.2.4 floors value * current monitor scale internally. The subpixel
  // offset prevents floating point truncation of negative or fractional values.
  return Object.fromEntries(keys.map(k => [k, (physical[k] + 0.001) / scale]));
}

export class Measurement {
  constructor(initial) { this.last = initial; this.recorded = initial; this.changedAt = 0; this.events = []; }
  observe(sample) {
    if (!sameRect(this.last, sample.host)) {
      this.last = { ...sample.host }; this.changedAt = sample.at;
    }
    if (!sameRect(this.recorded, sample.host) && sample.at - this.changedAt >= 180) {
      const kind = this.recorded.width !== sample.host.width || this.recorded.height !== sample.host.height
        ? 'resize' : 'move';
      this.events.push({ index: this.events.length + 1, kind, at: sample.at,
        expected: sample.expected, actual: sample.actual, errorPx: errorPx(sample.expected, sample.actual) });
      this.recorded = { ...sample.host };
    }
  }
}

export function summarize(events, samples, restored) {
  const moves = events.filter(e => e.kind === 'move').length;
  const resizes = events.filter(e => e.kind === 'resize').length;
  const settledMisalignments = events.filter(e => e.errorPx !== 0).length;
  const observed = samples.filter(s => Number.isFinite(s.errorPx));
  const sampleMisalignments = observed.filter(s => s.errorPx !== 0).length;
  const calls = samples.map(s => s.callMs).filter(Number.isFinite).sort((a, b) => a - b);
  const complete = events.length === 100 && moves >= 50 && resizes >= 50 && observed.length >= 100;
  return { verdict: !restored || settledMisalignments || sampleMisalignments ? 'fail' : complete ? 'pass' : 'incomplete',
    moves, resizes, completedEvents: events.length, measuredSamples: observed.length,
    pausedSamples: samples.filter(s => s.paused).length, settledMisalignments, sampleMisalignments,
    maxErrorPx: observed.length ? Math.max(...observed.map(s => s.errorPx)) : null,
    callP95Ms: calls.length ? calls[Math.ceil(calls.length * 0.95) - 1] : null,
    restored, nativeAcceptance: 'geometry_only; visual and input checklist required' };
}
