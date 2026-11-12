import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AdminAuth } from './admin-auth.js';

export function createAdminServer({ settings, jobs, ai, origin = 'http://localhost:8080', onSettingsChanged = () => {} }) {
  const publicUrl = new URL(origin);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) throw new Error('ADMIN_PUBLIC_ORIGIN을 확인해 주세요.');
  const auth = new AdminAuth(settings.authFile);
  const cookie = token => `gd_admin=${token}; Path=/; HttpOnly; SameSite=Strict; ${publicUrl.protocol === 'https:' ? 'Secure; ' : ''}Max-Age=${token ? 1800 : 0}`;
  const assets = { '/': ['admin/index.html', 'text/html; charset=utf-8'], '/app.js': ['admin/app.js', 'text/javascript; charset=utf-8'], '/style.css': ['admin/style.css', 'text/css; charset=utf-8'] };
  const server = http.createServer(async (req, res) => {
    const send = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.headers.host?.toLowerCase() !== publicUrl.host.toLowerCase()) return send(403, { message: '허용되지 않은 접속 주소입니다.' });
    if (req.method === 'GET' && assets[req.url]) {
      const [file, type] = assets[req.url];
      try { res.writeHead(200, { 'Content-Type': type }); return res.end(fs.readFileSync(fileURLToPath(new URL(file, import.meta.url)))); }
      catch { return send(503, { message: '운영자 화면을 읽을 수 없습니다.' }); }
    }
    if (!['GET', 'POST'].includes(req.method)) return send(405, { message: '지원하지 않는 요청입니다.' });
    if (req.method === 'POST' && req.headers.origin !== publicUrl.origin) return send(403, { message: '요청 출처가 올바르지 않습니다.' });
    let body = {};
    if (req.method === 'POST') {
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return send(415, { message: 'JSON 요청만 지원합니다.' });
      try {
        let data = '';
        for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 32768) return send(413, { message: '요청이 너무 큽니다.' }); }
        body = JSON.parse(data);
        if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
      } catch { return send(400, { message: '요청 형식이 올바르지 않습니다.' }); }
    }
    if (req.method === 'GET' && req.url === '/api/session') {
      const session = auth.session(req);
      return send(200, { configured: auth.configured(), authenticated: !!session, username: session?.username, csrf: session?.csrf });
    }
    if (req.method === 'POST' && req.url === '/api/login') {
      if (!auth.configured()) return send(503, { message: '터미널에서 운영자를 먼저 등록해 주세요.' });
      try {
        const login = await auth.login(body.username, body.password, String(req.headers['x-admin-client-ip'] || req.socket.remoteAddress));
        if (!login) return send(401, { message: 'ID 또는 비밀번호를 확인해 주세요.' });
        res.setHeader('Set-Cookie', cookie(login.token)); return send(200, { ok: true, csrf: login.csrf });
      } catch { return send(429, { message: '로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.' }); }
    }
    const session = auth.session(req);
    if (!session) return send(401, { message: '운영자 로그인이 필요합니다.' });
    if (req.method === 'POST' && req.headers['x-csrf-token'] !== session.csrf) return send(403, { message: '인증 정보가 만료되었습니다. 다시 로그인해 주세요.' });
    if (req.method === 'POST' && req.url === '/api/logout') {
      auth.logout(req); res.setHeader('Set-Cookie', cookie('')); return send(200, { ok: true });
    }
    if (req.method === 'GET' && req.url === '/api/settings') return send(200, settings.view());
    if (req.method === 'GET' && req.url === '/api/overview') {
      return send(200, { ...jobs.stats(), ai: ai.usage(), settingsRevision: settings.current().revision, time: new Date().toISOString() });
    }
    if (req.method === 'POST' && req.url === '/api/settings') {
      try {
        const result = settings.save(body, session.username);
        onSettingsChanged(); return send(200, { ok: true, ...result });
      } catch (error) { return send(error.status || 400, { message: error.message }); }
    }
    return send(404, { message: '경로를 찾을 수 없습니다.' });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
