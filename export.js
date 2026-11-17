(() => {
  const $ = id => document.getElementById(id);
  const characters = $('characters'), other = $('otherReferenceUpload'), form = $('briefForm'), feedback = $('feedback');
  const dialog = $('resultDialog'), resultPages = $('resultPages'), resultTitle = $('resultTitle'), resultNote = $('resultNote');
  const resultShare = $('resultShare'), resultDownload = $('resultDownload');
  const attachments = new WeakMap(), decodedCache = new WeakMap();
  const MAX_FILE = 20 * 1024 * 1024, LIMITS = { character: 8, other: 12 };
  const IMAGE_EXT = /\.(png|jpe?g|webp|gif|heic|heif|bmp|avif)$/i;

  const say = message => { feedback.textContent = message; };
  const imagesChanged = () => window.dispatchEvent(new Event('commission:images-changed'));
  const groups = () => [...characters.children, other];
  const groupOf = el => el.closest('.character') || (other.contains(el) ? other : null);
  const limitOf = card => card === other ? LIMITS.other : LIMITS.character;
  const itemsOf = card => attachments.get(card) || [];

  /* ================= 參考圖：加入、顯示、移除 ================= */
  function imageFrom(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('圖片無法讀取'));
      img.src = url;
    });
  }
  function decode(item) {
    if (!decodedCache.has(item)) decodedCache.set(item, imageFrom(item.url).catch(() => null));
    return decodedCache.get(item);
  }
  function showImages(card) {
    const list = card.querySelector('.image-list');
    list.replaceChildren();
    const items = itemsOf(card);
    for (const item of items) {
      const thumb = document.createElement('div'); thumb.className = 'thumb';
      const image = document.createElement('img'); image.src = item.url; image.alt = item.file.name; image.loading = 'lazy';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'thumb-remove'; remove.textContent = '×';
      remove.setAttribute('aria-label', `移除 ${item.file.name}`);
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(item.url);
        attachments.set(card, itemsOf(card).filter(x => x !== item));
        showImages(card); imagesChanged();
      });
      thumb.append(image, remove);
      decode(item).then(ok => {
        if (ok) return;
        thumb.classList.add('bad');
        const note = document.createElement('span'); note.textContent = '這台裝置無法讀取'; thumb.append(note);
      });
      list.append(thumb);
    }
    const add = document.createElement('button'); add.type = 'button'; add.className = 'add-image';
    add.innerHTML = '<span aria-hidden="true">＋</span>加入圖片';
    add.hidden = items.length >= limitOf(card);
    add.addEventListener('click', () => card.querySelector('.image-input').click());
    list.append(add);
  }
  function addFiles(card, files) {
    const current = itemsOf(card).slice(), limit = limitOf(card);
    let added = 0; const problems = [];
    for (const file of files) {
      if (!file.type.startsWith('image/') && !IMAGE_EXT.test(file.name)) { problems.push(`「${file.name}」不是圖片`); continue; }
      if (file.size > MAX_FILE) { problems.push(`「${file.name}」超過 20 MB`); continue; }
      if (current.length >= limit) { problems.push(`這裡最多放 ${limit} 張`); break; }
      current.push({ file, url: URL.createObjectURL(file) }); added++;
    }
    attachments.set(card, current); showImages(card);
    say([added ? `已加入 ${added} 張圖片。` : '', problems.length ? `未加入：${problems.join('、')}。` : ''].join(' ').trim());
    if (added) imagesChanged();
  }
  function releaseFiles(card) {
    for (const item of itemsOf(card)) URL.revokeObjectURL(item.url);
    attachments.delete(card);
  }
  // 每張角色卡片（包含之後新增的）都放上「加入圖片」按鈕
  const ensureTiles = () => groups().forEach(card => { if (!card.querySelector('.add-image')) showImages(card); });
  new MutationObserver(ensureTiles).observe(characters, { childList: true });
  ensureTiles();

  form.addEventListener('change', event => {
    if (!event.target.matches('.image-input')) return;
    const card = groupOf(event.target);
    if (card) addFiles(card, [...event.target.files]);
    event.target.value = '';
  });
  // 電腦：拖曳圖片
  let dragTarget = null;
  form.addEventListener('dragover', event => {
    const box = event.target.closest('.upload');
    if (!box || !event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
    if (dragTarget !== box) { dragTarget?.classList.remove('dragging'); dragTarget = box; box.classList.add('dragging'); }
  });
  form.addEventListener('dragleave', event => {
    const box = event.target.closest('.upload');
    if (box && !box.contains(event.relatedTarget)) { box.classList.remove('dragging'); if (dragTarget === box) dragTarget = null; }
  });
  form.addEventListener('drop', event => {
    const box = event.target.closest('.upload');
    if (!box) return;
    event.preventDefault(); box.classList.remove('dragging'); dragTarget = null;
    const card = groupOf(box);
    if (card) addFiles(card, [...(event.dataTransfer?.files || [])]);
  });
  window.addEventListener('dragover', event => { if (!event.target.closest?.('.upload')) event.preventDefault(); });
  window.addEventListener('drop', event => { if (!event.target.closest?.('.upload')) event.preventDefault(); });
  // 電腦：直接貼上（Ctrl+V）截圖或複製的圖片
  document.addEventListener('paste', event => {
    const files = [...(event.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    const step = form.querySelector('.step:not([hidden])')?.dataset.step;
    const card = step === '2' ? (document.activeElement?.closest?.('.character') || characters.firstElementChild) : step === '4' ? other : null;
    if (!card) return;
    event.preventDefault();
    addFiles(card, files.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `貼上的圖片-${Date.now()}-${i + 1}.png`, { type: f.type })));
  });

  window.commissionImageDraft = {
    count(card) { return itemsOf(card).length; },
    release(card) { releaseFiles(card); imagesChanged(); },
    snapshot() {
      const pack = card => itemsOf(card).map(({ file }) => ({ name: file.name, type: file.type, lastModified: file.lastModified, blob: file }));
      return { characters: [...characters.children].map(pack), other: pack(other) };
    },
    restore(data) {
      const restoreGroup = (card, list) => {
        if (!card) return;
        releaseFiles(card);
        attachments.set(card, (Array.isArray(list) ? list : []).filter(x => x?.blob instanceof Blob).map(x => {
          const file = new File([x.blob], x.name || '參考圖', { type: x.type || x.blob.type, lastModified: x.lastModified || Date.now() });
          return { file, url: URL.createObjectURL(file) };
        }));
        showImages(card);
      };
      [...characters.children].forEach((card, i) => restoreGroup(card, data?.characters?.[i]));
      restoreGroup(other, data?.other);
      imagesChanged();
    },
  };

  /* ================= 自動排版（圖片與 PDF 共用） ================= */
  const W = 1080, M = 72, PAGE_H = 1528, TOP = 70, FOOT = 92, SCALE = 2;
  const family = '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';
  const F = { title: `900 46px ${family}`, head: `800 31px ${family}`, label: `700 24px ${family}`, body: `400 28px ${family}`, small: `400 21px ${family}` };
  const C = { ink: '#1c2b3a', navy: '#183e60', label: '#2a5a82', sub: '#7b8794', band: '#eef3f8', warm: '#eeb87a', line: '#e3e7ec' };

  function wrap(ctx, text, maxWidth, font) {
    ctx.font = font;
    const lines = [];
    let line = '';
    // 英文單字與數字不從中間斷開，中文逐字換行
    for (const token of text.match(/[A-Za-z0-9@#&_.,:;'"!?()\-/+%]+|\s+|./gu) || []) {
      if (line && ctx.measureText(line + token).width > maxWidth) {
        if (ctx.measureText(token).width > maxWidth) {
          for (const char of Array.from(token)) {
            if (line && ctx.measureText(line + char).width > maxWidth) { lines.push(line); line = char; }
            else line += char;
          }
          continue;
        }
        lines.push(line.trimEnd()); line = token.trimStart();
      } else line += token;
    }
    lines.push(line);
    return lines;
  }
  function roundedPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  async function buildPages() {
    const { data, cards } = window.getCommissionExportData();
    const all = [...cards, other];
    if (!data.sections.length && !all.some(card => itemsOf(card).length)) throw new Error('請先填寫需求或加入參考圖。');
    const pictures = new Map(); let failed = 0;
    for (const card of all) {
      const list = [];
      for (const item of itemsOf(card)) { const image = await decode(item); if (image) list.push(image); else failed++; }
      pictures.set(card, list);
    }
    const measure = document.createElement('canvas').getContext('2d');
    const blocks = [];
    const space = h => blocks.push({ h, space: true });
    const text = (value, font, color, h, dy = 0, keep = false) => blocks.push({ h, keep, draw(ctx, y) { ctx.font = font; ctx.fillStyle = color; ctx.fillText(value, M, y + dy); } });
    const paragraph = value => {
      for (const p of value.split('\n')) {
        if (!p.trim()) { space(18); continue; }
        for (const line of wrap(measure, p, W - 2 * M, F.body)) text(line, F.body, C.ink, 44, 8);
      }
    };
    const heading = value => {
      const label = wrap(measure, value, W - 2 * M - 44, F.head)[0];
      blocks.push({ h: 62, keep: true, draw(ctx, y) {
        ctx.fillStyle = C.band; roundedPath(ctx, M, y, W - 2 * M, 56, 14); ctx.fill();
        ctx.font = F.head; ctx.fillStyle = C.navy; ctx.fillText(label, M + 22, y + 12);
      } });
      space(14);
    };
    // 左欄標籤、右欄內容，短的項目只佔一行
    const LABEL_W = 222;
    const row = (label, value) => {
      const lines = value.split('\n').filter(p => p.trim()).flatMap(p => wrap(measure, p, W - 2 * M - LABEL_W, F.body));
      lines.forEach((line, i) => blocks.push({ h: 44, draw(ctx, y) {
        if (!i) { ctx.font = F.label; ctx.fillStyle = C.label; ctx.fillText(label, M, y + 11); }
        ctx.font = F.body; ctx.fillStyle = C.ink; ctx.fillText(line, M + LABEL_W, y + 8);
      } }));
      space(12);
    };
    const images = list => {
      if (!list.length) return;
      const cols = list.length === 1 ? 1 : 2, gap = 20;
      const colW = (W - 2 * M - gap * (cols - 1)) / cols, maxH = cols === 1 ? 640 : 560;
      for (let i = 0; i < list.length; i += cols) {
        const cells = list.slice(i, i + cols).map(image => {
          const scale = Math.min(1, colW / image.naturalWidth, maxH / image.naturalHeight);
          return { image, w: Math.max(1, Math.round(image.naturalWidth * scale)), h: Math.max(1, Math.round(image.naturalHeight * scale)) };
        });
        const rowH = Math.max(...cells.map(c => c.h));
        blocks.push({ h: rowH + 20, draw(ctx, y) {
          cells.forEach((cell, column) => {
            const x = M + column * (colW + gap) + (colW - cell.w) / 2, top = y + (rowH - cell.h) / 2;
            ctx.save(); roundedPath(ctx, x, top, cell.w, cell.h, 14); ctx.clip();
            ctx.drawImage(cell.image, x, top, cell.w, cell.h); ctx.restore();
          });
        } });
      }
      space(8);
    };

    blocks.push({ h: 118, draw(ctx, y) {
      ctx.font = F.title; ctx.fillStyle = C.navy; ctx.fillText('繪圖委託需求', M, y);
      ctx.fillStyle = C.warm; roundedPath(ctx, M, y + 70, 72, 7, 4); ctx.fill();
    } });
    if (data.sections.length) { paragraph(data.greeting); space(26); }
    for (const section of data.sections) {
      heading(section.title);
      for (const [label, value, attachmentNote] of section.rows) if (!attachmentNote) row(label, value);
      if (section.card && pictures.get(section.card).length) {
        text('設定圖', F.label, C.label, 40, 4, true);
        images(pictures.get(section.card));
      }
      if (section.kind === 'delivery' && pictures.get(other).length) {
        text('其他參考圖', F.label, C.label, 40, 4, true);
        images(pictures.get(other));
      }
      space(22);
    }
    const tailStart = blocks.length;
    if (data.sections.length) paragraph(data.closing);
    const tailHeight = blocks.slice(tailStart).reduce((sum, b) => sum + b.h, 0) + 22;

    // 分頁：文字只在行與行之間換頁，圖片不會被切開，標題不會落單
    const limit = PAGE_H - FOOT, pages = [];
    let page = [], y = TOP, bottom = TOP;
    const flush = () => { pages.push({ items: page, end: bottom }); page = []; y = bottom = TOP; };
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.space) { if (page.length) y += block.h; continue; }
      let need = block.h;
      if (block.keep) {
        let j = i + 1;
        while (j < blocks.length && (blocks[j].keep || blocks[j].space)) need += blocks[j++].h;
        if (j < blocks.length) need += blocks[j].h;
      }
      // 結尾的話不單獨落在最後一頁：最後一個區塊會陪它一起換頁
      if (i < tailStart) { let j = i + 1; while (j < tailStart && blocks[j].space) j++; if (j === tailStart) need += tailHeight; }
      if (page.length && y + need > limit) flush();
      page.push({ block, y }); y += block.h; bottom = y;
    }
    if (page.length) flush();
    return { pages, failed };
  }
  function renderPage(page, index, total, fixedHeight) {
    const height = fixedHeight ? PAGE_H : Math.ceil(page.end + FOOT);
    const canvas = document.createElement('canvas');
    canvas.width = W * SCALE; canvas.height = height * SCALE;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('這個瀏覽器無法產生圖片。');
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, height);
    ctx.imageSmoothingQuality = 'high'; ctx.textBaseline = 'top';
    for (const { block, y } of page.items) block.draw(ctx, y);
    const fy = height - FOOT + 30;
    ctx.fillStyle = C.line; ctx.fillRect(M, fy, W - 2 * M, 2);
    ctx.font = F.small; ctx.fillStyle = C.sub;
    ctx.fillText('繪圖委託需求', M, fy + 18);
    const pageLabel = `${index + 1} / ${total}`, credit = '畫委託需求整理所';
    ctx.fillText(pageLabel, (W - ctx.measureText(pageLabel).width) / 2, fy + 18);
    ctx.fillText(credit, W - M - ctx.measureText(credit).width, fy + 18);
    return canvas;
  }
  const jpegFrom = canvas => new Promise((resolve, reject) =>
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('無法產生檔案，請減少圖片後再試。')), 'image/jpeg', 0.92));

  async function pdfFromJpegs(pages) {
    const encoder = new TextEncoder(), chunks = [], offsets = [0]; let length = 0;
    const push = data => { const bytes = typeof data === 'string' ? encoder.encode(data) : data; chunks.push(bytes); length += bytes.length; };
    const object = (id, body) => { offsets[id] = length; push(`${id} 0 obj\n`); body(); push('\nendobj\n'); };
    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    object(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${pages.length} >>`));
    for (let i = 0; i < pages.length; i++) {
      const { blob, width, height } = pages[i], bytes = new Uint8Array(await blob.arrayBuffer());
      const page = 3 + i * 3, image = page + 1, content = page + 2;
      object(page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`));
      object(image, () => { push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`); push(bytes); push('\nendstream'); });
      const commands = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
      object(content, () => push(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`));
    }
    const xref = length;
    push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    for (let i = 1; i < offsets.length; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  /* ================= 傳送：下載與分享 ================= */
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const canShareFiles = files => Boolean(navigator.share && navigator.canShare?.({ files }));
  async function downloadFiles(files) {
    for (const file of files) {
      const url = URL.createObjectURL(file), link = document.createElement('a');
      link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (files.length > 1) await pause(450);
    }
  }
  // 備份檔也使用這個函式（draft.js）
  window.commissionDeliver = async files => {
    if (canShareFiles(files)) {
      try { await navigator.share({ files }); return 'shared'; }
      catch (error) { if (error.name === 'AbortError') return 'cancelled'; }
    }
    await downloadFiles(files); return 'downloaded';
  };
  function baseName() {
    const first = [...characters.querySelectorAll('[data-key="name"]')].map(x => x.value.trim()).find(Boolean);
    return '委託需求' + (first ? '-' + first.replace(/[\\/:*?"<>|\s]+/g, '') : '');
  }

  let resultFiles = [], resultUrls = [];
  function openResult(title, note, files, previews) {
    resultFiles = files;
    resultUrls.forEach(URL.revokeObjectURL);
    resultUrls = previews.map(blob => URL.createObjectURL(blob));
    resultPages.replaceChildren(...resultUrls.map((url, i) => {
      const image = document.createElement('img'); image.src = url; image.alt = `第 ${i + 1} 頁預覽`; return image;
    }));
    resultTitle.textContent = title; resultNote.textContent = note;
    resultShare.hidden = !canShareFiles(files);
    resultDownload.textContent = resultShare.hidden ? '下載' : '下載到裝置';
    resultDownload.className = resultShare.hidden ? 'big' : 'ghost';
    dialog.showModal(); resultPages.scrollTop = 0;
  }
  async function make(mode, button) {
    const original = button.querySelector('b').textContent;
    button.disabled = true; button.querySelector('b').textContent = '製作中…'; say('');
    try {
      const { pages, failed } = await buildPages();
      const rendered = [];
      for (let i = 0; i < pages.length; i++) {
        const canvas = renderPage(pages[i], i, pages.length, mode === 'pdf');
        rendered.push({ blob: await jpegFrom(canvas), width: canvas.width, height: canvas.height });
        canvas.width = canvas.height = 0;
      }
      const base = baseName(), skipped = failed ? `（有 ${failed} 張圖片這台裝置無法讀取，已略過）` : '';
      const files = mode === 'pdf'
        ? [new File([await pdfFromJpegs(rendered)], `${base}.pdf`, { type: 'application/pdf' })]
        : rendered.map((page, i) => new File([page.blob], rendered.length > 1 ? `${base}-${i + 1}.jpg` : `${base}.jpg`, { type: 'image/jpeg' }));
      const title = mode === 'pdf' ? 'PDF 做好了' : '圖片做好了';
      const note = (mode === 'pdf' ? `一份 PDF，共 ${rendered.length} 頁。` : rendered.length > 1 ? `共 ${rendered.length} 張圖片，請依順序傳送。` : '一張圖片。') + skipped;
      if (typeof dialog.showModal !== 'function') { await downloadFiles(files); say('已下載。' + skipped); return; }
      openResult(title, note, files, rendered.map(page => page.blob));
    } catch (error) { say(error.message || '製作失敗，請再試一次。'); }
    finally { button.disabled = false; button.querySelector('b').textContent = original; }
  }
  resultShare.addEventListener('click', () => {
    // 必須在點擊當下直接呼叫，iPhone 才會開啟分享選單
    navigator.share({ files: resultFiles }).then(() => { resultNote.textContent = '已開啟分享選單。'; },
      error => { if (error.name !== 'AbortError') resultNote.textContent = '無法分享，請改用下載。'; });
  });
  resultDownload.addEventListener('click', async () => {
    await downloadFiles(resultFiles);
    resultNote.textContent = resultFiles.length > 1 ? `已下載 ${resultFiles.length} 個檔案。` : '已下載。';
  });
  $('closeResult').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { resultUrls.forEach(URL.revokeObjectURL); resultUrls = []; resultFiles = []; resultPages.replaceChildren(); });

  /* ---------- 原圖：手機直接分享，電腦打包成 ZIP ---------- */
  const crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  function crc(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(entries) {
    const encoder = new TextEncoder(), parts = [], central = []; let offset = 0;
    for (const entry of entries) {
      const name = encoder.encode(entry.name), data = entry.data, check = crc(data);
      const local = new Uint8Array(30 + name.length), v = new DataView(local.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true);
      v.setUint32(14, check, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true);
      v.setUint16(26, name.length, true); local.set(name, 30); parts.push(local, data);
      const item = new Uint8Array(46 + name.length), cv = new DataView(item.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
      cv.setUint32(16, check, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); item.set(name, 46);
      central.push(item); offset += local.length + data.length;
    }
    const end = new Uint8Array(22), v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true); v.setUint16(8, entries.length, true); v.setUint16(10, entries.length, true);
    v.setUint32(12, central.reduce((sum, part) => sum + part.length, 0), true); v.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  function namedOriginals() {
    const clean = value => value.replace(/[\\/:*?"<>|\s]+/g, '');
    return groups().flatMap((card, index) => {
      const name = card === other ? '其他參考圖' : `角色${index + 1}` + (clean(card.querySelector('[data-key="name"]').value) ? '-' + clean(card.querySelector('[data-key="name"]').value) : '');
      return itemsOf(card).map(({ file }, i) => {
        const ext = (file.name.match(/\.[A-Za-z0-9]+$/) || ['.png'])[0];
        return new File([file], `${name}-${i + 1}${ext}`, { type: file.type, lastModified: file.lastModified });
      });
    });
  }
  $('shareOriginals').addEventListener('click', async event => {
    const { text } = window.getCommissionExportData();
    const files = namedOriginals();
    if (!files.length) { say('還沒有加入參考圖，直接按「複製文字」就可以了。'); return; }
    if (matchMedia('(pointer: coarse)').matches && canShareFiles(files)) {
      if (text) navigator.clipboard?.writeText(text).catch(() => {});
      navigator.share({ files, text }).then(() => say('已開啟分享選單；文字也已複製，可以在傳送圖片後貼上。'),
        error => { if (error.name !== 'AbortError') say('無法分享，請再試一次。'); });
      return;
    }
    const button = event.currentTarget; button.disabled = true;
    try {
      const entries = [];
      if (text) entries.push({ name: '委託需求.txt', data: new TextEncoder().encode('﻿' + text) });
      for (const file of files) entries.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
      await downloadFiles([new File([zip(entries)], `${baseName()}-原圖.zip`, { type: 'application/zip' })]);
      say(`已下載 ZIP：${text ? '文字檔和 ' : ''}${files.length} 張原圖。`);
    } catch { say('打包失敗，請再試一次。'); }
    finally { button.disabled = false; }
  });
  $('makeImages').addEventListener('click', event => make('images', event.currentTarget));
  $('makePdf').addEventListener('click', event => make('pdf', event.currentTarget));
})();
