// ═══════════════════════════════════════════════════════════════
//  firebase-db.js  —  Firestore backend for SYNC POS
//  Drop-in replacement for the localStorage DB in app.js.
//  Exposes the same window.DB API so the rest of app.js is untouched.
// ═══════════════════════════════════════════════════════════════
"use strict";

(function () {
  // ── Firebase config ──────────────────────────────────────────
  const firebaseConfig = {
    apiKey: "AIzaSyDYCSqXghqZyyy07v5ayOydKD0MFX5dBjs",
    authDomain: "sync-pos.firebaseapp.com",
    projectId: "sync-pos",
    storageBucket: "sync-pos.firebasestorage.app",
    messagingSenderId: "377262643586",
    appId: "1:377262643586:web:b73bd8b8580a64a1dad79b",
    measurementId: "G-C9CYVSLBL3",
  };

  // ── Init Firebase ────────────────────────────────────────────
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  // ── Tables that hold arrays of documents (sub-collections) ───
  const ARRAY_TABLES = new Set([
    "users","products","addons","inventory","premade_stock",
    "orders","waste","expenses","attendance","system_log",
  ]);

  // ── In-memory cache (filled by preload) ─────────────────────
  const _cache = {};
  let _cacheReady = false;

  // ── Helpers ───────────────────────────────────────────────────
  function colRef(table) { return db.collection(table); }

  function docRef(table, key) { return db.collection("kv").doc(table + ":" + key); }

  function uid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // Snapshot → plain JS array
  function snapToArray(snap) {
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ── preload: fetch all array tables into cache at startup ────
  async function preload() {
    const fetches = [...ARRAY_TABLES].map(async table => {
      const snap = await colRef(table).get();
      _cache[table] = snapToArray(snap);
    });
    // Also fetch scalar KV docs (categories, disc_senior, disc_pwd, etc.)
    const kvFetch = db.collection("kv").get().then(snap => {
      snap.docs.forEach(d => {
        _cache["kv:" + d.id] = d.data().value;
      });
    });
    await Promise.all([...fetches, kvFetch]);
    _cacheReady = true;

    // Live listeners: keep cache in sync across devices
    ARRAY_TABLES.forEach(table => {
      colRef(table).onSnapshot(snap => {
        _cache[table] = snapToArray(snap);
        // Trigger re-render for key pages
        _notifyChange(table);
      });
    });

    // Live listener for scalar KV collection
    db.collection("kv").onSnapshot(snap => {
      snap.docs.forEach(d => {
        _cache["kv:" + d.id] = d.data().value;
      });
    });
  }

  // ── Change notification ──────────────────────────────────────
  // Any part of the app can subscribe via DB.onChange(table, fn)
  const _listeners = {};
  function _notifyChange(table) {
    (_listeners[table] || []).forEach(fn => {
      try { fn(_cache[table]); } catch (e) { console.error(e); }
    });
    (_listeners["*"] || []).forEach(fn => {
      try { fn(table, _cache[table]); } catch (e) { console.error(e); }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  PUBLIC DB API  (mirrors the original localStorage API)
  // ══════════════════════════════════════════════════════════════
  window.DB = {

    // ── uid ──────────────────────────────────────────────────────
    uid,

    // ── get (sync, uses cache) ───────────────────────────────────
    get(key, def) {
      if (ARRAY_TABLES.has(key)) {
        return _cache[key] !== undefined ? [..._cache[key]] : (def !== undefined ? def : []);
      }
      // Scalar: return from cache if preloaded, else def
      return _cache["kv:" + key] !== undefined ? _cache["kv:" + key] : (def !== undefined ? def : null);
    },

    // ── set (async write; also updates cache) ───────────────────
    set(key, val) {
      if (ARRAY_TABLES.has(key)) {
        console.error(`DB.set('${key}') — use DB.push/update/remove for array tables`);
        return;
      }
      _cache["kv:" + key] = val;
      // Persist to Firestore KV collection
      db.collection("kv").doc(key).set({ value: val })
        .catch(e => console.error("DB.set Firestore error:", e));
    },

    // ── push (add row to array table) ────────────────────────────
    push(table, row) {
      if (!ARRAY_TABLES.has(table)) {
        console.error(`DB.push: '${table}' is not an array table`);
        return row;
      }
      const saved = { id: row.id || uid(), ...row };
      // Optimistic cache update
      if (!_cache[table]) _cache[table] = [];
      _cache[table] = [..._cache[table], saved];
      // Persist
      colRef(table).doc(saved.id).set(saved)
        .catch(e => console.error(`DB.push '${table}' error:`, e));
      return saved;
    },

    // ── update (patch a row by id) ───────────────────────────────
    update(table, id, patch) {
      if (!ARRAY_TABLES.has(table)) {
        console.error(`DB.update: '${table}' is not an array table`);
        return null;
      }
      const rows = _cache[table] || [];
      const idx = rows.findIndex(r => r.id === id);
      if (idx === -1) {
        console.warn(`DB.update: id '${id}' not found in '${table}'`);
        return null;
      }
      const updated = { ...rows[idx], ...patch };
      _cache[table] = [...rows.slice(0, idx), updated, ...rows.slice(idx + 1)];
      // Persist
      colRef(table).doc(id).update(patch)
        .catch(e => console.error(`DB.update '${table}' error:`, e));
      return updated;
    },

    // ── remove (delete a row by id) ──────────────────────────────
    remove(table, id) {
      if (!ARRAY_TABLES.has(table)) return;
      _cache[table] = (_cache[table] || []).filter(r => r.id !== id);
      colRef(table).doc(id).delete()
        .catch(e => console.error(`DB.remove '${table}' error:`, e));
    },

    // ── preload ──────────────────────────────────────────────────
    async preload() {
      await preload();
    },

    // ── invalidate (force re-fetch a table) ──────────────────────
    async invalidate(table) {
      if (!table || !ARRAY_TABLES.has(table)) return;
      const snap = await colRef(table).get();
      _cache[table] = snapToArray(snap);
    },

    // ── onChange: subscribe to live updates ──────────────────────
    // Usage: DB.onChange('orders', rows => renderOrders(rows))
    //        DB.onChange('*',  (table, rows) => console.log(table, rows))
    onChange(table, fn) {
      if (!_listeners[table]) _listeners[table] = [];
      _listeners[table].push(fn);
    },

    // ── exportAll / importAll / clearAll ─────────────────────────
    async exportAll() {
      const out = {};
      for (const table of ARRAY_TABLES) {
        out[table] = await colRef(table).get().then(snapToArray);
      }
      return out;
    },

    async importAll(data, { merge = false } = {}) {
      const batch = db.batch();
      for (const [table, rows] of Object.entries(data)) {
        if (!ARRAY_TABLES.has(table)) continue;
        if (merge) {
          const existing = new Set((_cache[table] || []).map(r => r.id));
          rows.forEach(row => {
            if (!existing.has(row.id)) batch.set(colRef(table).doc(row.id), row);
          });
        } else {
          rows.forEach(row => batch.set(colRef(table).doc(row.id), row));
        }
      }
      await batch.commit();
      await preload();
    },

    async clearAll() {
      for (const table of ARRAY_TABLES) {
        const snap = await colRef(table).get();
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        _cache[table] = [];
      }
    },

    // ── isReady ──────────────────────────────────────────────────
    isReady() { return _cacheReady; },
  };

})();