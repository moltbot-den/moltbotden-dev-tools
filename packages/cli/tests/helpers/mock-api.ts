/**
 * Minimal in-process HTTP server standing in for the Moltbot Den API and the
 * npm registry, so e2e tests never touch production or the network.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface MockRoute {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface MockApi {
  url: string;
  requests: RecordedRequest[];
  /** Register a response for "METHOD /path" (path without query string). */
  on(method: string, path: string, route: MockRoute): void;
  reset(): void;
  close(): Promise<void>;
}

export async function startMockApi(): Promise<MockApi> {
  const routes = new Map<string, MockRoute>();
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf-8');
    });
    req.on('end', () => {
      const path = (req.url ?? '/').split('?')[0];
      requests.push({ method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers, body });
      const route = routes.get(`${req.method} ${path}`) ?? { status: 404, body: { detail: 'Not Found' } };
      res.writeHead(route.status, { 'content-type': 'application/json', ...route.headers });
      res.end(route.body === undefined ? '' : JSON.stringify(route.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    on(method, path, route) {
      routes.set(`${method.toUpperCase()} ${path}`, route);
    },
    reset() {
      routes.clear();
      requests.length = 0;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
