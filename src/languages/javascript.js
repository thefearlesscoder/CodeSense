const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const { fileId, functionId, classId } = require('../ids');

const FUNCTION_TYPES = new Set(['function_declaration', 'function', 'arrow_function', 'method_definition']);
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx']);

const javascriptAdapter = {
  name: 'javascript',
  supports(filePath) {
    return EXTENSIONS.has(filePath.slice(filePath.lastIndexOf('.')));
  },
  parse({ source, relativePath }) {
    const parser = new Parser();
    parser.setLanguage(JavaScript);
    const tree = parser.parse(source);
    const fileNode = { id: fileId(relativePath), type: 'File', path: relativePath, language: 'javascript', imports: [] };
    const nodes = [fileNode];
    const edges = [];
    const importPaths = [];
    const calls = [];

    walk(tree.rootNode, (node, ancestors) => {
      if (node.type === 'import_statement') {
        const sourceNode = node.childForFieldName('source');
        if (sourceNode) importPaths.push(unquote(source.slice(sourceNode.startIndex, sourceNode.endIndex)));
      }

      if (node.type === 'call_expression') {
        const functionNode = node.childForFieldName('function');
        const callName = functionNode && source.slice(functionNode.startIndex, functionNode.endIndex);
        if (callName === 'require') {
          const argument = node.childForFieldName('arguments')?.namedChildren[0];
          if (argument) importPaths.push(unquote(source.slice(argument.startIndex, argument.endIndex)));
        } else if (callName && /^[A-Za-z_$][\w$]*$/.test(callName)) {
          calls.push({ name: callName, from: containingDefinition(ancestors, relativePath, source) });
        }
      }

      if (isFunctionNode(node)) {
        const name = definitionName(node, source);
        if (!name) return;
        const id = functionId(relativePath, name, node.startPosition.row + 1);
        nodes.push({ id, type: 'Function', name, signature: source.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 200)).split('{')[0].trim(), docstring: leadingDocstring(source, node.startPosition.row) });
        edges.push({ type: 'DEFINES', from: fileId(relativePath), to: id });
      }

      if (node.type === 'class_declaration' || node.type === 'class') {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : null;
        if (!name) return;
        const id = classId(relativePath, name, node.startPosition.row + 1);
        nodes.push({ id, type: 'Class', name, docstring: leadingDocstring(source, node.startPosition.row) });
        edges.push({ type: 'DEFINES', from: fileId(relativePath), to: id });
      }
    });

    fileNode.imports = [...new Set(importPaths)];
    return { relativePath, nodes, edges, importPaths, calls };
  },
};

function walk(node, callback, ancestors = []) {
  callback(node, ancestors);
  for (const child of node.namedChildren) walk(child, callback, [...ancestors, node]);
}

function isFunctionNode(node) { return FUNCTION_TYPES.has(node.type); }

function definitionName(node, source) {
  const nameNode = node.childForFieldName('name');
  if (nameNode) return source.slice(nameNode.startIndex, nameNode.endIndex);
  if (node.type === 'method_definition') {
    const property = node.childForFieldName('name') || node.childForFieldName('property');
    return property ? source.slice(property.startIndex, property.endIndex) : null;
  }
  return null;
}

function containingDefinition(ancestors, relativePath, source) {
  const definition = [...ancestors].reverse().find(isFunctionNode);
  if (!definition) return fileId(relativePath);
  const name = definitionName(definition, source);
  return name ? functionId(relativePath, name, definition.startPosition.row + 1) : fileId(relativePath);
}

function leadingDocstring(source, row) {
  const lines = source.split(/\r?\n/);
  const comments = [];
  for (let index = row - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) break;
    if (line.startsWith('/**') || line.startsWith('*') || line.endsWith('*/')) comments.unshift(line);
    else if (line.startsWith('//')) comments.unshift(line.slice(2).trim());
    else break;
  }
  return comments.length ? comments.join(' ').replace(/^\/\*\*?\s?/, '').replace(/\s?\*\/$/, '').trim() : null;
}

function unquote(value) { return value.replace(/^['"]|['"]$/g, ''); }

module.exports = { javascriptAdapter };
