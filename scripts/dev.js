// Разработка одной командой: API-сервер (с перезапуском при правках) + Vite с HMR.
// PORT из окружения не наследуем: API всегда на API_PORT (8787), Vite — на 5177 и проксирует /api.
import { spawn } from 'node:child_process';

const env = { ...process.env, PORT: process.env.API_PORT || '8787' };
const procs = [
  spawn(process.execPath, ['--watch', '--disable-warning=ExperimentalWarning', 'server/index.js'], { stdio: 'inherit', env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
const stop = () => { procs.forEach(p => p.kill()); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach(p => p.on('exit', code => { if (code) stop(); }));
