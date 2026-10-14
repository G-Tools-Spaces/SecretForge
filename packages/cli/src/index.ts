#!/usr/bin/env node
import { readFileSync } from 'fs';
import { Command } from 'commander';
import { join } from 'path';

// Read the version from package.json so `forge --version` never drifts.
// (__dirname works because tsc compiles this to CommonJS.)
const { version: cliVersion } = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
) as { version: string };
import {
  cmdImport,
  cmdInit,
  cmdList,
  cmdLogin,
  cmdLogout,
  cmdPull,
  cmdRun,
  cmdSet,
  cmdWhoami,
} from './commands';

const program = new Command();

program
  .name('forge')
  .alias('secretforge')
  .description('SecretForge CLI — fetch and inject secrets; no more .env files.')
  .version(cliVersion);

program
  .command('login')
  .description('log in via your browser — works with Google/GitHub and 2FA (stores tokens in ~/.secretforge)')
  .option('-u, --url <url>', 'API URL (defaults to SECRETFORGE_URL or http://localhost:4000)')
  .option('--password', 'use an email + password prompt instead of the browser')
  .option('--code <code>', 'redeem a CLI sign-in code shown by the web app (headless machines)')
  .action((opts) => cmdLogin(opts.url, { password: opts.password, code: opts.code }));

program
  .command('logout')
  .description('revoke the session and remove stored tokens')
  .action(() => cmdLogout());

program
  .command('whoami')
  .description('show the logged-in user')
  .action(() => cmdWhoami());

program
  .command('init')
  .description('link this directory to a project (writes .secretforge.json)')
  .option('-p, --project <id>', 'project ID (skips the interactive picker)')
  .option('-e, --env <env>', 'default environment (dev/staging/prod)')
  .option('-g, --group <group>', 'secret group for this directory (e.g. frontend, backend)')
  .action((opts) => cmdInit(opts.project, opts.env, opts.group));

program
  .command('set <KEY[=value]>')
  .description('create or update a secret (prompts for the value if omitted)')
  .option('-e, --env <env>', 'environment (default: project default, then "dev")')
  .option('-p, --project <id>', 'project ID (overrides .secretforge.json)')
  .option('-g, --group <group>', 'secret group (e.g. frontend, backend; default: from .secretforge.json)')
  .action((kv: string, opts: { env?: string; project?: string; group?: string }) =>
    cmdSet(kv, opts.env, opts.project, opts.group),
  );

program
  .command('list')
  .description('list secret keys for an environment (values are never shown)')
  .option('-e, --env <env>', 'environment')
  .option('-p, --project <id>', 'project ID')
  .option('-g, --group <group>', 'secret group (e.g. frontend, backend; default: from .secretforge.json)')
  .action((opts: { env?: string; project?: string; group?: string }) => cmdList(opts.env, opts.project, opts.group));

program
  .command('run <command...>')
  .description('run a command with secrets injected into its environment')
  .option('-e, --env <env>', 'environment')
  .option('-p, --project <id>', 'project ID')
  .option('-g, --group <group>', 'secret group (e.g. frontend, backend; default: from .secretforge.json)')
  .allowUnknownOption(true)
  .action((commandArgs: string[], opts: { env?: string; project?: string; group?: string }) => {
    // Everything after `--` on the command line lands in commandArgs.
    cmdRun(commandArgs, opts.env, opts.project, opts.group);
  });

program
  .command('pull')
  .description('write secrets to .env (escape hatch — prefer `forge run`)')
  .option('-e, --env <env>', 'environment')
  .option('-p, --project <id>', 'project ID')
  .option('-g, --group <group>', 'secret group (e.g. frontend, backend; default: from .secretforge.json)')
  .option('-s, --stdout', 'print to stdout instead of writing .env')
  .action((opts: { env?: string; project?: string; stdout?: boolean; group?: string }) =>
    cmdPull(opts.env, opts.project, opts.stdout ?? false, opts.group),
  );

program
  .command('import [file]')
  .description('push an existing .env file into the vault (migration helper)')
  .option('-e, --env <env>', 'environment')
  .option('-p, --project <id>', 'project ID')
  .option('-g, --group <group>', 'secret group (e.g. frontend, backend; default: from .secretforge.json)')
  .action((file: string | undefined, opts: { env?: string; project?: string; group?: string }) =>
    cmdImport(file, opts.env, opts.project, opts.group),
  );

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
