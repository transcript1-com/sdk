import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';

type PackedType = {
  filename: string;
  files: Array<{ path: string }>;
};

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const tsc = join(root, 'node_modules/.bin/tsc');

let work = '';
let project = '';
let tarballFiles: string[] = [];

const findExpectedDist = async (): Promise<string[]> => {
  const entries = await readdir(join(root, 'src'), { withFileTypes: true, recursive: true });
  const sources = entries
    .filter(entry => entry.isFile())
    .filter(entry => entry.name.endsWith('.ts'))
    .map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .map(path => path.replace(/^src\//, 'dist/').replace(/\.ts$/, ''));

  return sources.flatMap(path => [`${path}.js`, `${path}.d.ts`]).sort();
};

const runConsumer = async (file: string): Promise<Record<string, unknown>> => {
  const { stdout } = await run('node', [file], { cwd: project });

  return JSON.parse(stdout) as Record<string, unknown>;
};

const mjsConsumer = `import { Transcript1, Transcript1Error } from '@transcript1/sdk';
import * as sdk from '@transcript1/sdk';
const client = new Transcript1({ apiKey: 't1_x' });
console.log(JSON.stringify({
  client: typeof Transcript1,
  error: typeof Transcript1Error,
  instance: client instanceof Transcript1,
  transcribe: typeof client.transcribe,
  keys: Object.keys(sdk).sort(),
}));
`;

const cjsConsumer = `const { Transcript1, Transcript1Error } = require('@transcript1/sdk');
const client = new Transcript1({ apiKey: 't1_x' });
console.log(JSON.stringify({
  client: typeof Transcript1,
  error: typeof Transcript1Error,
  instance: client instanceof Transcript1,
  transcribe: typeof client.transcribe,
  keys: Object.keys(require('@transcript1/sdk')).sort(),
}));
`;

const consumerTsconfig = {
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    skipLibCheck: false,
    types: ['node'],
    typeRoots: [join(root, 'node_modules/@types')],
  },
  include: ['consumer.ts'],
};

const publicKeys = [
  'ERROR_CODES',
  'Transcript1',
  'Transcript1Error',
];

const expectedOutput = {
  client: 'function',
  error: 'function',
  instance: true,
  transcribe: 'function',
  keys: publicKeys,
};

before(async () => {
  work = await mkdtemp(join(tmpdir(), 'sdk-package-'));
  project = join(work, 'project');
  await mkdir(project);
  await run('npm', ['run', 'build'], { cwd: root });
  const { stdout } = await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], { cwd: root });
  const [packed] = JSON.parse(stdout) as PackedType[];
  assert.ok(packed);
  tarballFiles = packed.files.map(file => file.path).sort();
  const manifest = {
    name: 'consumer',
    version: '1.1.0',
    private: true,
    type: 'module',
  };
  await writeFile(join(project, 'package.json'), JSON.stringify(manifest));
  await run('npm', ['install', join(work, packed.filename), '--offline', '--no-audit', '--no-fund'], { cwd: project });
});

after(async () => {
  await rm(work, { recursive: true, force: true });
});

test('packs only package.json, README.md, LICENSE and compiled dist files', () => {
  const top = tarballFiles.filter(path => !path.startsWith('dist/'));

  assert.deepEqual(top, ['LICENSE', 'README.md', 'package.json']);
});

test('manifest links the repository and issue tracker', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Record<string, unknown>;

  assert.deepEqual(manifest.repository, { type: 'git', url: 'git+https://github.com/transcript1-com/sdk.git' });
  assert.deepEqual(manifest.bugs, {
    email: 'support@transcript1.com',
    url: 'https://github.com/transcript1-com/sdk/issues',
  });
});

test('packs exactly one .js and one .d.ts for every source file', async () => {
  const dist = tarballFiles.filter(path => path.startsWith('dist/'));

  assert.deepEqual(dist, await findExpectedDist());
});

test('an ES module consumer constructs a client', async () => {
  await writeFile(join(project, 'consumer.mjs'), mjsConsumer);

  assert.deepEqual(await runConsumer('consumer.mjs'), expectedOutput);
});

test('a CommonJS consumer constructs a client', async () => {
  await writeFile(join(project, 'consumer.cjs'), cjsConsumer);

  assert.deepEqual(await runConsumer('consumer.cjs'), expectedOutput);
});

test('a TypeScript consumer type-checks against the installed package', async () => {
  const examples = await readFile(join(root, 'test/examples.ts'), 'utf8');
  assert.ok(examples.includes('\'../src/index.js\''));
  await writeFile(join(project, 'consumer.ts'), examples.replace('\'../src/index.js\'', '\'@transcript1/sdk\''));
  await writeFile(join(project, 'tsconfig.json'), JSON.stringify(consumerTsconfig));
  await run(tsc, ['-p', 'tsconfig.json'], { cwd: project });
});
