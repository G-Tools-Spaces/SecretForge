import * as readline from 'readline';

/**
 * Prompt utilities.
 *
 * TTY: normal readline for visible prompts; raw-mode no-echo for hidden ones.
 *
 * Piped stdin (scripts/CI): ALL of stdin is read up front into a line buffer,
 * and prompts consume lines from it in order. This is the only reliable way to
 * answer multiple prompts from a pipe — readline interfaces discard buffered
 * data when closed, which breaks sequential prompts.
 */

let pipedLines: string[] | null = null;
let pipedPromise: Promise<void> | null = null;

function readAllPipedStdin(): Promise<void> {
  if (pipedPromise) return pipedPromise;
  pipedPromise = new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (c: Buffer) => chunks.push(c));
    process.stdin.on('end', () => {
      pipedLines = chunks.join('').split(/\r?\n/);
      resolve();
    });
    process.stdin.on('error', () => {
      pipedLines = [];
      resolve();
    });
    process.stdin.resume();
  });
  return pipedPromise;
}

/** Plain visible prompt (email, selections, …). */
export function prompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return readAllPipedStdin().then(() => {
      const line = pipedLines?.shift() ?? '';
      process.stdout.write(`${question}${line}\n`);
      return line.trim();
    });
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Hidden prompt for passwords/secret values.
 * Piped stdin: consumed from the shared line buffer (values are visible in
 * the pipe, which is fine — the pipe content is already in the caller's hands).
 */
export function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return prompt(question);
  }

  return new Promise((resolve) => {
    process.stdout.write(question);
    let value = '';

    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();

    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        // Ctrl+C — restore the terminal before exiting.
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else if (ch === '\t') {
        // ignore tabs
      } else {
        value += ch;
      }
    };

    process.stdin.on('data', onData);
  });
}
