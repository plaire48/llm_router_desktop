import { createServer } from 'node:https';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getHttpsServerOptions } from 'office-addin-dev-certs';
import { createApp } from './app.mjs';

export async function startServer({ serverFactory = createServer, httpsOptions = getHttpsServerOptions, logger = console } = {}) {
  const app = createApp({ webRoot: fileURLToPath(new URL('./web/', import.meta.url)) });
  const server = serverFactory(await httpsOptions(), app.handler);
  server.requestTimeout = 35000; server.headersTimeout = 10000;
  server.on('error', () => { logger.error('연결 서버를 시작하지 못했습니다. 8790 포트와 인증서 설정을 확인하세요.'); process.exitCode = 1; });
  server.listen(8790, '127.0.0.1', () => logger.log('Nubi for Excel: https://localhost:8790'));
  const stop = () => { app.close(); server.close(); server.closeAllConnections(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  return { server, close() { stop(); process.off('SIGINT', stop); process.off('SIGTERM', stop); } };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) startServer().catch(() => { console.error('localhost 개발 인증서를 준비하지 못했습니다.'); process.exitCode = 1; });
