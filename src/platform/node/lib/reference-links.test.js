import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { platformReferences } from './platform-references.js';
import { setModuleFolders } from '../../core/roots.ts';
import { markdownPath } from '../../app/docs/referenceLinks.ts';
import globs, { archivedSystemGlobs, withSystemNegations } from '../build/vite-globs-plugin.js';
import { ENABLED_MODULES, MODULE_DIRS } from './modules.js';
import titleFromHeading from '../build/remark-title-from-heading.js';
import { frontmatter } from './frontmatter.js';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';

test('owner README and relative context links use the same browser', () => {
  const resolve = (href, base) => markdownPath(new URL(href, `http://doc${base}/`).pathname);
  // Supplied and team module source links resolve to the same owner browser.
  assert.equal(
    resolve('../../../../platform/modules/systems/README.md', '/systems/studio/context'),
    '/documentation/context/module.systems',
  );
  assert.equal(
    resolve('../../../../modules/systems/README.md', '/systems/studio/context'),
    '/documentation/context/module.systems',
  );
  assert.equal(
    resolve('../../../../modules/research/README.md', '/systems/studio/context'),
    '/documentation/context/module.research',
  );
  assert.equal(resolve('README.md', '/platform/modules/systems'), '/documentation/context/module.systems');
  assert.equal(resolve('README.md', '/modules/research'), '/documentation/context/module.research');
  assert.equal(
    resolve('../../systems/studio/context/writing.md', '/platform/modules/systems'),
    '/systems/studio/context/writing',
  );
  assert.equal(
    resolve('../../systems/product/context/writing.md', '/modules/research'),
    '/systems/product/context/writing',
  );
  // Studio's own system is in the supplied root but is addressed like any system.
  assert.equal(
    resolve('../../platform/systems/studio/context/writing.md', '/modules/research'),
    '/systems/studio/context/writing',
  );
  assert.equal(resolve('../../platform/systems/studio/README.md', '/modules/research'), '/systems/studio');
  assert.equal(resolve('./main.tsx', '/prototypes/samples/example'), '/prototypes/samples/example/main.tsx');
  assert.equal(markdownPath('/platform/modules/documentation/pages/prototypes.md'), '/documentation/manual/prototypes');
  assert.equal(markdownPath('/platform/modules/documentation/pages/index.md'), '/documentation/manual');
  assert.equal(markdownPath('/modules/documentation/pages/prototypes.md'), '/documentation/manual/prototypes');
  assert.equal(markdownPath('/platform/modules/README.md'), '/documentation/context/platform.core/context/modules');
  assert.equal(markdownPath('/modules/README.md'), '/documentation/context/platform.core/context/modules');
  assert.equal(markdownPath('/systems/product/README.md'), '/systems/product');
  assert.equal(markdownPath('/platform/README.md'), '/documentation/context/platform.core');
});

test('overview discovery uses original owner READMEs and enabled module documents', () => {
  const result = globs().transform(
    "const pages = import.meta.glob(['/__studio_references__/*'])",
    '/src/platform/app/docs/loadReference.ts',
  );
  assert.ok(result);
  const patterns = JSON.parse(result.code.slice('const pages = import.meta.glob('.length, -1));
  // A module's documents are found in whichever root holds it (supplied or team).
  assert.deepEqual(
    [...patterns].sort(),
    ['/platform/README.md', ...ENABLED_MODULES.map(m => `/${MODULE_DIRS[m.id].replace(/^src\//, '')}*.md`)].sort(),
  );
});

test('contracts render every section and extract only the opening title', () => {
  const heading = (depth, value) => ({ type: 'heading', depth, children: [{ type: 'text', value }] });
  const sections = [
    heading(2, 'For developers'),
    { type: 'paragraph', children: [{ type: 'text', value: 'Contract' }] },
  ];
  const tree = { children: [heading(1, 'System "contract": details'), ...sections] };
  titleFromHeading()(tree, { basename: 'README.md' });
  assert.equal(frontmatter('---\n' + tree.children[0].value + '\n---').title, 'System "contract": details');
  assert.deepEqual(tree.children.slice(1), sections);
  assert.doesNotThrow(() => remarkMdxFrontmatter()({ type: 'root', ...tree }, {}));
});

