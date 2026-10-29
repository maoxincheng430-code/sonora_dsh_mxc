import { needsBackfill, normalizeTrack, parseTrackName, sortTracks } from './library-model.js';

// Metadata and original audio are separate so listing never reads all audio blobs.
// v2 adds title / artist / addedAt / playCount / lastPlayedAt; older v1 records are
// backfilled in place the first time list() sees them.
const DB_NAME = 'sonora-library';
const DB_VERSION = 2;

export class MusicLibrary {
  constructor() {
    this.connection = null;
  }

  open() {
    if (!this.connection) {
      this.connection = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
          const tracks = request.transaction.objectStore('tracks');
          if (!tracks.indexNames.contains('addedAt')) tracks.createIndex('addedAt', 'addedAt');
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); this.connection = null; };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('数据库被其他页面占用，请关闭旧页面后重试。'));
      }).catch(error => { this.connection = null; throw error; });
    }
    return this.connection;
  }

  async transact(stores, mode, action) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error || new Error('数据库操作失败。'));
      tx.onerror = () => {}; // The abort event supplies the transaction failure.
      try {
        action(tx, result => { value = result; });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }

  save(file, duration, meta = null) {
    const id = JSON.stringify([file.name, file.size, file.lastModified || 0]);
    return this.transact(['tracks', 'audio'], 'readwrite', (tx, done) => {
      const tracks = tx.objectStore('tracks');
      const request = tracks.get(id);
      request.onsuccess = () => {
        if (request.result) {
          const existing = normalizeTrack(request.result);
          if (needsBackfill(request.result)) tracks.put(existing);
          done(existing);
          return;
        }
        const now = Date.now();
        const parsed = parseTrackName(file.name);
        // 文件内嵌标签（ID3 / MP4 ilst）优先于文件名解析结果
        const title = String(meta?.title ?? '').trim() || parsed.title;
        const artist = String(meta?.artist ?? '').trim() || parsed.artist;
        const track = normalizeTrack({
          id, name: file.name, type: file.type, duration,
          size: file.size, lastModified: file.lastModified || 0,
          importedAt: now, addedAt: now, title, artist,
          playCount: 0, lastPlayedAt: 0,
        });
        tracks.put(track);
        tx.objectStore('audio').put({ id, blob: file });
        done(track);
      };
    });
  }

  async list() {
    const raw = await this.transact(['tracks'], 'readonly', (tx, done) => {
      tx.objectStore('tracks').getAll().onsuccess = event => done(event.target.result);
    });
    const tracks = raw.map(track => {
      const normalized = normalizeTrack(track);
      if (!normalized.addedAt) normalized.addedAt = Date.now();
      return normalized;
    });
    const stale = [];
    raw.forEach((track, index) => { if (needsBackfill(track)) stale.push(tracks[index]); });
    if (stale.length) {
      try {
        await this.transact(['tracks'], 'readwrite', tx => {
          const store = tx.objectStore('tracks');
          for (const track of stale) store.put(track);
        });
      } catch { /* 回填失败不应阻塞曲库列表 */ }
    }
    return sortTracks(tracks, 'added');
  }

  async read(id) {
    const result = await this.transact(['tracks', 'audio'], 'readonly', (tx, done) => {
      const track = tx.objectStore('tracks').get(id);
      track.onsuccess = () => {
        const audio = tx.objectStore('audio').get(id);
        audio.onsuccess = () => done({ track: track.result, blob: audio.result?.blob });
      };
    });
    if (!result.track || !result.blob) throw new Error('歌曲不存在或已删除，请重新导入。');
    return new File([result.blob], result.track.name, {
      type: result.track.type, lastModified: result.track.lastModified,
    });
  }

  async update(id, changes = {}) {
    const updated = await this.transact(['tracks'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('tracks');
      const request = store.get(id);
      request.onsuccess = () => {
        if (!request.result) { done(null); return; }
        const track = normalizeTrack(request.result);
        if ('title' in changes) {
          track.title = String(changes.title ?? '').trim().slice(0, 120) || parseTrackName(track.name).title || track.name;
        }
        if ('artist' in changes) track.artist = String(changes.artist ?? '').trim().slice(0, 120);
        store.put(track);
        done(track);
      };
    });
    if (!updated) throw new Error('歌曲不存在或已删除，请重新导入。');
    return updated;
  }

  async touch(id) {
    const now = Date.now();
    return this.transact(['tracks'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('tracks');
      const request = store.get(id);
      request.onsuccess = () => {
        if (!request.result) { done(null); return; }
        const track = normalizeTrack(request.result);
        track.playCount += 1;
        track.lastPlayedAt = now;
        store.put(track);
        done(track);
      };
    });
  }

  remove(id) {
    return this.transact(['tracks', 'audio'], 'readwrite', tx => {
      tx.objectStore('tracks').delete(id);
      tx.objectStore('audio').delete(id);
    });
  }

  close() {
    this.connection?.then(db => db.close()).catch(() => {});
    this.connection = null;
  }
}
