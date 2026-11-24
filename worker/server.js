import http from 'node:http';
import { chromium } from 'playwright';
import { AiService } from './ai.js';
import { JobManager, ServiceError } from './jobs.js';
import { SettingsStore } from './settings.js';
import { createAdminServer } from './admin-server.js';
import { createAnalyzer } from './analyzer.js';

const PORT = 3000;
const TOKEN = process.env.WORKER_TOKEN || 'local_worker_token_change_me';
const MAX_BODY = 16 * 1024;
const settings = new SettingsStore();
const config = settings.current();
const ai = new AiService(config);
const analyze = createAnalyzer({ chromium, ai });
const jobs = new JobManager(config, analyze, () => settings.current());
const admin = createAdminServer({ settings, jobs, ai, origin: process.env.ADMIN_PUBLIC_ORIGIN || 'http://localhost:8080', onSettingsChanged: () => jobs.drain() });
admin.listen(3001, '127.0.0.1');
const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'GET' && req.url === '/health') {
        return res.end(JSON.stringify({ ok: true }));
    }
    if (!TOKEN || req.headers['x-worker-token'] !== TOKEN) { 
        res.statusCode = 403;
        return res.end(JSON.stringify({ ok: false, message: '접근할 수 없습니다.' }));
    }
    const identity = { ip: String(req.headers['x-client-ip'] || 'unknown'), user: String(req.headers['x-client-user'] || '') };
    const sendError = error => { 
        res.statusCode = error.status || 422;
        if ([429, 503].includes(res.statusCode)) {
            res.setHeader('Retry-After', '60');
        }
        res.end(JSON.stringify({ ok: false, code: error.code || 'analysis_failed', message: error.message || '상품 분석 실패' }));
     };
    const jobId = req.url?.match(/^\/jobs\/([a-f0-9]{48})$/)?.[1];
    if (req.method === 'GET' && jobId) {
        try { return res.end(JSON.stringify({ ok: true, job: jobs.view(jobs.get(jobId, identity)) })); } catch (error) { return sendError(error); }
    }
    if (req.method !== 'POST' || !['/analyze', '/jobs'].includes(req.url)) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ ok: false, message: '경로를 찾을 수 없습니다.' }));
    }
    let body = '';
    req.on('data', (chunk) => { 
        body += chunk;
        if (body.length > MAX_BODY) {
            req.destroy();
        }
    });
    req.on('end', async () => {
        try {
            let input;
            try { input = JSON.parse(body); } catch { throw new ServiceError('invalid_json', '올바른 JSON 본문을 보내 주세요.', 400); }
            if (typeof input?.url !== 'string') throw new ServiceError('invalid_url', 'url 문자열이 필요합니다.', 400);
            const job = jobs.submit(input.url, identity);
            if (req.url === '/jobs') { res.statusCode = 202; return res.end(JSON.stringify({ ok: true, job: jobs.view(job) })); }
            await job.promise;
            if (job.error) throw Object.assign(new Error(job.error.message), job.error);
            res.end(JSON.stringify({ ok: true, product: job.product }));
        } catch (error) { sendError(error); }
    });
});

server.listen(PORT, '0.0.0.0');
