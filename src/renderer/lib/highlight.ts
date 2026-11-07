import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cmake from 'highlight.js/lib/languages/cmake';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { extOf } from '../../shared/fileKinds';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('cmake', cmake);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('python', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

const BY_EXT: Record<string, string> = {
  ino: 'cpp', c: 'cpp', h: 'cpp', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp', hh: 'cpp',
  py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', json: 'json', yaml: 'yaml', yml: 'yaml',
  ini: 'ini', toml: 'ini', cfg: 'ini', conf: 'ini', url: 'ini',
  sh: 'bash', bash: 'bash', ps1: 'powershell', cmake: 'cmake',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', css: 'css', scss: 'css', md: 'markdown',
};

const BY_NAME: Record<string, string> = {
  'cmakelists.txt': 'cmake',
  sdkconfig: 'ini',
  'sdkconfig.defaults': 'ini',
  'platformio.ini': 'ini',
};

export function languageFor(name: string): string | null {
  const lower = name.toLowerCase();
  return BY_NAME[lower] ?? BY_EXT[extOf(lower)] ?? null;
}

const MAX_HIGHLIGHT = 300 * 1024;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Returns safe HTML: either highlight.js output (escaped) or escaped plain text. */
/** For fenced code blocks in markdown: ```cpp, ```python, ```ino ... */
export function highlightFence(code: string, lang: string): string {
  const language = hljs.getLanguage(lang) ? lang : languageFor(`x.${lang}`);
  if (!language) return escapeHtml(code);
  return highlightWith(code, language).html;
}

export function highlight(code: string, name: string): { html: string; language: string | null } {
  return highlightWith(code, languageFor(name));
}

function highlightWith(code: string, language: string | null): { html: string; language: string | null } {
  if (!language || code.length > MAX_HIGHLIGHT) return { html: escapeHtml(code), language: null };
  try {
    return { html: hljs.highlight(code, { language, ignoreIllegals: true }).value, language };
  } catch {
    return { html: escapeHtml(code), language: null };
  }
}
