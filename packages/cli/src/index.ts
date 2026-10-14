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
  .description('log in to a SecretForge server (stores tokens in ~/.secretforge)')
  .option('-u, --url <url>', 'API URL (defaults to SECRETFORGE_URL or http://localhost:4000)')
  .action((opts) => cmdLogin(opts.url));

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
  .action((opts) => cmdInit(opts.project, opts.env));

program
  .command('set <KEY[=value]>')
  .description('create or update a secret (prompts for the value if omitted)')
  .option('-e, --env <env>', 'environment (default: project default, then "dev")')
  .option('-p, --project <id>', 'project ID (overrides .secretforge.json)')
  .action((kv: string, opts: { env?: string; project?: string }) =>
    cmdSet(kv, opts.env, opts.project),
  );

program
  .command('list')
  .description('list secret keys for an environment (values are never shown)')
  .option('-e, --env <env>', 'environment')
  .option('-p, --project <id>', 'project ID')
  .action((opts: { env?: string; project?: string }) => cmdList(opts.env, opts.project));

program
  .command('run <command...>')
  .description('run a command with secrets injected into its environment')
  .option('-e, --env <env>', 'environment')
  .option('-p, --project <id>', 'project ID')
  .allowUnknownOption(true)
  .action((commandArgs: string[], opts: { env?: string; project?: string }) => {
    // Everything after `--` on the command line lands in commandArgs.
    cmdRun(commandArgs, opts.env, opts.project);
  });

program
  .command('pull')
  .description('write secrets to .env (escape hatch — prefer `forge run`)')
  .option('-e, --env <env>', 'environment')
  .option('-p, --project <id>', 'project ID')
  .option('-s, --stdout', 'print to stdout instead of writing .env')
  .action((opts: { env?: string; project?: string; stdout?: boolean }) =>
    cmdPull(opts.env, opts.project, opts.stdout ?? false),
  );

program
  .command('import [file]')
  .description('push an existing .env file into the vault (migration helper)')
  .option('-e, --env <env>', 'environment')
  .option('-p, --project <id>', 'project ID')
  .action((file: string | undefined, opts: { env?: string; project?: string }) =>
    cmdImport(file, opts.env, opts.project),
  );

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
