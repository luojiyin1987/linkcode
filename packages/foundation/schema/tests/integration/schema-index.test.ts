import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const GENERATOR = join(process.cwd(), 'tools', 'gen-schema-index.cjs');

function makeFixture(payload: string, modules: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'linkcode-schema-index-test-'));
  roots.push(root);

  const toolsDir = join(root, 'tools');
  const wireDir = join(root, 'packages', 'foundation', 'schema', 'src', 'wire');
  mkdirSync(toolsDir, { recursive: true });
  mkdirSync(wireDir, { recursive: true });
  mkdirSync(join(root, 'docs'));
  copyFileSync(GENERATOR, join(toolsDir, 'gen-schema-index.cjs'));
  writeFileSync(join(wireDir, 'payload.ts'), payload);

  for (const [file, source] of Object.entries(modules)) {
    writeFileSync(join(wireDir, file), source);
  }

  return root;
}

function generate(root: string): string {
  execFileSync(process.execPath, [join(root, 'tools', 'gen-schema-index.cjs')]);
  return readFileSync(join(root, 'docs', 'SCHEMA-INDEX.md'), 'utf8');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('schema index generator', () => {
  it('ignores a spread that is commented out in payload.ts', () => {
    const root = makeFixture(
      [
        "import { activeWireVariants } from './active';",
        "import { removedWireVariants } from './removed';",
        "export const WirePayloadSchema = z.discriminatedUnion('kind', [",
        '  ...activeWireVariants,',
        '  // ...removedWireVariants,',
        ']);',
      ].join('\n'),
      {
        'active.ts': "z.object({ kind: z.literal('request.start'), clientReqId: z.string() });\n",
        'removed.ts': "z.object({ kind: z.literal('request.cancel'), clientReqId: z.string() });\n",
      },
    );

    const markdown = generate(root);

    expect(markdown).toContain('`request.start`');
    expect(markdown).not.toContain('`request.cancel`');
  });

  it('ignores a wire module that payload.ts does not include', () => {
    const root = makeFixture(
      [
        "import { activeWireVariants } from './active';",
        "export const WirePayloadSchema = z.discriminatedUnion('kind', [",
        '  ...activeWireVariants,',
        ']);',
      ].join('\n'),
      {
        'active.ts': "z.object({ kind: z.literal('request.start'), clientReqId: z.string() });\n",
        'unused.ts': "z.object({ kind: z.literal('request.cancel'), clientReqId: z.string() });\n",
      },
    );

    const markdown = generate(root);

    expect(markdown).toContain('`request.start`');
    expect(markdown).not.toContain('`request.cancel`');
  });

  it('rejects duplicate kinds in included wire modules', () => {
    const root = makeFixture(
      [
        "import { firstWireVariants } from './first';",
        "import { secondWireVariants } from './second';",
        "export const WirePayloadSchema = z.discriminatedUnion('kind', [",
        '  ...firstWireVariants,',
        '  ...secondWireVariants,',
        ']);',
      ].join('\n'),
      {
        'first.ts': "z.object({ kind: z.literal('request.start'), clientReqId: z.string() });\n",
        'second.ts': "z.object({ kind: z.literal('request.start'), clientReqId: z.string() });\n",
      },
    );

    const result = spawnSync(process.execPath, [join(root, 'tools', 'gen-schema-index.cjs')], {
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Duplicate wire kind 'request.start'");
  });
});
