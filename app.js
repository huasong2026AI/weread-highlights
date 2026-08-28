// 微信读书 · 热门划线摘录
// 自动获取：前端填 infoId -> 本地 server.py 匿名请求 weread.qq.com 接口 -> 渲染热门划线（无需登录）

const STORE_KEY = 'weread_highlights_books';

const fileInput = document.getElementById('fileInput');
const importBtn = document.getElementById('importBtn');
const exportBtn = document.getElementById('exportBtn');
const bookIdInput = document.getElementById('bookIdInput');
const fetchBtn = document.getElementById('fetchBtn');
const fetchStatus = document.getElementById('fetchStatus');
const bookListEl = document.getElementById('bookList');
const bookCountEl = document.getElementById('bookCount');
const emptyHint = document.getElementById('emptyHint');
const bookHeader = document.getElementById('bookHeader');
const highlightList = document.getElementById('highlightList');
const contentEmpty = document.getElementById('contentEmpty');

let books = loadBooks();
let activeBookId = null;

function loadBooks() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; }
}
function saveBooks() { localStorage.setItem(STORE_KEY, JSON.stringify(books)); }

function chapterMap(data) {
  const m = {};
  (data.chapters || []).forEach(c => { m[c.chapterUid] = c.title; });
  return m;
}

function parseBook(raw, fileName) {
  // 兼容结构：导出的单个书籍对象、标准结构 {items:[...]} 或微信读书原始响应 {bestBookMarks:{items:[...]}}
  const src = raw.book || raw.bestBookMarks || raw;
  const items = src.highlights || src.items || [];
  const chap = chapterMap(src);
  const bookId = (items[0] && items[0].bookId) || src.bookId || raw.bookId || (fileName || 'unknown');
  let title = src.title || raw.title ||
    (raw.bookInfo && raw.bookInfo.title) ||
    (src.bookInfo && src.bookInfo.title) ||
    (fileName && fileName !== 'bestbookmarks.json' ? fileName.replace(/\.json$/, '') : '');
  if (!title) title = '书籍 ' + bookId;
  const highlights = items.map((it, idx) => ({
    text: it.text || it.markText || '',
    count: it.count || it.totalCount || 0,
    chapter: it.chapter || chap[it.chapterUid] || it.chapterTitle || ('章节' + (it.chapterUid || idx + 1)),
    chapterUid: it.chapterUid,
    bookmarkId: it.bookmarkId || it.key,
    key: it.key || it.bookmarkId || ('idx-' + idx)
  }));
  return {
    bookId, infoId: src.infoId || raw.infoId || '',
    title, author: src.author || raw.author || '',
    count: highlights.length, highlights, sample: !!raw.__sample
  };
}