test('frontmatter titles suppress only a matching opening H1', () => {
  for (const value of [
    'title: Studio configuration',
    'title: "Studio configuration"',
    "title: 'Studio configuration'",
    'title: >\n  Studio configuration',
  ]) {
    const yaml = { type: 'yaml', value };
    const section = { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Settings' }] };
    const tree = {
      children: [
        yaml,
        {
          type: 'heading',
          depth: 1,
          children: [
            { type: 'text', value: 'Studio ' },
            { type: 'emphasis', children: [{ type: 'text', value: 'configuration' }] },
          ],
        },
        section,
      ],
    };
    titleFromHeading()(tree, { basename: 'config.md' });
    assert.deepEqual(tree.children, [yaml, section]);
  }
});

test('frontmatter titles preserve differing and non-opening headings', () => {
  const yaml = { type: 'yaml', value: 'title: Overview' };
  const heading = { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Details' }] };
  const paragraph = { type: 'paragraph', children: [{ type: 'text', value: 'Introduction' }] };
  for (const body of [[heading], [paragraph, { ...heading, children: [{ type: 'text', value: 'Overview' }] }]]) {
    const tree = { children: [yaml, ...body] };
    titleFromHeading()(tree, { basename: 'example.md' });
    assert.deepEqual(tree.children, [yaml, ...body]);
  }
});

test('skill names supply task titles when no heading is present', () => {
  const tree = {
    children: [
      { type: 'yaml', value: 'name: use-canvas\ndescription: Create a canvas.' },
      { type: 'paragraph', children: [{ type: 'text', value: 'Instructions' }] },
    ],
  };
  titleFromHeading()(tree, { basename: 'SKILL.md' });
  assert.match(tree.children[0].value, /title: "Use canvas"/);
  assert.equal(tree.children[1].type, 'paragraph');
});

test('technical context and skill source links resolve without a duplicate Reference reader', () => {
  assert.equal(markdownPath('/platform/context/personas.md'), '/documentation/context/platform.core/context/personas');
  assert.equal(
    markdownPath('/platform/context/file-types.md'),
    '/documentation/context/platform.core/context/file-types',
  );
  assert.equal(
    markdownPath('/platform/modules/prototypes/skills/build-prototype/SKILL.md'),
    '/documentation/context/module.prototypes/skills/build-prototype/SKILL',
  );
});

test('archived systems are left out of the build in whichever root they are in', () => {
  const specs = {
    studio: { status: 'active', dir: 'src/platform/systems/studio/' },
    old: { status: 'archived', dir: 'src/systems/old/' },
    older: { status: 'archived', dir: 'src/platform/systems/older/' },
  };
  assert.deepEqual(archivedSystemGlobs(specs), ['!/systems/old/**', '!/platform/systems/older/**']);
  const negations = archivedSystemGlobs(specs);
  assert.equal(
    withSystemNegations(
      "import.meta.glob<string>(['/platform/systems/*/intro.tsx', '/systems/*/intro.tsx'], { eager: true })",
      negations,
    ),
    'import.meta.glob<string>([\'/platform/systems/*/intro.tsx\', \'/systems/*/intro.tsx\',"!/systems/old/**","!/platform/systems/older/**"], { eager: true })',
  );
  const unrelated = "import.meta.glob('/modules/*/module.ts')";
  assert.equal(withSystemNegations(unrelated, negations), unrelated);
  assert.equal(
    withSystemNegations("import.meta.glob('/systems/*/system.ts')", []),
    "import.meta.glob('/systems/*/system.ts')",
  );
});

for (const base of ['modules', 'platform/modules'])
  test(`owner discovery preserves canonical sources and availability in ${base}`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-owner-links-'));
    setModuleFolders([['example', `src/${base}/example`]]);
    t.after(() => {
      setModuleFolders([]);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const write = (file, text) => {
      fs.mkdirSync(path.dirname(path.join(root, 'src', file)), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', file), text);
    };
    const toPlatform = base === 'modules' ? '../../../platform/README.md' : '../../../README.md';
    write('platform/README.md', '# Platform');
    write('platform/context/config.md', '# Configuration');
    write(`${base}/example/README.md`, '---\ntitle: Example capability\n---\n# Example');
    write(`${base}/example/extra.md`, '# Additional contract');
    write(
      `${base}/example/context/configure.md`,
      `# Configure\n[Platform](${toPlatform}#context)\n[Additional](../extra.md)\n[Remote](https://example.com/extra.md)`,
    );
    write(`${base}/example/context/example.md`, '# Example workflow\n```md\n[Additional](../extra.md)\n```');
    write('systems/product/README.md', '# Product');
    const systemContent = [
      {
        id: 'module.example:context',
        contributorKey: 'system-content',
        system: 'module.example',
        title: 'Context',
        artifacts: ['configure.md', 'example.md'].map(path => ({ path })),
      },
      {
        id: 'product:context',
        contributorKey: 'system-content',
        system: 'product',
        title: 'Context',
        artifacts: [],
        owner: { kind: 'system', id: 'product', label: 'Product', root: 'src/systems/product' },
      },
    ];
    const modules = [{ id: 'example', label: 'Example', instructions: [{ path: 'context/example.md' }] }];
    const discover = enabled => platformReferences({ root, modules, enabled, systemContent });
    const groups = discover(['example']);
    const core = groups.find(group => group.id === 'core');
    assert.deepEqual(
      core.references.map(ref => ref.source),
      ['/platform/README.md'],
    );
    assert.deepEqual(
      core.references[0].related.map(ref => ref.title),
      ['module.example · Context · Configure'],
    );
    assert.ok(!groups.some(group => group.id === 'system.product'));
    const refs = groups.find(group => group.id === 'example').references;
    assert.deepEqual(
      refs.map(ref => ref.source),
      [`/${base}/example/README.md`, `/${base}/example/extra.md`],
    );
    assert.ok(
      refs.every(ref => ref.related.length === 1),
      'fenced and remote links must not add guidance',
    );
    assert.equal(refs[0].title, 'Example capability');
    assert.equal(refs[1].title, 'Additional contract');
    assert.equal(refs[0].related[0].href, markdownPath(`/${base}/example/context/example.md`));
    assert.equal(refs[1].related[0].href, markdownPath(`/${base}/example/context/configure.md`));
    assert.equal(discover([]).find(group => group.id === 'example').enabled, false);
    assert.equal(markdownPath(refs[0].source), '/documentation/context/module.example');
    fs.rmSync(path.join(root, `src/${base}/example/README.md`));
    assert.deepEqual(
      discover(['example'])
        .find(group => group.id === 'example')
        .references.map(ref => ref.source),
      [`/${base}/example/extra.md`],
    );
    assert.deepEqual(discover([]).find(group => group.id === 'example').references, []);
  });
