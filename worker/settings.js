import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { loadConfig } from './config.js';

// Only these operational settings can be changed by the administrator.
export const fields = [
  ['AI_ENABLED', 'AI 사용', 'boolean', 'aiEnabled'],
  ['AI_PROVIDER', 'AI 제공업체', 'provider', 'provider'],
  ['AI_MODEL', '모델', 'string', 'model'],
  ['AI_BASE_URL', 'API 주소', 'url', 'baseUrl'],
  ['AI_MAX_OUTPUT_TOKENS', '최대 출력 토큰', 'number', 'maxOutput', 256, 16000],
  ['AI_CONCURRENCY', 'AI 동시 호출', 'number', 'aiConcurrency', 1, 16],
  ['AI_TIMEOUT_SECONDS', 'AI 호출 제한 (초)', 'seconds', 'aiTimeout', 1, 120],
  ['AI_BROWSER_MAX_STEPS', 'AI 최대 요청 횟수', 'number', 'browserSteps', 1, 30],
  ['AI_BROWSER_TIMEOUT_SECONDS', 'AI 탐색 제한 (초)', 'seconds', 'browserTimeout', 1, 120],
  ['AI_DAILY_REQUEST_LIMIT', '일일 AI 호출 한도', 'number', 'dailyRequests', 0, 1000000],
  ['AI_DAILY_BUDGET', '일일 예산 (USD)', 'decimal', 'dailyBudget', 0, 100000],
  ['AI_INPUT_USD_PER_MILLION', '입력 100만 토큰 요금 (USD)', 'decimal', 'inputPrice', 0, 100000],
  ['AI_OUTPUT_USD_PER_MILLION', '출력 100만 토큰 요금 (USD)', 'decimal', 'outputPrice', 0, 100000],
  ['ANALYSIS_CONCURRENCY', '동시 상품 분석', 'number', 'concurrency', 1, 16],
  ['ANALYSIS_TIMEOUT_SECONDS', '상품 분석 제한 (초)', 'seconds', 'timeout', 5, 120],
  ['QUEUE_MAX_LENGTH', '최대 대기 작업', 'number', 'queueMax', 0, 10000],
  ['QUEUE_WAIT_TIMEOUT_SECONDS', '최대 대기 시간 (초)', 'seconds', 'queueWait', 1, 120],
  ['RATE_LIMIT_ENABLED', '요청 제한 사용', 'boolean', 'rateEnabled'],
  ['RATE_LIMIT_PER_IP_PER_MINUTE', 'IP별 분당 요청', 'number', 'perIp', 1, 10000],
  ['RATE_LIMIT_PER_USER_PER_MINUTE', '사용자별 분당 요청', 'number', 'perUser', 1, 10000],
  ['CACHE_ENABLED', '캐시 사용', 'boolean', 'cacheEnabled'],
  ['CACHE_TTL_SECONDS', '캐시 유효기간 (초)', 'seconds', 'cacheTtl', 1, 86400],
  ['JOB_RESULT_TTL_SECONDS', '작업 결과 보관 (초)', 'seconds', 'resultTtl', 10, 86400],
  ['RESULT_MAX_ENTRIES', '작업·캐시 보관 상한', 'number', 'retainedMax', 1, 10000],
].map(([key, label, type, property, min, max]) => ({ key, label, type, property, min, max, section: key.startsWith('AI_') ? 'ai' : 'limits' }));

export function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}

