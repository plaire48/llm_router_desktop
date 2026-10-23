import {MailListIndex} from './mail-list-index.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(directory, {ownerWaitMs=0,mailList=false,onChange} = {}) {
    this.onChange=onChange;
    if(!Number.isSafeInteger(ownerWaitMs)||ownerWaitMs<0||ownerWaitMs>2400)throw Error('store_owner_wait');
    mkdirSync(directory, {recursive: true, mode: 0o700});
    this.directory = directory;
    // A separate SQLite transaction owns the execution state, without blocking
    // ordinary WAL writes. OS locks are released when the owning process exits.
    this.owner = new DatabaseSync(path.join(directory, 'owner.db'));
    try {
      // Startup may briefly overlap the previous worker closing its routine store.
      // Wait only for ownership; no task, tool or write is replayed.
      this.owner.exec(`PRAGMA busy_timeout=${ownerWaitMs}; BEGIN IMMEDIATE`);
      this.db = new DatabaseSync(path.join(directory, 'workspace.db'));
      // busy_timeout first: switching to WAL can meet a closing reader (the mail list worker) for a moment.
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL);');
      // SQLite LIKE uses NOCASE by default; the binary primary key cannot serve
      // these prefix reads, so otherwise each status field scans all history.
      this.db.exec('CREATE INDEX IF NOT EXISTS records_prefix ON records(key COLLATE NOCASE)');
      if(mailList)this.mailList=new MailListIndex(this.db);
    } catch (error) {
      this.db?.close(); this.owner.close();
      if (error.errcode === 5 || error.errcode === 6) throw new Error('project_locked');
      throw error;
    }
  }
  get(key) { const row = this.db.prepare('SELECT value FROM records WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  mutateMail(key,write){
    if(!this.mailList||!/^mail(?::|-index:|-user:)/.test(key))return write();
    this.db.exec('SAVEPOINT mail_projection');
    try{const result=write();this.mailList.syncKey(key);this.db.exec('RELEASE mail_projection');return result;}
    catch(error){this.db.exec('ROLLBACK TO mail_projection; RELEASE mail_projection');throw error;}
  }
  set(key, value) { this.mutateMail(key,()=>this.db.prepare('INSERT INTO records VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value))); try{this.onChange?.(key);}catch{} return value; }
  list(prefix, {limit} = {}) {
    if(limit!==undefined&&(!Number.isSafeInteger(limit)||limit<0))throw new TypeError('store_list_limit');
    // Apply the visible limit in SQLite before allocating and parsing old history.
    const sql='SELECT value FROM records WHERE key LIKE ? ORDER BY rowid DESC';
    const rows=limit===undefined?this.db.prepare(sql).all(prefix+'%'):this.db.prepare(sql+' LIMIT ?').all(prefix+'%',limit);
    return rows.map(row=>JSON.parse(row.value));
  }
  taskSummaries() {
    // SQLite projects only navigation fields; historical message bodies never cross IPC.
    return this.db.prepare("SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.request') AS request,json_extract(value,'$.state') AS state,json_extract(value,'$.createdAt') AS createdAt,json_extract(value,'$.updatedAt') AS updatedAt,json_extract(value,'$.unread') AS unread,json_extract(value,'$.archivedAt') AS archivedAt,json_extract(value,'$.origin') AS origin FROM records WHERE key LIKE 'task:%' ORDER BY rowid DESC").all().map(({origin,...row})=>({...row,unread:!!row.unread,...(origin?{origin:JSON.parse(origin)}:{})}));
  }
  delete(key) { this.mutateMail(key,()=>this.db.prepare('DELETE FROM records WHERE key=?').run(key));try{this.onChange?.(key);}catch{} }
  entries(prefix) { return this.db.prepare('SELECT key, value FROM records WHERE key LIKE ? ORDER BY rowid DESC').all(prefix + '%').map(row => ({key: row.key, value: JSON.parse(row.value)})); }
  event(kind, value) { this.db.prepare('INSERT INTO events (at,kind,value) VALUES (?,?,?)').run(new Date().toISOString(), kind, JSON.stringify(value)); }
  events(after = 0) { return this.db.prepare('SELECT * FROM events WHERE sequence>? ORDER BY sequence LIMIT 100').all(after).map(row => ({...row, value: JSON.parse(row.value)})); }
  close() { if (this.db.isOpen) this.db.close(); if (this.owner.isOpen) this.owner.close(); }
}
