import { MongoClient } from 'mongodb';

export async function connectDatabase(config) {
  // Two independent connection pools; never share the write credentials with read queries.
  const options = { maxPoolSize: 10, serverSelectionTimeoutMS: 10000, readPreference: 'primary' };
  const reader = new MongoClient(config.readUri, options);
  const writer = new MongoClient(config.writeUri, options);
  try {
    // Wait for both attempts to settle before closing on any failure.
    const connections = await Promise.allSettled([reader.connect(), writer.connect()]);
    if (connections.some(result => result.status === 'rejected')) throw new Error('Atlas connection failed');
    const readDb = reader.db(config.dbName);
    const writeDb = writer.db(config.dbName);
    return {
      readDb, writeDb,
      books: {
        list: () => readDb.collection('books').find({}).sort({ createdAt: -1 }).limit(100).toArray(),
        insert: document => writeDb.collection('books').insertOne(document)
      },
      health: () => Promise.all([readDb.command({ ping: 1 }), writeDb.command({ ping: 1 })]),
      close: () => Promise.all([reader.close(), writer.close()])
    };
  } catch {
    await Promise.allSettled([reader.close(), writer.close()]);
    // Do not include URI/password in logs.
    throw new Error('Khong ket noi duoc Atlas. Kiem tra URI, user, role va IP allowlist.');
  }
}