export class SettingsStore {
  constructor(env = process.env) {
    this.base = { ...env };
    this.file = env.SETTINGS_FILE || path.join(path.dirname(loadConfig(env).stateFile), 'settings.json');
    this.authFile = env.ADMIN_AUTH_FILE || path.join(path.dirname(this.file), 'admin-auth.json');
    this.document = { version: 1, revision: 0, values: {}, audit: [] };
    if (fs.existsSync(this.file)) {
      try {
        const doc = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (doc.version !== 1 || !Number.isInteger(doc.revision) || doc.revision < 0 || !doc.values || Array.isArray(doc.values) || !Array.isArray(doc.audit)) throw new Error();
        this.validateValues(doc.values);
        this.document = doc;
      } catch { throw new Error('설정 파일을 읽을 수 없습니다. 기존 파일을 보존하고 확인해 주세요.'); }
    }
    this.snapshot = this.build(this.document);
  }
  cryptoKey() {
    const key = this.base.SETTINGS_ENCRYPTION_KEY || JSON.parse(fs.readFileSync(this.authFile, 'utf8')).encryptionKey;
    const bytes = Buffer.from(key || '', 'base64');
    if (bytes.length !== 32) throw new Error('설정 암호화 키가 올바르지 않습니다.');
    return bytes;
  }
  encrypt(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.cryptoKey(), iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }
  decrypt(value) {
    const decipher = createDecipheriv('aes-256-gcm', this.cryptoKey(), Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
  }
  validateValues(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('설정 형식이 올바르지 않습니다.');
    for (const [key, value] of Object.entries(values)) {
      const field = fields.find(f => f.key === key);
      if (!field) throw new Error(`허용되지 않은 설정: ${key}`);
      if (field.type === 'boolean') { if (typeof value !== 'boolean') throw new Error(`${field.label}: 사용 여부를 선택해 주세요.`); }
      else if (['number', 'decimal', 'seconds'].includes(field.type)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max || field.type !== 'decimal' && !Number.isInteger(value)) throw new Error(`${field.label}: ${field.min}~${field.max} 범위를 확인해 주세요.`);
      } else {
        if (typeof value !== 'string' || value.length > 500 || /[\r\n\x00-\x1f]/.test(value)) throw new Error(`${field.label}: 값이 올바르지 않습니다.`);
        if (field.type === 'provider' && value !== 'openai') throw new Error('현재 연결 가능한 제공업체는 OpenAI입니다.');
        if (field.type === 'url') {
          let url; try { url = new URL(value); } catch { throw new Error('API 주소를 확인해 주세요.'); }
          if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('API 주소는 인증정보·쿼리가 없는 HTTPS 주소여야 합니다.');
        }
      }
    }
  }
  build(doc) {
    const env = { ...this.base };
    for (const [key, value] of Object.entries(doc.values)) env[key] = String(value);
    if (doc.apiKey === null) env.AI_API_KEY = '';
    else if (doc.apiKey) env.AI_API_KEY = this.decrypt(doc.apiKey);
    return Object.freeze({ ...loadConfig(env), revision: doc.revision });
  }
  current() { return this.snapshot; }
  view() {
    const values = {};
    for (const f of fields) values[f.key] = f.type === 'seconds' ? this.snapshot[f.property] / 1000 : this.snapshot[f.property];
    return { revision: this.document.revision, updatedAt: this.document.updatedAt || null, values,
      apiKeyPresent: !!this.snapshot.apiKey, fields: fields.map(({ property, ...f }) => f), audit: this.document.audit.slice(-30).reverse() };
  }
  save({ revision, values, apiKey = '', clearApiKey = false }, actor) {
    if (revision !== this.document.revision) throw Object.assign(new Error('다른 변경이 적용되었습니다. 새로고침 후 다시 저장해 주세요.'), { status: 409 });
    this.validateValues(values);
    if (typeof apiKey !== 'string' || apiKey.length > 4096 || /\s/.test(apiKey) || typeof clearApiKey !== 'boolean' || apiKey && clearApiKey) throw new Error('API 키 입력을 확인해 주세요.');
    const changed = Object.keys(values).filter(key => this.view().values[key] !== values[key]);
    const doc = { ...this.document, revision: revision + 1, values: { ...this.document.values, ...values }, updatedAt: new Date().toISOString() };
    if (clearApiKey) { doc.apiKey = null; changed.push('AI_API_KEY'); }
    else if (apiKey) { doc.apiKey = this.encrypt(apiKey); changed.push('AI_API_KEY'); }
    const next = this.build(doc);
    if (next.aiEnabled && (!next.model || !next.apiKey || !next.inputPrice || !next.outputPrice)) throw new Error('AI 사용 시 모델·API 키·입력/출력 단가가 필요합니다.');
    doc.audit = [...this.document.audit, { at: doc.updatedAt, actor, changed }].slice(-100);
    try { atomicWrite(this.file, doc); } catch { throw new Error('설정을 저장하지 못했습니다. 기존 설정은 유지됩니다.'); }
    this.document = doc; this.snapshot = next;
    return this.view();
  }
}
