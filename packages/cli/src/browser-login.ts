import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { Credentials } from './config';
import { ApiClient } from './api-client';

/**
 * Browser-based `forge login` (device-style flow over localhost):
 *
 *   1. CLI listens on 127.0.0.1:<random port> and opens
 *      <api>/auth/cli/start?port=…&state=… in the browser.
 *   2. The API bounces to the web app, where the user signs in with ANY
 *      method (password, Google, GitHub — with 2FA) and approves.
 *   3. The web app redirects the browser back to the CLI's callback with a
 *      single-use code; the CLI exchanges it for tokens.
 *
 * This is what lets OAuth-only accounts (no password) use the CLI. Headless
 * fallback: the web page shows the code, `forge login --code <code>` here.
 */

const LOGIN_TIMEOUT_MS = 3 * 60 * 1000;

/** Open a URL in the user's default browser (best-effort, zero dependencies). */
function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* the printed URL is the fallback */
  }
}

const SUCCESS_PAGE =
  '<!doctype html><html><head><title>SecretForge CLI</title></head>' +
  '<body style="font-family:system-ui;background:#141416;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
  '<div style="text-align:center"><h2>Signed in to SecretForge</h2>' +
  '<p>You can close this tab and return to your terminal.</p></div></body></html>';

/** Listen on 127.0.0.1 for the web app's redirect; resolves with the code. */
function startCallbackServer(state: string): Promise<{ port: number; codePromise: Promise<string> }> {
  let server: Server;
  const codePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for browser sign-in (3 minutes). Run `forge login` again.'));
    }, LOGIN_TIMEOUT_MS);

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      // CSRF: only the flow WE started knows this state value.
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('State mismatch — ignoring.');
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('Missing code.');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(SUCCESS_PAGE);
      clearTimeout(timeout);
      server.close();
      resolve(code);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not start the local login server'));
        return;
      }
      resolve({ port: address.port, codePromise });
    });
  });
}

/** Redeem a CLI sign-in code and persist the credentials (chmod 600). */
export async function exchangeCliCode(apiUrl: string, code: string): Promise<void> {
  const res = await fetch(`${apiUrl}/auth/cli/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    console.error(body?.message ?? `CLI login failed (${res.status})`);
    process.exit(1);
  }
  const body = (await res.json()) as { accessToken: string; refreshToken: string; user: { email: string } };

  const creds: Credentials = {
    apiUrl,
    email: body.user.email,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
  new ApiClient(creds).setCredentials(creds);
  console.log(`Logged in as ${creds.email}.`);
}

/** Full browser flow: local server → open browser → wait → exchange. */
export async function browserLogin(apiUrl: string): Promise<void> {
  const state = randomBytes(16).toString('hex');
  const { port, codePromise } = await startCallbackServer(state);

  const startUrl = `${apiUrl}/auth/cli/start?port=${port}&state=${state}`;
  console.log('Opening your browser to sign in…');
  console.log(`  ${startUrl}`);
  console.log("\nIf the browser doesn't open, copy the URL above into one.");
  console.log('Headless/remote machine? Approve in any browser, then run:');
  console.log('  forge login --code <code shown on the page>\n');

  openBrowser(startUrl);
  const code = await codePromise;
  await exchangeCliCode(apiUrl, code);
}