// 静默刷新书籍元数据（书名/作者）：旧数据没有书名或存在异常编码时自动补全
async function refreshBookMeta(b) {
  if (!b.infoId) return;
  try {
    const r = await fetch('/api/bookmeta?infoId=' + encodeURIComponent(b.infoId), { cache: 'no-store' });
    const d = await r.json();
    if (d.ok && d.title) {
      b.title = d.title;
      b.author = d.author || b.author || '';
      saveBooks();
      renderSidebar();
      if (activeBookId === b.bookId) selectBook(b.bookId);
    }
  } catch (e) { /* 忽略 */ }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

function deleteBook(bookId) {
  const b = books.find(x => x.bookId === bookId);
  if (!b) return;
  if (!confirm(`删除《${b.title}》及其全部划线？`)) return;
  books = books.filter(x => x.bookId !== bookId);
  saveBooks();
  if (activeBookId === bookId) {
    activeBookId = null;
    contentEmpty.style.display = 'block';
    bookHeader.classList.add('hidden');
    highlightList.innerHTML = '';
    exportBtn.disabled = true;
  }
  renderSidebar();
}

function renderSidebar() {
  bookCountEl.textContent = books.length;
  emptyHint.style.display = books.length ? 'none' : 'block';
  bookListEl.innerHTML = '';
  books.forEach(b => {
    const li = document.createElement('li');
    li.className = 'book-item' + (b.bookId === activeBookId ? ' active' : '');
    li.innerHTML = `<div class="book-name">${esc(b.title)}${b.sample ? '<span class="tag-sample">示例</span>' : ''}</div>
      <div class="book-meta">${esc(b.author || '')}</div>
      <button class="book-del" title="删除这本书">🗑</button>`;
    li.onclick = () => selectBook(b.bookId);
    li.querySelector('.book-del').onclick = (e) => {
      e.stopPropagation();
      deleteBook(b.bookId);
    };
    bookListEl.appendChild(li);
  });
}

function deleteHighlight(bookId, key) {
  const b = books.find(x => x.bookId === bookId);
  if (!b) return;
  if (!confirm('删除这条划线？')) return;
  b.highlights = b.highlights.filter(h => h.key !== key);
  b.count = b.highlights.length;
  saveBooks();
  renderSidebar();
  if (activeBookId === bookId) selectBook(bookId);
}

function selectBook(bookId) {
  activeBookId = bookId;
  const b = books.find(x => x.bookId === bookId);
  renderSidebar();
  if (!b) {
    contentEmpty.style.display = 'block';
    bookHeader.classList.add('hidden');
    highlightList.innerHTML = '';
    exportBtn.disabled = true;
    return;
  }
  contentEmpty.style.display = 'none';
  exportBtn.disabled = false;
  bookHeader.classList.remove('hidden');
  bookHeader.innerHTML = `<h2>${esc(b.title)}</h2>` +
    (b.author ? `<div class="sub-author">${esc(b.author)}</div>` : '');
  highlightList.innerHTML = '';
  b.highlights.forEach((h, i) => {
    const card = document.createElement('div');
    const isThisSpeaking = isPlaying && currentPlayingBookId === b.bookId && currentPlayingHlIdx === i;
    card.className = 'hl-card' + (isThisSpeaking ? ' speaking' : '');
    card.id = 'hl-card-' + b.bookId + '-' + i;
    card.innerHTML = `
      <div class="hl-top">
        <div class="hl-rank">${i + 1}</div>
        <div class="hl-chapter">${esc(h.chapter)}</div>
        <div class="hl-count">${h.count} 人划线</div>
        <button class="hl-play-single" title="朗读此条">🔊 朗读</button>
        <button class="hl-del" title="删除这条">🗑</button>
      </div>
      <div class="hl-text">${esc(h.text)}</div>`;
    card.querySelector('.hl-play-single').onclick = (e) => {
      e.stopPropagation();
      playFromSpecific(b.bookId, i);
    };
    card.querySelector('.hl-del').onclick = (e) => {
      e.stopPropagation();
      deleteHighlight(b.bookId, h.key);
    };
    highlightList.appendChild(card);
  });
}

function addBook(raw, fileName) {
  const b = parseBook(raw, fileName);
  const exist = books.findIndex(x => x.bookId === b.bookId);
  if (exist >= 0) books[exist] = b; else books.push(b);
  saveBooks();
  renderSidebar();
  selectBook(b.bookId);
}

// ---- 自动获取：填 bookId 拉取前 20 条 ----
fetchBtn.onclick = async () => {
  const bookId = bookIdInput.value.trim();
  if (!bookId) { fetchStatus.textContent = '请输入 bookId'; return; }
  fetchStatus.textContent = '获取中…';
  fetchBtn.disabled = true;
  try {
    const r = await fetch('/api/bestbookmarks?bookId=' + encodeURIComponent(bookId), { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) {
      fetchStatus.textContent = '❌ ' + (d.errmsg || '获取失败') + (d.errcode === -2010 ? '' : '');
      return;
    }
    // 微信读书在登录态/参数错误时返回 {"errcode":-xxxx,"errmsg":"..."}（HTTP 200）
    if (d.errcode != null && d.errcode !== 0) {
      fetchStatus.textContent = '❌ 微信读书返回 ' + d.errcode + '：' + (d.errmsg || '未知错误');
      return;
    }
    if (!d.items || !d.items.length) {
      fetchStatus.textContent = '❌ 返回为空，请确认 bookId 正确（来自 bookDetail URL）';
      return;
    }
    addBook(d, bookId + '.json');
    fetchStatus.textContent = '✅ 已获取 ' + d.items.length + ' 条' + (d.totalCount ? '（共 ' + d.totalCount + ' 条热门）' : '');
  } catch (e) {
    fetchStatus.textContent = '❌ 请求失败，请确认本地工具已启动 (start.bat)';
  } finally {
    fetchBtn.disabled = false;
  }
};
bookIdInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchBtn.click(); });

