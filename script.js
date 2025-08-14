(function() {
  const form = document.getElementById('generatorForm');
  const codeEl = document.getElementById('code');
  const contextEl = document.getElementById('context');
  const languageEl = document.getElementById('language');
  const projectNameEl = document.getElementById('projectName');
  const repoUrlEl = document.getElementById('repoUrl');
  const ownerEl = document.getElementById('owner');
  const outputTypeEl = document.getElementById('outputType');
  const outputEl = document.getElementById('output');
  const previewEl = document.getElementById('preview');
  const viewRawBtn = document.getElementById('viewRaw');
  const viewPreviewBtn = document.getElementById('viewPreview');
  const editBtn = document.getElementById('editBtn');
  const saveBtn = document.getElementById('saveBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const copyBtn = document.getElementById('copyBtn');
  
  let originalContent = '';
  const downloadBtn = document.getElementById('downloadBtn');
  const clearBtn = document.getElementById('clearBtn');
  const sampleBtn = document.getElementById('sampleBtn');
  const generateBtn = document.getElementById('generateBtn');
  const enableAiEl = document.getElementById('enableAi');
  const aiProviderEl = document.getElementById('aiProvider');
  const aiModelEl = document.getElementById('aiModel');
  const aiModelCustomRow = document.getElementById('aiModelCustomRow');
  const aiModelCustomEl = document.getElementById('aiModelCustom');
  const aiTemperatureEl = document.getElementById('aiTemperature');
  const aiKeyEl = document.getElementById('aiKey');
  const aiMaxTokensEl = document.getElementById('aiMaxTokens');
  const scanBtn = document.getElementById('scanBtn');
  const scanLog = document.getElementById('scanLog');
  const ghTokenEl = document.getElementById('ghToken');
  const ghMaxFilesEl = document.getElementById('ghMaxFiles');
  const ghMaxBytesEl = document.getElementById('ghMaxBytes');
  const ghConcurrencyEl = document.getElementById('ghConcurrency');
  const aiMaxInputTokensEl = document.getElementById('aiMaxInputTokens');
  const aiTpmLimitEl = document.getElementById('aiTpmLimit');
  const aiSummaryTokensEl = document.getElementById('aiSummaryTokens');
  const aiHierarchyEl = document.getElementById('aiHierarchy');

  function getSelectedModel() {
    const selected = aiModelEl && aiModelEl.value;
    if (selected === 'custom') {
      const custom = (aiModelCustomEl && aiModelCustomEl.value || '').trim();
      return custom || 'gpt-4o-mini';
    }
    return (selected && selected.trim()) || 'gpt-4o-mini';
  }

  function trimMultiline(text) {
    return (text || '').replace(/^\n+|\n+$/g, '');
  }

  function ts() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function logScan(line) {
    if (!scanLog) return;
    const entry = `[${ts()}] ${line}`;
    scanLog.textContent += (scanLog.textContent ? "\n" : "") + entry;
    scanLog.scrollTop = scanLog.scrollHeight;
  }

  function approxTokensFromChars(chars) {
    return Math.ceil((chars || 0) / 4);
  }

  async function withConcurrency(limit, items, worker) {
    const ret = [];
    let i = 0;
    const running = new Set();
    async function runNext() {
      if (i >= items.length) return;
      const idx = i++;
      const p = Promise.resolve(worker(items[idx], idx)).then((v) => { ret[idx] = v; running.delete(p); });
      running.add(p);
      if (running.size >= limit) await Promise.race(running);
      return runNext();
    }
    const starters = [];
    for (let k = 0; k < Math.min(limit, items.length); k++) starters.push(runNext());
    await Promise.all(starters);
    await Promise.all(Array.from(running));
    return ret;
  }

  function parseGitHubUrl(url) {
    try {
      const u = new URL(url);
      if (u.hostname !== 'github.com') return null;
      const parts = u.pathname.replace(/^\//, '').split('/');
      const owner = parts[0];
      let repo = parts[1];
      if (repo) repo = repo.replace(/\.git$/i, '');
      let ref = 'HEAD';
      let path = '';
      const treeIdx = parts.indexOf('tree');
      if (treeIdx >= 0) {
        ref = parts[treeIdx + 1] || 'HEAD';
        path = parts.slice(treeIdx + 2).join('/');
      }
      return owner && repo ? { owner, repo, ref, path } : null;
    } catch (_) {
      return null;
    }
  }

  async function ghJson(url, token) {
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    return await res.json();
  }

  async function getDefaultBranch({ owner, repo, token }) {
    const api = `https://api.github.com/repos/${owner}/${repo}`;
    const data = await ghJson(api, token);
    return data && data.default_branch ? data.default_branch : 'main';
  }

  async function listRepoFiles({ owner, repo, ref, token, basePath = '' }) {
    const resolvedRef = ref === 'HEAD' ? await getDefaultBranch({ owner, repo, token }) : ref;
    logScan(`Resolved ref: ${ref} -> ${resolvedRef}`);
    const api = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(resolvedRef)}?recursive=1`;
    const data = await ghJson(api, token);
    const tree = data && data.tree || [];
    const files = tree.filter(e => e.type === 'blob').map(e => e.path);
    logScan(`Tree entries: ${tree.length}, files: ${files.length}`);
    if (basePath) {
      const scoped = files.filter(f => f.startsWith(basePath.replace(/\\/g, '/')));
      logScan(`Scoped to path '${basePath}': ${scoped.length} files`);
      return scoped;
    }
    return files;
  }

  // Exclude noisy/non-code or huge files
  function shouldIncludeFile(path) {
    const skipExt = [
      '.png','.jpg','.jpeg','.gif','.svg','.ico','.pdf','.zip','.gz','.mp4','.mov','.webm','.wav','.mp3','.aac','.ttf','.woff','.woff2','.eot','.map'
    ];
    const lower = path.toLowerCase();
    if (skipExt.some(ext => lower.endsWith(ext))) return false;
    if (/^\.git\//.test(path)) return false;
    if (/node_modules\//.test(path)) return false;
    if (/dist\//.test(path)) return false;
    if (/build\//.test(path)) return false;
    if (/^vendor\//.test(lower)) return false;
    if (/(^|\/)yarn\.lock$/.test(lower)) return false;
    if (/(^|\/)package-lock\.json$/.test(lower)) return false;
    if (/(^|\/)pnpm-lock\.yaml$/.test(lower)) return false;
    if (/(^|\/)poetry\.lock$/.test(lower)) return false;
    if (/(^|\/)cargo\.lock$/.test(lower)) return false;
    if (/(^|\/)gemfile\.lock$/.test(lower)) return false;
    if (/(^|\/)go\.sum$/.test(lower)) return false;
    if (/\.min\.(js|css)$/.test(lower)) return false;
    return true;
  }

  // Split a single large file into chunked pseudo-files under a token ceiling
  function splitOversizedFiles(files, maxTokensPerItem) {
    const out = [];
    const maxChars = Math.max(4000, Math.floor(maxTokensPerItem * 4 * 0.9));
    for (const f of files) {
      const t = approxTokensFromChars(f.content.length);
      if (t <= maxTokensPerItem) {
        out.push(f);
        continue;
      }
      logScan(`Chunking large file: ${f.path} (approx tokens=${t})`);
      const chunks = [];
      for (let i = 0; i < f.content.length; i += maxChars) {
        const part = f.content.slice(i, i + maxChars);
        chunks.push({ path: `${f.path}#part${Math.floor(i / maxChars) + 1}`, content: part });
      }
      out.push(...chunks);
    }
    return out;
  }

  // Batch items so each batch stays under token thresholds
  function batchByTokenLimit(files, maxInputTokens, tpmBudget) {
    const effective = Math.min(maxInputTokens, Math.floor(tpmBudget * 0.7));
    const batches = [];
    let current = [];
    let currentTokens = 0;
    for (const f of files) {
      const t = approxTokensFromChars(f.content.length);
      if (currentTokens + t > effective && current.length > 0) {
        batches.push(current);
        current = [];
        currentTokens = 0;
      }
      // If the item itself is bigger than effective (after chunking this should be rare), still push alone
      if (t > effective && current.length === 0) {
        current.push(f);
        batches.push(current);
        current = [];
        currentTokens = 0;
      } else {
        current.push(f);
        currentTokens += t;
      }
    }
    if (current.length) batches.push(current);
    return batches;
  }

  function parseGitHubUrl(url) {
    try {
      const u = new URL(url);
      if (u.hostname !== 'github.com') return null;
      const parts = u.pathname.replace(/^\//, '').split('/');
      const owner = parts[0];
      let repo = parts[1];
      if (repo) repo = repo.replace(/\.git$/i, '');
      let ref = 'HEAD';
      let path = '';
      const treeIdx = parts.indexOf('tree');
      if (treeIdx >= 0) {
        ref = parts[treeIdx + 1] || 'HEAD';
        path = parts.slice(treeIdx + 2).join('/');
      }
      return owner && repo ? { owner, repo, ref, path } : null;
    } catch (_) {
      return null;
    }
  }

  async function ghJson(url, token) {
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    return await res.json();
  }

  async function getDefaultBranch({ owner, repo, token }) {
    const api = `https://api.github.com/repos/${owner}/${repo}`;
    const data = await ghJson(api, token);
    return data && data.default_branch ? data.default_branch : 'main';
  }

  async function listRepoFiles({ owner, repo, ref, token, basePath = '' }) {
    const resolvedRef = ref === 'HEAD' ? await getDefaultBranch({ owner, repo, token }) : ref;
    logScan(`Resolved ref: ${ref} -> ${resolvedRef}`);
    const api = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(resolvedRef)}?recursive=1`;
    const data = await ghJson(api, token);
    const tree = data && data.tree || [];
    const files = tree.filter(e => e.type === 'blob').map(e => e.path);
    logScan(`Tree entries: ${tree.length}, files: ${files.length}`);
    if (basePath) {
      const scoped = files.filter(f => f.startsWith(basePath.replace(/\\/g, '/')));
      logScan(`Scoped to path '${basePath}': ${scoped.length} files`);
      return scoped;
    }
    return files;
  }

  async function fetchFile({ owner, repo, ref, path, token, maxBytes }) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path}`;
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(rawUrl, { headers });
    if (!res.ok) throw new Error(`Raw ${res.status}`);
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.byteLength > maxBytes) {
      const sliced = new TextDecoder().decode(bytes.slice(0, maxBytes));
      return { path, content: sliced, truncated: true, bytes: bytes.byteLength };
    }
    return { path, content: new TextDecoder().decode(bytes), truncated: false, bytes: bytes.byteLength };
  }

  function filesToMonolith(files) {
    return files.map(f => `// FILE: ${f.path}\n${f.content}\n`).join('\n');
  }

  function chunkString(str, targetSize) {
    const chunks = [];
    for (let i = 0; i < str.length; i += targetSize) chunks.push(str.slice(i, i + targetSize));
    return chunks;
  }

  function makePerFileSummaryPrompt(path, code) {
    return [
      { role: 'system', content: 'Summarize this file for API documentation and architecture understanding. Output concise bullets. Mention functions/classes, routes, env vars, side effects, and dependencies. Markdown list only.' },
      { role: 'user', content: `Path: ${path}\n\n${code}` }
    ];
  }

  async function summarizeFilesIncrementally({ provider, apiKey, model, temperature, max_tokens, files }) {
    const summaries = [];
    for (const f of files) {
      const messages = makePerFileSummaryPrompt(f.path, f.content);
      try {
        const s = await callChatApi({ provider, apiKey, model, temperature, messages, max_tokens });
        summaries.push(`- ${f.path}\n${s}`);
      } catch (e) {
        summaries.push(`- ${f.path}\n(Summary failed: ${String(e && e.message || e)})`);
      }
    }
    return summaries.join('\n\n');
  }

  async function scanRepoAndFillCode() {
    const url = (repoUrlEl.value || '').trim();
    const token = (ghTokenEl && ghTokenEl.value || '').trim();
    const maxFiles = parseInt(ghMaxFilesEl && ghMaxFilesEl.value, 10) || 200;
    const maxBytes = parseInt(ghMaxBytesEl && ghMaxBytesEl.value, 10) || 200000;
    const concurrency = parseInt(ghConcurrencyEl && ghConcurrencyEl.value, 10) || 4;

    if (!url) {
      logScan('Enter a GitHub repository URL.');
      return [];
    }
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      logScan('Invalid GitHub URL. Expected https://github.com/owner/repo[/tree/<ref>/<path>]');
      return [];
    }

    logScan(`Parsed: owner=${parsed.owner}, repo=${parsed.repo}, ref=${parsed.ref}, path=${parsed.path || '/'} `);
    logScan(`Listing files for ${parsed.owner}/${parsed.repo}@${parsed.ref}…`);
    const allFiles = await listRepoFiles({ owner: parsed.owner, repo: parsed.repo, ref: parsed.ref, token, basePath: parsed.path });
    const filtered = allFiles.filter(shouldIncludeFile);
    const skipped = allFiles.length - filtered.length;
    const files = filtered.slice(0, maxFiles);
    logScan(`Files total: ${allFiles.length}, skipped (binary/vendor): ${skipped}, capped to: ${files.length}`);

    const refResolved = parsed.ref === 'HEAD' ? await getDefaultBranch({ owner: parsed.owner, repo: parsed.repo, token }) : parsed.ref;

    let totalBytes = 0;
    const results = await withConcurrency(concurrency, files, async (p, idx) => {
      try {
        const r = await fetchFile({ owner: parsed.owner, repo: parsed.repo, ref: refResolved, path: p, token, maxBytes });
        totalBytes += r.bytes || 0;
        if (r.truncated) logScan(`Truncated: ${p} (> ${maxBytes} bytes)`);
        if ((idx + 1) % 10 === 0 || idx === files.length - 1) logScan(`Fetched ${idx + 1}/${files.length}…`);
        return r;
      } catch (e) {
        logScan(`Failed: ${p} (${String(e && e.message || e)})`);
        return null;
      }
    });

    const good = results.filter(Boolean);
    logScan(`Fetched OK: ${good.length} files, approx bytes: ${totalBytes}`);

    codeEl.value = filesToMonolith(good);
    const chars = codeEl.value.length;
    logScan(`Aggregated code chars: ${chars}, approx tokens: ${approxTokensFromChars(chars)}`);
    projectNameEl.value = projectNameEl.value || `${parsed.owner}/${parsed.repo}`;
    return good;
  }

  function detectLanguageFromContent(code) {
    const c = code || '';
    if (/^\s*<\?php/m.test(c) || /\brequire_once\b|\binclude\b|\buse\s+\\?\w+/m.test(c)) return 'php';
    if (/\bdef\s+\w+\s*\(|\bimport\s+\w+|\bfrom\s+\w+\s+import|:\n\s+\bpass\b/m.test(c)) return 'python';
    if (/\bpackage\s+\w+|\bfunc\s+\w+\s*\(|\bimport\s+\(|\bgo\s+mod\b/m.test(c)) return 'go';
    if (/\busing\s+System\b|\bnamespace\s+\w+|\bclass\s+\w+\s*\{|\bpublic\s+(static\s+)?void\s+Main\s*\(/m.test(c)) return 'csharp';
    if (/\bpackage\s+[\w.]+;|\bpublic\s+class\s+\w+|\bimport\s+[\w.*]+;/m.test(c)) return 'java';
    if (/\bfn\s+\w+\s*\(|\bcrate::|\buse\s+[\w:]+::/m.test(c)) return 'rust';
    if (/#include\s+<\w+\.[hH]>|\bint\s+main\s*\(|\busing\s+namespace\s+std\b/m.test(c)) return 'cpp';
    if (/\brequire\(\s*['"]/m.test(c) || /\bimport\s+.*from\s+['"]/m.test(c) || /\bexport\s+\b/m.test(c) || /\bclass\s+\w+\s*\{/m.test(c)) return 'javascript';
    if (/\brequire\s+['"]/m.test(c) || /\bdef\s+\w+\s*\n.*\bend\b/m.test(c)) return 'ruby';
    return 'other';
  }

  function pickLanguage(selected, code) {
    if (!selected || selected === 'auto') return detectLanguageFromContent(code);
    return selected;
  }

  function extractImports(code) {
    const imports = [];
    const lines = code.split(/\n/);

    const patterns = [
      { type: 'js', re: /\bimport\s+[^;]+;?/ },
      { type: 'js', re: /\bconst\s+\w+\s*=\s*require\([^\)]+\)/ },
      { type: 'python', re: /^(?:from\s+\S+\s+import\s+\S+|import\s+\S+)/ },
      { type: 'go', re: /^import\s+\(/ },
      { type: 'go', re: /^import\s+"[^"]+"/ },
      { type: 'java', re: /^import\s+[\w.*]+;/ },
      { type: 'csharp', re: /^using\s+\S+\s*;/ },
      { type: 'php', re: /^(?:require|include|use)\b[^;]*;?/ },
      { type: 'ruby', re: /^require\s+['"][^'"]+['"]/ },
      { type: 'rust', re: /^use\s+[\w:]+(::[\w*]+)?\s*;/ }
    ];

    for (const line of lines) {
      for (const p of patterns) {
        if (p.re.test(line)) {
          imports.push(line.trim());
          break;
        }
      }
    }
    return Array.from(new Set(imports));
  }

  function extractFunctionsAndClasses(code, lang) {
    const functions = [];
    const classes = [];

    const pushFn = (name, signature) => {
      if (!name) return;
      functions.push({ name, signature });
    };

    const pushClass = (name) => {
      if (!name) return;
      classes.push({ name });
    };

    const lines = code.split(/\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/(javascript|other)/.test(lang)) {
        let m;
        m = line.match(/function\s+([A-Za-z0-9_]+)\s*\(/);
        if (m) pushFn(m[1], line.trim());
        m = line.match(/const\s+([A-Za-z0-9_]+)\s*=\s*\([^)]*\)\s*=>/);
        if (m) pushFn(m[1], line.trim());
        m = line.match(/class\s+([A-Za-z0-9_]+)/);
        if (m) pushClass(m[1]);
      }

      if (lang === 'python' || lang === 'other') {
        let m;
        m = line.match(/^\s*def\s+([A-Za-z0-9_]+)\s*\(/);
        if (m) pushFn(m[1], line.trim());
        m = line.match(/^\s*class\s+([A-Za-z0-9_]+)/);
        if (m) pushClass(m[1]);
      }

      if (lang === 'go' || lang === 'other') {
        let m;
        m = line.match(/^\s*func\s+([A-Za-z0-9_]+)\s*\(/);
        if (m) pushFn(m[1], line.trim());
      }

      if (lang === 'java' || lang === 'other') {
        let m;
        m = line.match(/\bclass\s+([A-Za-z0-9_]+)/);
        if (m) pushClass(m[1]);
        m = line.match(/\b(?:public|private|protected)\s+[A-Za-z0-9_<>\[\]]+\s+([A-Za-z0-9_]+)\s*\(/);
        if (m) pushFn(m[1], line.trim());
      }

      if (lang === 'csharp' || lang === 'other') {
        let m;
        m = line.match(/\bclass\s+([A-Za-z0-9_]+)/);
        if (m) pushClass(m[1]);
        m = line.match(/\b(?:public|private|internal|protected)\s+[A-Za-z0-9_<>\[\]]+\s+([A-Za-z0-9_]+)\s*\(/);
        if (m) pushFn(m[1], line.trim());
      }

      if (lang === 'php' || lang === 'other') {
        let m;
        m = line.match(/\bfunction\s+([A-Za-z0-9_]+)\s*\(/);
        if (m) pushFn(m[1], line.trim());
        m = line.match(/\bclass\s+([A-Za-z0-9_]+)/);
        if (m) pushClass(m[1]);
      }

      if (lang === 'ruby' || lang === 'other') {
        let m;
        m = line.match(/^\s*def\s+([A-Za-z0-9_!?]+)/);
        if (m) pushFn(m[1], line.trim());
        m = line.match(/^\s*class\s+([A-Za-z0-9_]+)/);
        if (m) pushClass(m[1]);
      }

      if (lang === 'rust' || lang === 'other') {
        let m;
        m = line.match(/^\s*fn\s+([A-Za-z0-9_]+)\s*\(/);
        if (m) pushFn(m[1], line.trim());
      }

      if (lang === 'cpp' || lang === 'other') {
        let m;
        m = line.match(/^(?:[A-Za-z_][A-Za-z0-9_<>:*&\s]+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        if (m) pushFn(m[1], line.trim());
        m = line.match(/\bclass\s+([A-Za-z0-9_]+)/);
        if (m) pushClass(m[1]);
      }
    }

    return {
      functions: uniqueByName(functions),
      classes: uniqueByName(classes)
    };
  }

  function uniqueByName(items) {
    const seen = new Set();
    const out = [];
    for (const it of items) {
      if (seen.has(it.name)) continue;
      seen.add(it.name);
      out.push(it);
    }
    return out;
  }

  function extractRoutes(code) {
    const routes = [];
    const lines = code.split(/\n/);

    const js = [
      /\b(app|router)\.(get|post|put|delete|patch|options|head)\s*\(\s*['"]([^'"]+)['"]/i,
      /\bfastify\.(get|post|put|delete|patch|options|head)\s*\(\s*['"]([^'"]+)['"]/i
    ];
    const py = [
      /@app\.(get|post|put|delete|patch|options|head)\(\s*['"]([^'"]+)['"]/i,
      /@\w+\.route\(\s*['"]([^'"]+)['"]/i
    ];
    const go = [
      /\br\.?(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\(\s*['"]([^'"]+)['"]/i,
      /http\.HandleFunc\(\s*['"]([^'"]+)['"]/i
    ];
    const java = [
      /@(?:Get|Post|Put|Delete|Patch)Mapping\(\s*\(?\s*value?\s*=?\s*['"]([^'"]+)['"]/i,
      /@RequestMapping\([^)]*value\s*=\s*['"]([^'"]+)['"][^)]*method\s*=\s*RequestMethod\.(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)/i
    ];
    const csharp = [
      /Map(Get|Post|Put|Delete|Patch|Options|Head)\(\s*['"]([^'"]+)['"]/i
    ];

    for (const line of lines) {
      for (const re of js) {
        const m = line.match(re);
        if (m) routes.push({ method: (m[2] || m[1]).toUpperCase(), path: m[3] || m[2] });
      }
      for (const re of py) {
        const m = line.match(re);
        if (m) routes.push({ method: (m[1] || 'GET').toUpperCase(), path: m[2] || m[1] });
      }
      for (const re of go) {
        const m = line.match(re);
        if (m) routes.push({ method: (m[1] || 'GET').toUpperCase(), path: m[2] || m[1] });
      }
      for (const re of java) {
        const m = line.match(re);
        if (m) routes.push({ method: (m[2] || 'GET').toUpperCase(), path: m[1] });
      }
      for (const re of csharp) {
        const m = line.match(re);
        if (m) routes.push({ method: (m[1] || 'GET').toUpperCase(), path: m[2] });
      }
    }

    return uniqueByPath(routes);
  }

  function uniqueByPath(items) {
    const seen = new Set();
    const out = [];
    for (const it of items) {
      const key = it.method + ' ' + it.path;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
    return out;
  }

  function extractEnvVars(code) {
    const vars = new Set();
    const patterns = [
      /process\.env\.([A-Z0-9_]+)/g,
      /os\.environ\[['"]([A-Z0-9_]+)['"]\]/g,
      /os\.getenv\(['"]([A-Z0-9_]+)['"]\)/g,
      /System\.getenv\(['"]([A-Z0-9_]+)['"]\)/g,
      /Environment\.GetEnvironmentVariable\(['"]([A-Z0-9_]+)['"]\)/g,
      /getenv\(['"]([A-Z0-9_]+)['"]\)/g,
      /std::getenv\(['"]([A-Z0-9_]+)['"]\)/g,
      /env::var\(['"]([A-Z0-9_]+)['"]\)/g
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(code)) !== null) {
        vars.add(m[1]);
      }
    }
    return Array.from(vars);
  }

  function extractTopBlockComment(code) {
    const trimmed = code.trimStart();
    const blockJs = trimmed.match(/^\/\*[\s\S]*?\*\//);
    if (blockJs) return blockJs[0];
    const lineHash = trimmed.match(/^(?:#.*\n){2,}/);
    if (lineHash) return lineHash[0];
    const triplePy = trimmed.match(/^\"\"\"[\s\S]*?\"\"\"/);
    if (triplePy) return triplePy[0];
    const triplePy2 = trimmed.match(/^\'\'\'[\s\S]*?\'\'\'/);
    if (triplePy2) return triplePy2[0];
    return '';
  }

  function guessProjectName(code, fallback) {
    if (fallback && fallback.trim().length > 0) return fallback.trim();
    const m = code.match(/^(?:#|\/\/|\*)\s*Project\s*:\s*(.+)$/mi);
    if (m) return m[1].trim();
    return 'Codebase';
  }

  function guessPackages(code) {
    const npm = [];
    const py = [];
    const go = [];
    const dotnet = [];
    const rust = [];

    let m;
    const requireRe = /require\(['"]([^'"]+)['"]\)/g;
    while ((m = requireRe.exec(code))) npm.push(m[1]);
    const importFromRe = /import\s+[^;]*from\s+['"]([^'"]+)['"]/g;
    while ((m = importFromRe.exec(code))) npm.push(m[1]);

    const pyImport = /^(?:from\s+([\w.]+)\s+import\s+\w+|import\s+([\w.]+))/gm;
    while ((m = pyImport.exec(code))) py.push((m[1] || m[2] || '').split('.')[0]);

    const goImport = /^\s*"([\w./-]+)"\s*$/gm;
    while ((m = goImport.exec(code))) go.push(m[1]);

    const csharpUsing = /^using\s+([\w.]+);/gm;
    while ((m = csharpUsing.exec(code))) dotnet.push(m[1]);

    const rustUse = /^use\s+([\w:]+)(::[\w*]+)?\s*;/gm;
    while ((m = rustUse.exec(code))) rust.push(m[1]);

    const dedupe = arr => Array.from(new Set(arr.filter(Boolean)));
    return {
      npm: dedupe(npm.filter(x => !x.startsWith('.') && !x.startsWith('/'))),
      python: dedupe(py.filter(x => x && x !== 'from' && x !== 'import')),
      go: dedupe(go),
      dotnet: dedupe(dotnet),
      rust: dedupe(rust)
    };
  }

  function formatList(items) {
    if (!items || items.length === 0) return '- None detected';
    return items.map(i => `- ${i}`).join('\n');
  }

  function formatRoutes(routes) {
    if (!routes || routes.length === 0) return '- None detected';
    return routes.map(r => `- ${r.method} ${r.path}`).join('\n');
  }

  function formatFns(fns) {
    if (!fns || fns.length === 0) return '- None detected';
    return fns.map(f => `- ${f.name}${f.signature ? ` — ${codeInline(f.signature)}` : ''}`).join('\n');
  }

  function formatClasses(classes) {
    if (!classes || classes.length === 0) return '- None detected';
    return classes.map(c => `- ${c.name}`).join('\n');
  }

  function codeInline(text) {
    const t = (text || '').replace(/`/g, '\\`');
    return '`' + t + '`';
  }

  function makeMarkdown({ projectName, repoUrl, owner, lang, context, code }) {
    const inferredLang = pickLanguage(lang, code);
    const imports = extractImports(code);
    const { functions, classes } = extractFunctionsAndClasses(code, inferredLang);
    const routes = extractRoutes(code);
    const envVars = extractEnvVars(code);
    const topComment = trimMultiline(extractTopBlockComment(code));
    const packages = guessPackages(code);

    const today = new Date().toISOString().slice(0, 10);

    const title = guessProjectName(code, projectName);

    return trimMultiline(`
### ${title} — Handover Documentation

- **Last updated**: ${today}
- **Primary owner**: ${owner || 'Unassigned'}
- **Repository**: ${repoUrl || 'N/A'}
- **Primary language**: ${inferredLang}

### 1) Overview
${context && context.trim().length ? context.trim() : 'No additional context provided.'}

${topComment ? `> Source comment snippet:\n> ${topComment.split('\n').slice(0, 8).join('\n> ')}` : ''}

### 2) Architecture summary
- **Key modules/imports**:\n${formatList(imports)}
- **Detected classes**:\n${formatClasses(classes)}
- **Detected functions**:\n${formatFns(functions)}

### 3) API surface (routes/endpoints)
${formatRoutes(routes)}

### 4) Configuration
- **Environment variables**:\n${formatList(envVars)}

### 5) Dependencies
- **JavaScript/TypeScript (npm)**:\n${formatList(packages.npm)}
- **Python**:\n${formatList(packages.python)}
- **Go**:\n${formatList(packages.go)}
- **.NET**:\n${formatList(packages.dotnet)}
- **Rust**:\n${formatList(packages.rust)}

### 6) Local development
- **Prerequisites**: Appropriate runtime and package manager for ${inferredLang}
- **Setup**: Ensure environment variables above are configured (.env or shell) and dependencies installed
- **Run**: Refer to project README or entry point; common commands vary by language

### 7) Deployment & operations
- **Build**: Language/runtime-specific build steps
- **Deploy**: CI/CD pipeline or manual process (document provider, environment, approvals)
- **Observability**: Logging, metrics, and tracing destinations (add specifics if known)
- **SLA/Backups**: Define expectations and data retention policies

### 8) Risks, gotchas, and follow-ups
- Note risky areas, coupling, and places lacking tests
- Add migration notes or tech debt items

### 9) Handover checklist
- [ ] Update owners in CODEOWNERS/README
- [ ] Ensure on-call runbook exists
- [ ] Validate feature flags and config defaults
- [ ] Confirm secrets rotation schedule
- [ ] Verify CI is green and release is reproducible
`);
  }

  function buildAiPrompt({ title, owner, repoUrl, inferredLang, imports, functions, classes, routes, envVars, packages, context, code, baseline }) {
    const system = trimMultiline(`
You are a senior software engineer documenting a codebase for a handoff to another developer.
Write a comprehensive, structured, sectioned documentation in Markdown. Follow these requirements:
- Overview of purpose and context (audience: new maintainers)
- Setup and environment (env vars, configs, secrets, prerequisites)
- Architecture and data flow (key modules, dependencies, how they interact)
- Explanation of each function/class/module (role, inputs/outputs, where used)
- API surface (routes/endpoints) and contracts
- Examples of usage for key functions/APIs
- Gotchas and pitfalls (edge cases, failure modes, invariants)
- Extension ideas and migration/upgrade considerations
- Testing guidance (fixtures, integration points, test strategies)
- Onboarding checklist
Be thorough and write as if the reader has never seen the code. Use Markdown headings and code fences where appropriate. Do not invent APIs that do not exist in the inputs.
    `);

    const summary = [
      `Title: ${title}`,
      `Owner: ${owner || 'Unassigned'}`,
      `Repo: ${repoUrl || 'N/A'}`,
      `Language: ${inferredLang}`
    ].join('\n');

    const analysis = `Imports:\n${formatList(imports)}\n\nClasses:\n${formatClasses(classes)}\n\nFunctions:\n${formatFns(functions)}\n\nRoutes:\n${formatRoutes(routes)}\n\nEnv:\n${formatList(envVars)}\n\nDeps: npm: ${formatList(packages.npm)} | py: ${formatList(packages.python)} | go: ${formatList(packages.go)} | dotnet: ${formatList(packages.dotnet)} | rust: ${formatList(packages.rust)}`;

    return [
      { role: 'system', content: system },
      { role: 'user', content: `Project summary\n${summary}` },
      { role: 'user', content: `Context (author-provided)\n${context || 'None'}` },
      { role: 'user', content: `Static analysis (heuristic)\n${analysis}` },
      { role: 'user', content: `Baseline handover (local generator)\n\n${baseline}` },
      { role: 'user', content: `Code (may be truncated)\n\n${code}` }
    ];
  }

  // Added: summarize batches of files for hierarchical mode
  function buildBatchSummaryPrompt(files) {
    const header = 'Summarize this batch of files into a concise, structured Markdown suitable for API/architecture documentation. For each file: briefly list purpose, key functions/classes/routes, env vars, external deps, and notable pitfalls. Then provide a short batch-level summary. Use bullets.';
    const content = files.map(f => `---\nPath: ${f.path}\n\n${f.content}`).join('\n\n');
    return [
      { role: 'system', content: header },
      { role: 'user', content }
    ];
  }

  // Added: compose final doc from batch summaries
  function buildComposerPrompt({ title, context, baseline, batchSummaries }) {
    const instructions = `You will compose a full project handover document using the provided batch summaries. Do not invent APIs. Produce a single cohesive Markdown with sections: Overview, Architecture, API surface, Key modules, Config & Env, Dependencies, Operations, Risks, Testing, Onboarding Checklist. Where information is missing, add TODOs.`;
    const material = batchSummaries.map((s, i) => `Batch ${i + 1} summary:\n\n${s}`).join('\n\n');
    return [
      { role: 'system', content: instructions },
      { role: 'user', content: `Project title: ${title}` },
      { role: 'user', content: `Context: ${context || 'None'}` },
      { role: 'user', content: `Baseline (for reference):\n\n${baseline}` },
      { role: 'user', content: `Batch summaries:\n\n${material}` }
    ];
  }

  // Added: OpenAI/OpenRouter call with retry/backoff
  async function callChatApi({ provider, apiKey, model, temperature, messages, max_tokens, maxRetries = 3 }) {
    let url;
    let headers = { 'Content-Type': 'application/json' };
    let body;

    if (provider === 'openrouter') {
      url = 'https://openrouter.ai/api/v1/chat/completions';
      headers.Authorization = `Bearer ${apiKey}`;
      body = { model, temperature: typeof temperature === 'number' ? temperature : 0.2, messages, max_tokens: typeof max_tokens === 'number' ? max_tokens : 2048 };
    } else if (provider === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions';
      headers.Authorization = `Bearer ${apiKey}`;
      body = { model, temperature: typeof temperature === 'number' ? temperature : 0.2, messages, max_tokens: typeof max_tokens === 'number' ? max_tokens : 2048 };
    } else if (provider === 'groq') {
      url = 'https://api.groq.com/openai/v1/chat/completions';
      headers.Authorization = `Bearer ${apiKey}`;
      body = { model, temperature: typeof temperature === 'number' ? temperature : 0.2, messages, max_tokens: typeof max_tokens === 'number' ? max_tokens : 2048 };
    } else if (provider === 'ollama') {
      // Ollama local: http://127.0.0.1:11434/api/chat with slightly different schema
      url = 'http://127.0.0.1:11434/api/chat';
      // no auth header
      const ollamaMessages = messages.map(m => ({ role: m.role, content: m.content }));
      body = { model: model || 'llama3.1', messages: ollamaMessages, options: { temperature: typeof temperature === 'number' ? temperature : 0.2, num_predict: typeof max_tokens === 'number' ? max_tokens : 2048 } };
    } else {
      throw new Error('Unknown provider');
    }

    logScan(`AI request: provider=${provider}, model=${model}, temp=${typeof temperature === 'number' ? temperature : 0.2}, max_tokens=${typeof max_tokens === 'number' ? max_tokens : 2048}`);

    let attempt = 0;
    let lastErr;
    while (attempt <= maxRetries) {
      try {
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

        if (res.ok) {
          const data = await res.json();
          let content;
          if (provider === 'ollama') {
            // Ollama may stream; when not streaming, it returns an object with message.content
            content = data && data.message && data.message.content;
          } else {
            const choice = data && data.choices && data.choices[0];
            content = choice && choice.message && choice.message.content;
          }
          if (!content) throw new Error('No AI content returned');
          logScan(`AI response received. Characters: ${content.length}, approx tokens: ${approxTokensFromChars(content.length)}`);
          return String(content).trim();
        }

        const status = res.status;
        const text = await res.text().catch(() => '');
        lastErr = new Error(`AI request failed (${status}): ${text}`);
        if ((status === 429 || (status >= 500 && status < 600)) && provider !== 'ollama') {
          attempt++;
          if (attempt > maxRetries) break;
          let delayMs = 1000 * Math.pow(2, attempt - 1);
          const retryAfter = res.headers.get('retry-after');
          if (retryAfter) {
            const sec = parseInt(retryAfter, 10);
            if (!Number.isNaN(sec)) delayMs = Math.max(delayMs, sec * 1000);
          }
          const jitter = Math.floor(delayMs * (0.2 * (Math.random() - 0.5)));
          delayMs += jitter;
          logScan(`AI ${status}. Retrying in ${Math.max(0, delayMs)} ms (attempt ${attempt}/${maxRetries})…`);
          await new Promise(r => setTimeout(r, Math.max(0, delayMs)));
          continue;
        }

        throw lastErr;
      } catch (e) {
        lastErr = e;
        attempt++;
        if (attempt > maxRetries) break;
        const delayMs = 800 * Math.pow(2, attempt - 1);
        logScan(`AI request error. Retrying in ${delayMs} ms (attempt ${attempt}/${maxRetries})…`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    throw lastErr || new Error('AI request failed');
  }

  function splitMonolithIntoFiles(monolith) {
    const sections = monolith.split(/\n\/\/ FILE: /).map((s, idx) => idx === 0 ? s : '// FILE: ' + s);
    const files = [];
    for (const section of sections) {
      const m = section.match(/^\/\/ FILE: ([^\n]+)\n/);
      if (!m) continue;
      const path = m[1].trim();
      const content = section.slice(m[0].length);
      files.push({ path, content });
    }
    return files;
  }

  async function generateWithAi({ provider, apiKey, model, temperature, messages, max_tokens }) {
    return await callChatApi({ provider, apiKey, model, temperature, messages, max_tokens, maxRetries: 3 });
  }

  function setGenerating(isOn) {
    if (!generateBtn) return;
    if (isOn) {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating…';
      editBtn.disabled = true;
      viewPreviewBtn.disabled = true;
      copyBtn.disabled = true;
      downloadBtn.disabled = true;
    } else {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate Documentation';
      editBtn.disabled = false;
      viewPreviewBtn.disabled = false;
      copyBtn.disabled = false;
      downloadBtn.disabled = false;
    }
  }

  function buildReadmePrompt({ title, repoUrl, owner, badges, quickstart, scripts, endpoints, features, requirements, context, analysis }) {
    const system = `You are a senior engineer writing a modern, polished README.md with emoji and clear sections. Use concise language, friendly tone, and professional formatting. Include shields.io badges if URLs are provided. Output the content directly without any markdown code fences or language indicators.`;
    const user = trimMultiline(`
Project: ${title}
Repo: ${repoUrl || 'N/A'}
Owner: ${owner || 'Unassigned'}

Context:
${context || 'None'}

Analysis:
${analysis}

Expect sections:
- Title and short description
- Badges (optional)
- Table of Contents
- Features / Highlights
- Tech Stack
- Requirements
- Quickstart (Install, Env, Run, Test)
- Configuration (.env vars)
- API Endpoints (summary)
- Scripts/Commands
- Folder Structure (brief)
- Contributing (optional)
- License
- Acknowledgements
Use emoji tastefully (like 🚀, 🔧, 🧪, ⚙️, 📦, 📁).`);
    return [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
  }

  function buildAnalysisBlob({ inferredLang, imports, functions, classes, routes, envVars, packages }) {
    return trimMultiline(`
Language: ${inferredLang}
Imports: ${imports.length}
Functions: ${functions.length}
Classes: ${classes.length}
Routes: ${routes.length}
Env Vars: ${envVars.length}
Packages: npm=${packages.npm.length}, py=${packages.python.length}, go=${packages.go.length}, dotnet=${packages.dotnet.length}, rust=${packages.rust.length}
`);
  }

  function composeReadmeFromBatches({ title, repoUrl, owner, context, batchSummaries }) {
    const analysis = batchSummaries.map((s, i) => `Batch ${i + 1} summary\n\n${s}`).join('\n\n');
    return buildReadmePrompt({ title, repoUrl, owner, context, analysis });
  }

  // Adjust download filename based on output type
  function currentFilename() {
    const t = outputTypeEl && outputTypeEl.value || 'handover';
    return t === 'readme' ? 'README.md' : 'HANDOVER.md';
  }

  // Modify submit flow to handle README mode
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const code = codeEl.value || '';
    const context = contextEl.value || '';
    const lang = languageEl.value;
    const projectName = projectNameEl.value || '';
    const repoUrl = repoUrlEl.value || '';
    const owner = ownerEl.value || '';
    const outputType = outputTypeEl && outputTypeEl.value || 'handover';

    const codeChars = code.length;
    logScan(`Generate clicked. Output=${outputType}, code chars=${codeChars}, approx tokens=${approxTokensFromChars(codeChars)}, lang=${lang}`);

    if (!code.trim()) {
      outputEl.textContent = 'Please paste code first or scan a repository.';
      logScan('No code available to generate from.');
      return;
    }

    const apiKey = (aiKeyEl && aiKeyEl.value || '').trim();
    const provider = (aiProviderEl && aiProviderEl.value) || 'openai';
    const model = getSelectedModel();
    const temperature = parseFloat(aiTemperatureEl && aiTemperatureEl.value) || 0.2;
    const max_tokens = parseInt(aiMaxTokensEl && aiMaxTokensEl.value, 10) || 2048;
    const maxInputTokens = parseInt(aiMaxInputTokensEl && aiMaxInputTokensEl.value, 10) || 12000;
    const tpmBudget = parseInt(aiTpmLimitEl && aiTpmLimitEl.value, 10) || 30000;
    const summaryTokens = parseInt(aiSummaryTokensEl && aiSummaryTokensEl.value, 10) || 256;
    const useHierarchy = !!(aiHierarchyEl && aiHierarchyEl.checked);

    const inferredLang = pickLanguage(lang, code);
    const imports = extractImports(code);
    const fc = extractFunctionsAndClasses(code, inferredLang);
    const routes = extractRoutes(code);
    const envVars = extractEnvVars(code);
    const packages = guessPackages(code);

    const title = guessProjectName(code, projectName);

    if (outputType !== 'readme') {
      // fall through to the existing handover generation handler (already registered earlier)
      return;
    }

    if (!apiKey && provider !== 'ollama') {
      outputEl.textContent = 'Enter your API key to generate a README, or switch provider to Ollama (local).';
      logScan('AI key missing for README generation.');
      return;
    }

    setGenerating(true);
    try {
      const approxInputTokens = approxTokensFromChars(code.length);
      const needsHierarchy = useHierarchy || approxInputTokens > maxInputTokens || approxInputTokens > tpmBudget * 0.8;
      if (!needsHierarchy) {
        const analysis = buildAnalysisBlob({ inferredLang, imports, functions: fc.functions, classes: fc.classes, routes, envVars, packages });
        const messages = buildReadmePrompt({ title, repoUrl, owner, context, analysis });
        const md = await generateWithAi({ provider, apiKey, model, temperature, messages, max_tokens });
        await typewriterEffect(outputEl, cleanMarkdown(md));
        logScan('README generated (direct).');
      } else {
        logScan('README hierarchical path…');
        const files = splitMonolithIntoFiles(code);
        const tokenPerItemCeiling = Math.max(2000, Math.floor(maxInputTokens * 0.5));
        const chunked = splitOversizedFiles(files, tokenPerItemCeiling);
        const batches = batchByTokenLimit(chunked, Math.max(2000, Math.floor(maxInputTokens * 0.8)), tpmBudget);
        const batchSummaries = [];
        for (let i = 0; i < batches.length; i++) {
          const messages = buildBatchSummaryPrompt(batches[i]);
          const summary = await generateWithAi({ provider, apiKey, model, temperature, messages, max_tokens: summaryTokens });
          batchSummaries.push(summary);
          await new Promise(r => setTimeout(r, 400));
        }
        const composeMessages = composeReadmeFromBatches({ title, repoUrl, owner, context, batchSummaries });
        const md = await generateWithAi({ provider, apiKey, model, temperature, messages: composeMessages, max_tokens });
        await typewriterEffect(outputEl, cleanMarkdown(md));
        logScan('README generated (hierarchical).');
      }
    } catch (e) {
      outputEl.textContent = `README generation failed: ${String(e && e.message || e)}`;
      logScan('README generation error: ' + String(e && e.message || e));
    } finally {
      setGenerating(false);
    }
  });

  clearBtn.addEventListener('click', function() {
    form.reset();
    outputEl.textContent = '';
    logScan('Form cleared.');
  });

  sampleBtn.addEventListener('click', function() {
    if ((codeEl.value || '').trim()) return;
    const sample = `// Project: Mini API
// Simple Express server
import express from 'express';
const app = express();
app.get('/health', (req, res) => res.json({ ok: true }));
app.post('/users', (req, res) => res.status(201).send('created'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log('listening on', port));
`;
    codeEl.value = sample;
    languageEl.value = 'javascript';
    projectNameEl.value = 'Mini API';
    logScan('Loaded sample code.');
  });

  copyBtn.addEventListener('click', async function() {
    const md = outputEl.textContent || '';
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
      flash(copyBtn, 'Copied');
      logScan('Copied output to clipboard.');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      flash(copyBtn, 'Copied');
      logScan('Copied output to clipboard (fallback).');
    }
  });

  downloadBtn.addEventListener('click', function() {
    const md = outputEl.textContent || '';
    if (!md) return;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = currentFilename();
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
    logScan(`Downloaded ${currentFilename()}`);
  });

  function flash(btn, text) {
    const prev = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = prev;
      btn.disabled = false;
    }, 800);
  }

  // Preview functionality
  function cleanMarkdown(text) {
    // Remove any markdown code fence headers if present
    return text.replace(/^```\w*\n/, '').replace(/\n```$/, '');
  }

  async function typewriterEffect(element, text, speed = 0.5) {
    element.textContent = '';
    const lines = text.split('\n');
    const chunkSize = text.length > 1000 ? 3 : 1; // Process more chars at once for longer texts
    
    for (let line of lines) {
      for (let i = 0; i < line.length; i += chunkSize) {
        const chunk = line.slice(i, i + chunkSize);
        element.textContent += chunk;
        // Scroll to bottom as text appears
        element.scrollTop = element.scrollHeight;
        // Only delay every few characters for longer texts
        if (i % (chunkSize * 2) === 0) {
          await new Promise(resolve => setTimeout(resolve, speed));
        }
      }
      element.textContent += '\n';
    }
    return true;
  }

  function updatePreview() {
    if (!outputEl.textContent) return;
    previewEl.innerHTML = marked.parse(cleanMarkdown(outputEl.textContent));
  }

  function showRaw() {
    viewRawBtn.classList.add('active');
    viewPreviewBtn.classList.remove('active');
    outputEl.style.display = 'block';
    previewEl.style.display = 'none';
  }

  function showPreview() {
    viewPreviewBtn.classList.add('active');
    viewRawBtn.classList.remove('active');
    outputEl.style.display = 'none';
    previewEl.style.display = 'block';
    updatePreview();
  }

  // Set up preview toggle handlers
  viewRawBtn.addEventListener('click', showRaw);
  viewPreviewBtn.addEventListener('click', showPreview);

  // Update preview when output changes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' && previewEl.style.display !== 'none') {
        updatePreview();
      }
    });
  });
  
  observer.observe(outputEl, { childList: true });

  // Edit functionality
  function startEditing() {
    originalContent = outputEl.textContent;
    outputEl.contentEditable = true;
    outputEl.focus();
    editBtn.style.display = 'none';
    saveBtn.style.display = 'inline-block';
    cancelBtn.style.display = 'inline-block';
    viewPreviewBtn.disabled = true;
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
    
    // Force raw view when editing
    showRaw();
  }

  function saveEdits() {
    outputEl.contentEditable = false;
    editBtn.style.display = 'inline-block';
    saveBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
    viewPreviewBtn.disabled = false;
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    updatePreview();
  }

  function cancelEdits() {
    outputEl.textContent = originalContent;
    outputEl.contentEditable = false;
    editBtn.style.display = 'inline-block';
    saveBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
    viewPreviewBtn.disabled = false;
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
  }

  editBtn.addEventListener('click', startEditing);
  saveBtn.addEventListener('click', saveEdits);
  cancelBtn.addEventListener('click', cancelEdits);

  codeEl.addEventListener('dragover', function(e) {
    e.preventDefault();
  });
  codeEl.addEventListener('drop', function(e) {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      codeEl.value = String(reader.result || '');
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const extToLang = {
        js: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript',
        py: 'python', go: 'go', cs: 'csharp', java: 'java', rs: 'rust',
        php: 'php', rb: 'ruby', c: 'cpp', h: 'cpp', cpp: 'cpp', hpp: 'cpp'
      };
      const lang = extToLang[ext];
      if (lang) languageEl.value = lang;
      if (!projectNameEl.value) projectNameEl.value = file.name.replace(/\.[^.]+$/, '');
      logScan(`Loaded dropped file: ${file.name} (${String(file.size)} bytes)`);
    };
    reader.readAsText(file);
  });

  // Wire up Scan Repo
  if (scanBtn) {
    scanBtn.addEventListener('click', async function() {
      scanBtn.disabled = true;
      scanBtn.textContent = 'Scanning…';
      scanLog.textContent = '';
      try {
        await scanRepoAndFillCode();
        logScan('Scan complete. You can now Generate Documentation.');
      } catch (e) {
        logScan('Scan failed: ' + String(e && e.message || e));
      } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = 'Scan Repo';
      }
    });
  }
})();
