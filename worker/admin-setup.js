import path from 'node:path';
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { createAdmin } from './admin-auth.js';
import { loadConfig } from './config.js';

if (!process.stdin.isTTY) throw new Error('대화형 터미널에서 실행해 주세요.');
const file = process.env.ADMIN_AUTH_FILE || path.join(path.dirname(process.env.SETTINGS_FILE || loadConfig().stateFile), 'admin-auth.json');
if (fs.existsSync(file)) throw new Error('운영자 인증 파일이 이미 있습니다. 기존 파일은 덮어쓰지 않습니다.');
let muted = false;
const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
output.isTTY = true;
const rl = createInterface({ input: process.stdin, output, terminal: true });
const ask = text => new Promise(resolve => rl.question(text, resolve));
try {
  const username = (await ask('운영자 ID (기본 admin): ')).trim() || 'admin';
  process.stdout.write('비밀번호 (12자 이상, 표시되지 않음): '); muted = true;
  const password = await ask('admin');
  muted = false; process.stdout.write('\n비밀번호 확인: '); muted = true;
  const confirm = await ask(''); muted = false; process.stdout.write('\n');
  if (password !== confirm) throw new Error('비밀번호가 일치하지 않습니다.');
  createAdmin(file, username, password);
  process.stdout.write('운영자 등록 완료. 설정 페이지에서 로그인하세요. 기존 계정 파일은 덮어쓰지 않습니다.\n');
} finally { rl.close(); }
