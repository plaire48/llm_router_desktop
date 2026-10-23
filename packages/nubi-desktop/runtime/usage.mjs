import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from './store.mjs';
import {newLedger, recordUsage, usageSummary} from '../../../extensions/aipro-chat/usage-ledger.js';

// Reuse the browser's counter rules per call. Separate frames allow chat,
// mail and Wiki calls to overlap without finishing one another's receipts.
export class DesktopUsage {
  constructor(storageRoot) {
    this.store = new Store(path.join(storageRoot, 'usage'));
    this.ledger = this.store.get('usage:ledger') || newLedger();
    this.calls = new Map();
    // A stopped process cannot know usage for an unfinished request. Keep its
    // call in the totals, as unmeasured, rather than keeping a phantom spinner.
    for (const group of [this.ledger.total, ...Object.values(this.ledger.days)]) {
      for (const stats of Object.values(group)) stats.pending = 0;
    }
    this.save();
  }
  save() {
    try {this.store.set('usage:ledger', this.ledger); this.error = null;}
    catch {this.error = 'usage_save_failed';}
  }
  reset() {
    if(this.closed)throw Error('usage_unavailable');
    const next=newLedger();next.lastResetAt=next.startedAt;
    // Persist first: a failed disk write must leave the visible ledger intact.
    try {this.store.set('usage:ledger',next);}
    catch {this.error='usage_save_failed';throw Error(this.error);}
    this.ledger=next;this.calls.clear();this.error=null;
    // Completions from requests started before reset belong to the old period.
    return this.summary();
  }
  add(frame, previous) {
    for (const [day, providers] of Object.entries(frame.days)) {
      this.ledger.days[day] ||= {};
      for (const [provider, stats] of Object.entries(providers)) {
        for (const target of [this.ledger.total, this.ledger.days[day]]) {
          target[provider] ||= Object.fromEntries(Object.keys(stats).map(key => [key, 0]));
          for (const [key, value] of Object.entries(stats)) {
            target[provider][key] = Math.max(0, Math.round(((target[provider][key] || 0) + value - (previous?.days?.[day]?.[provider]?.[key] || 0)) * 1e6) / 1e6);
          }
        }
      }
    }
    for (const day of Object.keys(this.ledger.days).sort().slice(0, -31)) delete this.ledger.days[day];
    this.save();
  }
  start({provider}) {
    if (this.closed || !['aipro', 'chatgpt', 'fabrix', 'claude'].includes(provider)) return null;
    const requestId = randomUUID();
    const frame = recordUsage(newLedger(), {requestId, round:1, provider, phase:'start'});
    this.calls.set(requestId, frame); this.add(frame);
    return requestId;
  }
  finish(requestId, usage) {
    const previous = this.calls.get(requestId);
    if (this.closed || !previous) return;
    this.calls.delete(requestId);
    const provider = previous.active.rounds[1].provider;
    const frame = recordUsage(previous, {requestId, round:1, provider, phase:'finish', usage});
    this.add(frame, previous);
  }
  summary() {
    const usage=usageSummary(this.ledger),empty=newLedger().total.aipro;
    // Claude is a Desktop-only provider. The shared browser ledger keeps its
    // default catalog, but both Desktop periods must include an idle Claude.
    // The last seven days, for the dollar figure an Enterprise console shows per seat (user decision 2026-10-14).
    const week={};const since=Date.now()-6*86400000;for(const [day,providers] of Object.entries(this.ledger.days||{})){if(Date.parse(day+'T00:00:00')<since-86400000)continue;for(const [provider,stats] of Object.entries(providers)){week[provider]||={...empty};for(const [key,value] of Object.entries(stats))week[provider][key]=Math.round(((week[provider][key]||0)+value)*1e6)/1e6;}}
    const reset=this.ledger.lastResetAt,lastResetAt=Number.isSafeInteger(reset)&&reset>0&&Number.isFinite(new Date(reset).getTime())?reset:null;
    return {usage:{...usage,lastResetAt,today:{claude:{...empty},...usage.today},week:{claude:{...empty},...week},total:{claude:{...empty},...usage.total}},usageError:this.error};
  }
  close() {this.closed = true; this.calls.clear(); this.store.close();}
}

export function desktopUsage(host) {
  if (host.disposed) return null;
  try {return host.usageLedger ||= new DesktopUsage(host.storageRoot);}
  catch {return null;}
}
