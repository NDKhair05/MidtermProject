import 'dotenv/config';

export function loadConfig(env = process.env) {
  for (const key of ['FULL_NAME', 'MSSV', 'MONGO_READ_URI', 'MONGO_WRITE_URI', 'SESSION_SECRET']) {
    if (!env[key]?.trim()) throw new Error(`Thieu bien moi truong: ${key}`);
  }
  const mssv = env.MSSV.trim();
  // if (!/^\d{3,}$/.test(mssv)) throw new Error('MSSV phai la chuoi so, it nhat 3 chu so');
  if (env.SESSION_SECRET.length < 32 || env.SESSION_SECRET.startsWith('THAY_')) {
    throw new Error('SESSION_SECRET phai la chuoi ngau nhien it nhat 32 ky tu');
  }
  return {
    fullName: env.FULL_NAME.trim(), mssv,
    dbName: `DB_${mssv}`, prefix: mssv.slice(-3),
    vatPercent: Number(mssv.at(-1)) + 4,
    readUri: env.MONGO_READ_URI, writeUri: env.MONGO_WRITE_URI,
    sessionSecret: env.SESSION_SECRET,
    production: env.NODE_ENV === 'production', port: Number(env.PORT || 3000)
  };
}