// ---- 离线导入 ----
importBtn.onclick = () => fileInput.click();
fileInput.onchange = e => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  let pending = files.length;
  files.forEach(f => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result);
        // 全量导出文件：{version, books:[...]}（书对象直接使用）
        if (raw && Array.isArray(raw.books) && raw.version) {
          let added = 0;
          raw.books.forEach(b => {
            if (b && b.bookId && Array.isArray(b.highlights)) {
              const exist = books.findIndex(x => x.bookId === b.bookId);
              if (exist >= 0) books[exist] = b; else books.push(b);
              added++;
            }
          });
          saveBooks();
          renderSidebar();
          if (added && books.length) selectBook(books[0].bookId);
          alert('✅ 已导入 ' + added + ' 本书');
        } else {
          addBook(raw, f.name);
        }
      } catch (err) {
        alert('解析失败：' + f.name + '\n' + err.message);
      } finally {
        if (--pending === 0) fileInput.value = '';
      }
    };
    reader.readAsText(f);
  });
};

function download(name, content, type = 'application/json;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 导出当前选中的书为 JSON
exportBtn.onclick = () => {
  const b = books.find(x => x.bookId === activeBookId);
  if (!b) return;
  const payload = {
    version: 1,
    exportedAt: new Date().toLocaleString('zh-CN'),
    app: '微信读书热门划线摘录',
    book: {
      bookId: b.bookId,
      infoId: b.infoId || '',
      title: b.title || '',
      author: b.author || '',
      count: b.highlights ? b.highlights.length : 0,
      highlights: b.highlights || []
    }
  };
  const fileName = (b.title ? b.title.replace(/[\\/:*?"<>|]/g, '_') : b.bookId) + '_热门划线.json';
  download(fileName, JSON.stringify(payload, null, 2));
};

// 导出全部书籍为单个 JSON
exportAllBtn.onclick = () => {
  if (!books.length) { alert('还没有任何书籍'); return; }
  const payload = {
    version: 1,
    exportedAt: new Date().toLocaleString('zh-CN'),
    app: '微信读书热门划线摘录',
    books: books.map(b => ({
      bookId: b.bookId,
      infoId: b.infoId || '',
      title: b.title || '',
      author: b.author || '',
      count: b.highlights ? b.highlights.length : 0,
      highlights: b.highlights || []
    }))
  };
  download('全部热门划线.json', JSON.stringify(payload, null, 2));
};

// ==========================================
// 🔊 全局连续朗读（TTS）播放系统
// ==========================================
const playerBookTitle = document.getElementById('playerBookTitle');
const playerDetail = document.getElementById('playerDetail');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const stopBtn = document.getElementById('stopBtn');
const rateSelect = document.getElementById('rateSelect');
const playModeSelect = document.getElementById('playModeSelect');

const synth = window.speechSynthesis;
let isPlaying = false;
let isPaused = false;
let currentPlayingBookId = null;
let currentPlayingHlIdx = 0;
let currentUtterance = null;
let keepAliveTimer = null;

function getChineseVoice() {
  if (!synth) return null;
  const voices = synth.getVoices() || [];
  const zhVoices = voices.filter(v => v.lang && (v.lang.startsWith('zh') || v.lang.includes('CN') || v.lang.includes('TW')));
  return zhVoices.find(v => /Xiaoxiao|Yunxi|Natural|Chinese|Mandarin/i.test(v.name)) || zhVoices[0] || null;
}

if (synth && synth.onvoiceschanged !== undefined) {
  synth.onvoiceschanged = () => getChineseVoice();
}

function updateActiveCardVisual() {
  document.querySelectorAll('.hl-card').forEach(card => card.classList.remove('speaking'));
  if (isPlaying && currentPlayingBookId) {
    const activeCard = document.getElementById('hl-card-' + currentPlayingBookId + '-' + currentPlayingHlIdx);
    if (activeCard) {
      activeCard.classList.add('speaking');
      activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

function updatePlayerUI(statusText) {
  if (!isPlaying) {
    playBtn.textContent = '▶ 播放';
    playBtn.classList.remove('playing');
    playerBookTitle.textContent = books.length ? '准备就绪' : '暂无书籍';
    playerDetail.textContent = statusText || '点击播放开启连读';
    return;
  }
  if (isPaused) {
    playBtn.textContent = '▶ 继续';
    playBtn.classList.remove('playing');
    playerDetail.textContent = '已暂停 · 点击继续';
    return;
  }
  playBtn.textContent = '⏸ 暂停';
  playBtn.classList.add('playing');
  const b = books.find(x => x.bookId === currentPlayingBookId);
  if (b) {
    playerBookTitle.textContent = `《${b.title}》` + (b.author ? ` · ${b.author}` : '');
    const hl = b.highlights[currentPlayingHlIdx];
    playerDetail.textContent = `第 ${currentPlayingHlIdx + 1}/${b.highlights.length} 条` + (hl && hl.chapter ? `（${hl.chapter}）` : '');
  }
}

function playHighlight(bookIndex, hlIndex) {
  if (!synth) { alert('当前浏览器不支持语音合成 (Web Speech API)'); return; }
  if (bookIndex < 0 || bookIndex >= books.length) { stopPlay('所有书籍朗读完毕'); return; }

  const book = books[bookIndex];
  if (!book.highlights || !book.highlights.length) {
    if (playModeSelect.value === 'all' && bookIndex + 1 < books.length) { playHighlight(bookIndex + 1, 0); } else { stopPlay('朗读完成'); }
    return;
  }

  if (hlIndex >= book.highlights.length) {
    if (playModeSelect.value === 'all') {
      if (bookIndex + 1 < books.length) { playHighlight(bookIndex + 1, 0); } else { stopPlay('所有书已朗读完毕 🎉'); }
    } else { stopPlay('当前书朗读完毕'); }
    return;
  }

  isPlaying = true;
  isPaused = false;
  currentPlayingBookId = book.bookId;
  currentPlayingHlIdx = hlIndex;

  if (activeBookId !== book.bookId) { selectBook(book.bookId); } else { updateActiveCardVisual(); }
  updatePlayerUI();
  synth.cancel();

  const hl = book.highlights[hlIndex];
  // 拼接朗读文案：每本书第1条带上书名，后续直接朗读划线正文（不朗读章节名称）
  let speakText = '';
  if (hlIndex === 0) { speakText += `开始朗读：《${book.title}》` + (book.author ? `，作者：${book.author}` : '') + '。'; }
  speakText += hl.text;

  const utter = new SpeechSynthesisUtterance(speakText);
  utter.rate = parseFloat(rateSelect.value) || 1.0;
  utter.voice = getChineseVoice();

  utter.onend = () => { if (isPlaying && !isPaused) playHighlight(bookIndex, hlIndex + 1); };
  utter.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled' && isPlaying) playHighlight(bookIndex, hlIndex + 1); };

  currentUtterance = utter;
  synth.speak(utter);
  clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(() => { if (isPlaying && !isPaused && synth.speaking) { synth.pause(); synth.resume(); } }, 12000);
}

function startPlay() {
  if (!books.length) { alert('暂无书籍'); return; }
  if (isPaused && synth.paused) { isPaused = false; synth.resume(); updatePlayerUI(); return; }
  let bIdx = books.findIndex(x => x.bookId === (currentPlayingBookId || activeBookId));
  if (bIdx < 0) bIdx = 0;
  playHighlight(bIdx, currentPlayingHlIdx || 0);
}

function pausePlay() { if (isPlaying && !isPaused) { isPaused = true; synth.pause(); updatePlayerUI(); } }
function stopPlay(statusHint) { isPlaying = false; isPaused = false; clearInterval(keepAliveTimer); if (synth) synth.cancel(); updateActiveCardVisual(); updatePlayerUI(statusHint); }
function playFromSpecific(bookId, hlIdx) { const bIdx = books.findIndex(x => x.bookId === bookId); if (bIdx >= 0) playHighlight(bIdx, hlIdx); }

playBtn.onclick = () => { if (!isPlaying || isPaused) startPlay(); else pausePlay(); };
stopBtn.onclick = () => stopPlay('已停止朗读');
nextBtn.onclick = () => { let bIdx = books.findIndex(x => x.bookId === (currentPlayingBookId || activeBookId)); if (bIdx >= 0) playHighlight(bIdx, (currentPlayingHlIdx || 0) + 1); };
prevBtn.onclick = () => { let bIdx = books.findIndex(x => x.bookId === (currentPlayingBookId || activeBookId)); if (bIdx >= 0) playHighlight(bIdx, Math.max(0, (currentPlayingHlIdx || 0) - 1)); };
rateSelect.onchange = () => { if (isPlaying && !isPaused) { let bIdx = books.findIndex(x => x.bookId === currentPlayingBookId); if (bIdx >= 0) playHighlight(bIdx, currentPlayingHlIdx); } };

// 启动
(async () => {
  renderSidebar();
  if (activeBookId) {
    selectBook(activeBookId);
  } else if (books.length) {
    selectBook(books[0].bookId);
  }
  updatePlayerUI();
  // 静默补全旧数据的书名/作者
  books.forEach(b => refreshBookMeta(b));
})();
