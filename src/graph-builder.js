const path = require('node:path');
const { fileId } = require('./ids');

function buildGraph(repoPath, files, parsedFiles) {
  const relativeFiles = new Set(files.map((file) => toPosix(path.relative(repoPath, file))));
  return buildGraphFromParsed(path.basename(repoPath), relativeFiles, parsedFiles);
}

function buildGraphFromParsed(repoName, relativeFiles, parsedFiles) {
  const nodes = parsedFiles.flatMap((file) => file.nodes);
  const edges = parsedFiles.flatMap((file) => file.edges);
  const functionsByName = indexFunctions(nodes);

  for (const file of parsedFiles) {
    for (const importPath of file.importPaths) {
      const targetPath = resolveImport(file.relativePath, importPath, relativeFiles);
      if (targetPath) edges.push({ type: 'IMPORTS', from: fileId(file.relativePath), to: fileId(targetPath) });
    }

    for (const call of file.calls) {
      const target = functionsByName.get(call.name);
      if (target) edges.push({ type: 'CALLS', from: call.from, to: target.id });
    }
  }

  return { schema_version: 1, repo: repoName, nodes, edges: uniqueEdges(edges) };
}

function indexFunctions(nodes) {
  const index = new Map();
  for (const node of nodes) {
    if (node.type === 'Function' && !index.has(node.name)) index.set(node.name, node);
  }
  return index;
}

function resolveImport(importer, importPath, files) {
  if (!importPath.startsWith('.')) return null;
  const base = path.normalize(path.join(path.dirname(importer), importPath));
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.jsx`, path.join(base, 'index.js')];
  return candidates.map(toPosix).find((candidate) => files.has(candidate)) || null;
}

function uniqueEdges(edges) {
  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.type}:${edge.from}:${edge.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toPosix(value) { return value.split(path.sep).join('/'); }

module.exports = { buildGraph, buildGraphFromParsed };
