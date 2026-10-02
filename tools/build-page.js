// Builds the whole game into ONE html file: dist/rithmatist-duel.html
//
//   npm run build:page
//
// Why: some places (like a published claude.ai page, or a Chromebook without
// Linux) can't load the game's separate JavaScript files the way `npm start`
// serves them. So this script stitches every module into a single <script>.
//
// How: each module's code goes inside its own function, so names in one file
// can't clash with names in another. `export` becomes "return these names",
// and `import { a } from './x.js'` becomes "const { a } = <x's result>".
// Online play needs the server, so this version hides the Online button.
//
// Uses only Node's built-ins, no packages.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const entry = join(root, 'src/main.js');

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?[ \t]*$/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\};?[ \t]*$/gm;
const EXPORT_DECL = /^export\s+(async\s+function|function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;

const modules = new Map(); // file → { id, code, deps }
const order = []; // dependencies first

async function load(file) {
  if (modules.has(file)) return;
  modules.set(file, null); // mark as in progress
  let code = await readFile(file, 'utf8');
  const id = '__' + relative(root, file).replace(/[^\w]/g, '_');
  const deps = [];
  const exported = [];

  code = code.replace(IMPORT, (_, names, from) => {
    const dep = resolve(dirname(file), from);
    deps.push(dep);
    const list = names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => n.replace(/\s+as\s+/, ': '));
    return `const { ${list.join(', ')} } = ${'__' + relative(root, dep).replace(/[^\w]/g, '_')};`;
  });
  code = code.replace(EXPORT_LIST, (_, names) => {
    exported.push(...names.split(',').map((n) => n.trim()).filter(Boolean));
    return '';
  });
  code = code.replace(EXPORT_DECL, (_, kind, name) => {
    exported.push(name);
    return `${kind} ${name}`;
  });
  if (/^\s*(import|export)\s/m.test(code)) throw new Error(`Unsupported import/export in ${relative(root, file)}`);

  for (const dep of deps) {
    if (modules.get(dep) === null) throw new Error(`Circular import: ${relative(root, file)} ↔ ${relative(root, dep)}`);
    await load(dep);
  }
  modules.set(file, { id, code, exported });
  order.push(file);
}

await load(entry);

const bundle = order
  .map((file) => {
    const { id, code, exported } = modules.get(file);
    return `// ---- ${relative(root, file)} ----\nconst ${id} = (() => {\n${code}\nreturn { ${exported.join(', ')} };\n})();`;
  })
  .join('\n\n');

const html = await readFile(join(root, 'index.html'), 'utf8');
const css = await readFile(join(root, 'style.css'), 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/\s*<script type="module" src="src\/main.js"><\/script>\s*/, '\n');

// A page fragment: the publishing step adds <!doctype>, <head> and <body> around it.
const page = `${title}
<style>
:root { color-scheme: dark; }
${css}
</style>
${body.trim()}
<script>window.RITHMATIST_STATIC = true; // no game server here, so no online play</script>
<script type="module">
${bundle.replace(/<\/script/gi, '<\\/script')}
</script>
`;

await mkdir(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist/rithmatist-duel.html');
await writeFile(out, page);
console.log(`Built ${relative(root, out)}: ${order.length} modules, ${(page.length / 1024).toFixed(0)} KB`);
