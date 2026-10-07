// Run once with an administrative account from your own machine.
// Never add MONGO_ADMIN_URI to the deployed web service.
const studentId = process.env.MSSV;
if (!/^\d{3,}$/.test(studentId || '')) throw new Error('Set MSSV in the shell first');
const target = db.getSiblingDB(`DB_${studentId}`);
for (const name of ['books', 'sessions']) {
  if (!target.getCollectionNames().includes(name)) target.createCollection(name);
}
target.books.createIndex({ code: 1 }, { unique: true, name: 'unique_book_code' });
target.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'session_expiry' });
print(`Prepared DB_${studentId}: books + sessions + indexes`);
