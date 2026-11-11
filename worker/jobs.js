import { randomBytes, createHash } from 'node:crypto';

export class ServiceError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}
export function productKey(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || raw.length > 2048) throw new ServiceError('invalid_url', '올바른 상품 URL을 입력해 주세요.');
  url.hash = '';
  for (const name of [...url.searchParams.keys()]) if (/^(utm_.+|NaPm|gclid|fbclid)$/i.test(name)) url.searchParams.delete(name);
  url.searchParams.sort();
  return url.href;
}

/** One process owns scheduling, cache and accounting. Job IDs are unguessable bearer capabilities. */
export class JobManager {
  constructor(config, analyze) {
    this.c = config; this.analyze = analyze; this.running = 0;
    this.jobs = new Map(); this.inflight = new Map(); this.cache = new Map(); this.rates = new Map(); this.queue = [];
  }
  rate(identity, poll = false) {
    if (!this.c.rateEnabled) return;
    const now = Date.now();
    for (const [key, value] of this.rates) if (value.until <= now) this.rates.delete(key);
    const entries = [[`ip:${identity.ip || 'unknown'}`, this.c.perIp]];
    if (identity.user) entries.push([`user:${identity.user}`, this.c.perUser]);
    for (const [key, limit] of entries) {
      const id = `${poll ? 'poll' : 'submit'}:${createHash('sha256').update(key).digest('hex')}`;
      const counter = this.rates.get(id) || { count: 0, until: now + 60000 };
      if (this.rates.size >= 20000 && !this.rates.has(id)) throw new ServiceError('rate_capacity', '잠시 후 다시 요청해 주세요.', 429);
      if (counter.count >= (poll ? limit * 30 : limit)) throw new ServiceError('rate_limit', '요청 한도에 도달했습니다. 잠시 후 다시 요청해 주세요.', 429);
      counter.count++; this.rates.set(id, counter);
    }
  }
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache) if (entry.expires <= now) this.cache.delete(key);
    for (const [id, job] of this.jobs) if (job.finished && job.finished + this.c.resultTtl <= now) this.jobs.delete(id);
    while (this.cache.size > this.c.retainedMax) this.cache.delete(this.cache.keys().next().value);
    const terminal = [...this.jobs.values()].filter(j => j.finished);
    while (this.jobs.size >= this.c.retainedMax && terminal.length) this.jobs.delete(terminal.shift().id);
  }
  submit(raw, identity = {}) {
    this.rate(identity); this.cleanup();
    let key;
    try { key = productKey(raw); } catch { throw new ServiceError('invalid_url', '올바른 상품 URL을 입력해 주세요.'); }
    const existing = this.inflight.get(key);
    if (existing) return this.jobs.get(existing);
    const cached = this.c.cacheEnabled && this.cache.get(key);
    if (!cached && this.running >= this.c.concurrency && this.queue.length >= this.c.queueMax) throw new ServiceError('queue_full', '분석 대기열이 가득 찼습니다. 잠시 후 다시 요청해 주세요.', 503);
    if (this.jobs.size >= this.c.retainedMax) throw new ServiceError('job_capacity', '분석 작업이 많습니다. 잠시 후 다시 요청해 주세요.', 503);
    const job = { id: randomBytes(24).toString('hex'), key, state: 'queued', created: Date.now() };
    job.promise = new Promise(resolve => { job.resolve = resolve; });
    this.jobs.set(job.id, job);
    if (cached) {
      job.state = 'completed'; job.product = { ...structuredClone(cached.product), cacheAnalysis: { hit: true, checkedAt: cached.product.checkedAt } };
      job.finished = Date.now(); job.resolve(job); return job;
    }
    this.inflight.set(key, job.id);
    if (this.running < this.c.concurrency) void this.run(job);
    else {
      this.queue.push(job);
      job.waitTimer = setTimeout(() => {
        this.queue = this.queue.filter(item => item !== job);
        this.fail(job, new ServiceError('queue_timeout', '분석 대기 시간이 초과되었습니다. 다시 요청해 주세요.', 503));
      }, this.c.queueWait);
    }
    return job;
  }
  fail(job, error) {
    job.state = 'failed'; job.error = { code: error.code || 'analysis_failed', message: error.message || '상품 분석 실패', status: error.status || 422 };
    this.finish(job);
  }
  finish(job) {
    clearTimeout(job.waitTimer); job.finished = Date.now(); this.inflight.delete(job.key); job.resolve(job);
  }
  async run(job) {
    clearTimeout(job.waitTimer); this.running++; job.state = 'running';
    const controller = new AbortController();
    let timer;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new ServiceError('analysis_timeout', '상품 분석 시간이 초과되었습니다.', 504));
      }, this.c.timeout); });
      const task = Promise.resolve().then(() => this.analyze(job.key, controller.signal));
      // The analyzer closes its browser on cancellation; do not release a slot until it settles.
      let product;
      try { product = await Promise.race([task, timeout]); }
      catch (error) { await task.catch(() => {}); throw error; }
      job.product = { ...product, checkedAt: new Date().toISOString(), cacheAnalysis: { hit: false } };
      job.state = 'completed';
      if (this.c.cacheEnabled) this.cache.set(job.key, { product: structuredClone(job.product), expires: Date.now() + this.c.cacheTtl });
      this.finish(job);
    } catch (error) { this.fail(job, error); }
    finally {
      clearTimeout(timer); this.running--; this.cleanup();
      const next = this.queue.shift(); if (next) void this.run(next);
    }
  }
  get(id, identity = {}) {
    this.rate(identity, true); this.cleanup();
    const job = this.jobs.get(id);
    if (!job) throw new ServiceError('job_not_found', '작업을 찾을 수 없거나 보관 시간이 만료되었습니다.', 404);
    return job;
  }
  view(job) {
    return { id: job.id, status: job.state, createdAt: new Date(job.created).toISOString(),
      ...(job.product ? { product: job.product } : {}), ...(job.error ? { error: job.error } : {}) };
  }
}
