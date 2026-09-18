function fileId(relativePath) { return `file:${relativePath}`; }
function functionId(relativePath, name, line) { return `function:${relativePath}:${name}:${line}`; }
function classId(relativePath, name, line) { return `class:${relativePath}:${name}:${line}`; }

module.exports = { fileId, functionId, classId };
