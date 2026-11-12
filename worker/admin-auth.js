import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scrypt as scryptCallback, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);

export function createAdmin(file, username, password) {
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username) || typeof password !== 'string' || password.length < 12 || password.length > 200) throw new Error('운영자 ID는 영문/숫자 3~40자, 비밀번호는 12~200자여야 합니다.');
  const salt = randomBytes(16).toString('hex');
  const auth = { version: 1, username, salt, hash: scryptSync(password, salt, 32).toString('hex'), encryptionKey: randomBytes(32).toString('base64') };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(auth), { flag: 'wx', mode: 0o600 });
}

export class AdminAuth {
  constructor(file) { this.file = file; this.sessions = new Map(); this.attempts = new Map(); this.verifying = 0; }
  configured() { return fs.existsSync(this.file); }
  async login(username, password, ip) {
    const now = Date.now();
    for (const [k, v] of this.attempts) if (v.until <= now) this.attempts.delete(k);
    const key = createHash('sha256').update(ip).digest('hex');
    const attempt = this.attempts.get(key) || { count: 0, until: now + 15 * 60000 };
    if (attempt.count >= 5 || this.verifying >= 4 || this.attempts.size >= 2000 && !this.attempts.has(key)) throw Object.assign(new Error('로그인 시도 한도'), { status: 429 });
    attempt.count++; this.attempts.set(key, attempt);
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200) return null;
    this.verifying++;
    try {
      const auth = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const expected = Buffer.from(auth.hash, 'hex'), actual = await scrypt(password, auth.salt, 32);
      if (expected.length !== actual.length || !timingSafeEqual(actual, expected) || username !== auth.username) return null;
      this.attempts.delete(key);
      for (const [k, v] of this.sessions) if (v.expires <= now) this.sessions.delete(k);
      if (this.sessions.size >= 100) return null;
      const token = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
      this.sessions.set(createHash('sha256').update(token).digest('hex'), { username, csrf, expires: now + 30 * 60000 });
      return { token, csrf };
    } catch { return null; }
    finally { this.verifying--; }
  }
  token(req) { return (req.headers.cookie || '').match(/(?:^|;\s*)gd_admin=([a-f0-9]{64})(?:;|$)/)?.[1] || ''; }
  session(req) {
    const key = createHash('sha256').update(this.token(req)).digest('hex'), session = this.sessions.get(key);
    if (session && session.expires > Date.now()) return session;
    this.sessions.delete(key); return null;
  }
  logout(req) { this.sessions.delete(createHash('sha256').update(this.token(req)).digest('hex')); }
}
