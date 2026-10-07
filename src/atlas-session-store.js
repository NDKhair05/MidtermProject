import session from 'express-session';

// Atlas-backed persistence. No MemoryStore or process-local session map.
// Implement the Store contract using the same two strictly scoped database users.
export class AtlasSessionStore extends session.Store {
  constructor(readDb, writeDb, ttlMs = 86400000) {
    super();
    this.readCollection = readDb.collection('sessions');
    this.writeCollection = writeDb.collection('sessions');
    this.ttlMs = ttlMs;
  }
  expires(sess) {
    return sess.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + this.ttlMs);
  }
  get(sid, callback) {
    this.readCollection.findOne({ _id: sid, expiresAt: { $gt: new Date() } })
      .then(doc => callback(null, doc ? JSON.parse(doc.data) : null), callback);
  }
  set(sid, sess, callback = () => {}) {
    this.writeCollection.updateOne({ _id: sid }, {
      $set: { data: JSON.stringify(sess), expiresAt: this.expires(sess) }
    }, { upsert: true }).then(() => callback(null), callback);
  }
  touch(sid, sess, callback = () => {}) {
    this.writeCollection.updateOne({ _id: sid }, {
      $set: { expiresAt: this.expires(sess) }
    }).then(() => callback(null), callback);
  }
  destroy(sid, callback = () => {}) {
    this.writeCollection.deleteOne({ _id: sid }).then(() => callback(null), callback);
  }
}
