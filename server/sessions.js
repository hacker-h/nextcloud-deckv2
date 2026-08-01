import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DAY = 24 * 60 * 60 * 1000;

export class SessionStore {
  constructor({ filePath, secret, now = () => Date.now(), ttlMs = 30 * DAY }) {
    if (!filePath) throw new Error('SessionStore requires filePath');
    if (!Buffer.isBuffer(secret) || secret.length !== 32) throw new Error('SessionStore requires a 32-byte secret');
    this.filePath = filePath;
    this.secret = secret;
    this.now = now;
    this.ttlMs = ttlMs;
    this.data = this.#load();
  }

  create(appPassword, user) {
    const sid = randomBytes(32).toString('base64url');
    const now = this.now();
    this.data.sessions[sid] = {
      user,
      token: this.#encrypt(appPassword),
      createdAt: now,
      lastSeenAt: now,
    };
    this.#save();
    return sid;
  }

  get(sid) {
    const item = this.data.sessions[sid];
    if (!item) return null;
    if (this.now() - item.lastSeenAt > this.ttlMs) {
      this.destroy(sid);
      return null;
    }
    try {
      return { sid, user: item.user, appPassword: this.#decrypt(item.token) };
    } catch {
      this.destroy(sid);
      return null;
    }
  }

  touch(sid) {
    const item = this.data.sessions[sid];
    if (!item) return false;
    item.lastSeenAt = this.now();
    this.#save();
    return true;
  }

  destroy(sid) {
    delete this.data.sessions[sid];
    this.#save();
  }

  #encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.secret, iv);
    const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  }

  #decrypt(token) {
    const decipher = createDecipheriv('aes-256-gcm', this.secret, Buffer.from(token.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(token.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(token.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }

  #load() {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return { sessions: parsed.sessions ?? {} };
    } catch (err) {
      if (err.code === 'ENOENT') return { sessions: {} };
      throw err;
    }
  }

  #save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.filePath);
  }
}
