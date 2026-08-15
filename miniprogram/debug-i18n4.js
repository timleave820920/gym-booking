// 终极调试：hook module 内部
global.wx = { getStorageSync: () => '', setStorageSync: () => {} };
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'utils', 'i18n.js');
let src = fs.readFileSync(filePath, 'utf8');

// 在文件末尾追加诊断输出（临时）
src = src.replace(
  'module.exports = {',
  'console.log("[diag] DICT type:", typeof DICT);\n' +
  'console.log("[diag] DICT zh keys:", DICT && DICT.zh ? Object.keys(DICT.zh).length : "N/A");\n' +
  'console.log("[diag] currentLang:", typeof currentLang);\n' +
  'module.exports = {'
);

// 用模块系统执行
const Module = require('module');
const m = new Module(filePath, module);
m.filename = filePath;
m.paths = Module._nodeModulePaths(path.dirname(filePath));
m._compile(src, filePath);

console.log('=== 导出 t() ===');
console.log('t() gymName:', m.exports.t() ? m.exports.t().gymName : 'undefined');
