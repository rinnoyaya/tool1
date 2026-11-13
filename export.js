(() => {
  const characters = document.getElementById('characters');
  const otherReferences = document.getElementById('otherReferenceUpload');
  const form = document.getElementById('briefForm');
  const feedback = document.getElementById('feedback');
  const pngButton = document.getElementById('exportPng');
  const pdfButton = document.getElementById('exportPdf');
  const pdfDialog = document.getElementById('pdfDialog');
  const pdfPages = document.getElementById('pdfPages');
  const pdfImagePanel = document.getElementById('pdfImagePanel');
  const pdfImageList = document.getElementById('pdfImageList');
  const pdfStatus = document.getElementById('pdfStatus');
  const downloadPdf = document.getElementById('downloadPdf');
  const attachments = new WeakMap();
  const decodedCache = new WeakMap();
  const W = 1080, M = 74, PAGE_H = 1528;
  const PDF_SCALE = 2, PREVIEW_SCALE = 0.5;
  const MAX_FILE = 10 * 1024 * 1024, MAX_PER_CHARACTER = 8;
  const PNG_MAX_AREA = 14_500_000, PNG_PART_H = 12000;
  const IMAGE_EXT = /\.(png|jpe?g|webp|gif|heic|heif)$/i;
  let pdfLayout = null, manualCuts = [], pdfResizeTimer = null, pdfRevision = 0;

  function say(message) { feedback.textContent = message; }
  function imagesChanged() { window.dispatchEvent(new Event('commission:images-changed')); }
  function releaseFiles(card) {
    for (const item of attachments.get(card) || []) URL.revokeObjectURL(item.url);
    attachments.delete(card);
  }
  function normalizedSize(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 20 && number <= 100 ? number : 100;
  }

  /* ---------- 上傳與縮圖 ---------- */
  function showImages(card) {
    const list = card.querySelector('.image-list');
    list.replaceChildren();
    for (const item of attachments.get(card) || []) {
      const tile = document.createElement('div'); tile.className = 'image-item';
      const image = document.createElement('img'); image.src = item.url; image.alt = item.file.name;
      image.loading = 'lazy'; image.decoding = 'async';
      const name = document.createElement('span'); name.className = 'image-name'; name.textContent = item.file.name;
      decode(item).then(ok => {
        if (!ok) { name.textContent = `⚠ 此瀏覽器無法讀取，匯出時會略過：${item.file.name}`; name.style.color = '#9b4b4b'; }
      });
      const size = document.createElement('label'); size.className = 'image-size';
      size.append('輸出大小 ');
      const value = document.createElement('output'); value.textContent = `${item.size}%`;
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = '20'; slider.max = '100'; slider.step = '5';
      slider.value = String(item.size); slider.setAttribute('aria-label', `${item.file.name} 的輸出大小`);
      slider.addEventListener('input', () => { item.size = Number(slider.value); value.textContent = `${item.size}%`; });
      slider.addEventListener('change', imagesChanged);
      size.append(value, slider);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label', `移除 ${item.file.name}`);
      remove.addEventListener('click', () => {
        const remaining = (attachments.get(card) || []).filter(x => x !== item);
        URL.revokeObjectURL(item.url); attachments.set(card, remaining); showImages(card);
        imagesChanged();
      });
      tile.append(image, name, size, remove); list.append(tile);
    }
  }
  function addFiles(card, files) {
    const isOther = card === otherReferences;
    const current = attachments.get(card) || [];
    let added = 0; const problems = [];
    for (const file of files) {
      if (!file.type.startsWith('image/') && !IMAGE_EXT.test(file.name)) { problems.push(`「${file.name}」不是圖片`); continue; }
      if (file.size > MAX_FILE) { problems.push(`「${file.name}」超過 10 MB`); continue; }
      if (!isOther && current.length >= MAX_PER_CHARACTER) { problems.push(`每位角色最多 ${MAX_PER_CHARACTER} 張`); break; }
      current.push({ file, url: URL.createObjectURL(file), size: 100 }); added++;
    }
    attachments.set(card, current); showImages(card);
    say([added ? `已加入 ${added} 張參考圖。` : '', problems.length ? `未加入：${problems.join('、')}。` : ''].join(' ').trim());
    if (added) imagesChanged();
  }
  const groupOf = el => el.closest('.character') || (otherReferences.contains(el) ? otherReferences : null);
  form.addEventListener('change', event => {
    if (!event.target.matches('.image-input')) return;
    const card = groupOf(event.target);
    if (card) addFiles(card, [...event.target.files]);
    event.target.value = '';
  });
  // 電腦版：把圖片直接拖曳到上傳框
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
  // 避免拖曳失誤時瀏覽器直接開啟圖片、離開頁面
  window.addEventListener('dragover', event => { if (!event.target.closest?.('.upload')) event.preventDefault(); });
  window.addEventListener('drop', event => { if (!event.target.closest?.('.upload')) event.preventDefault(); });

  window.commissionImageDraft = {
    count(card) { return (attachments.get(card) || []).length; },
    release(card) { releaseFiles(card); imagesChanged(); },
    snapshot() {
      const pack = card => (attachments.get(card) || []).map(({ file, size }) => ({
        name: file.name, type: file.type, lastModified: file.lastModified, blob: file, size,
      }));
      return { characters: [...characters.children].map(pack), other: pack(otherReferences) };
    },
    restore(data) {
      const restoreGroup = (card, list) => {
        if (!card) return;
        releaseFiles(card);
        const items = (Array.isArray(list) ? list : []).filter(x => x?.blob instanceof Blob)
          .map(x => {
            const file = new File([x.blob], x.name || '參考圖', {
              type: x.type || x.blob.type, lastModified: x.lastModified || Date.now(),
            });
            return { file, url: URL.createObjectURL(file), size: normalizedSize(x.size) };
          });
        attachments.set(card, items); showImages(card);
      };
      [...characters.children].forEach((card, i) => restoreGroup(card, data?.characters?.[i]));
      restoreGroup(otherReferences, data?.other);
      imagesChanged();
    },
  };

  /* ---------- 排版 ---------- */
  function imageFrom(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('有圖片無法讀取，請改用 JPG、PNG 或 WebP 再試。'));
      img.src = url;
    });
  }
  function decode(item) {
    if (!decodedCache.has(item)) decodedCache.set(item, imageFrom(item.url).catch(() => null));
    return decodedCache.get(item);
  }
  function wrap(ctx, text, maxWidth, font) {
    ctx.font = font;
    const lines = [];
    for (const paragraph of text.split('\n')) {
      if (!paragraph) { lines.push(''); continue; }
      let line = '';
      // 英文單字與數字盡量不從中間斷開，中文逐字換行
      for (const token of paragraph.match(/[A-Za-z0-9@#&_.,:;'"!?()\-/+%]+|\s+|./gu) || []) {
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
    }
    return lines;
  }
  async function buildLayout() {
    const { data, cards } = window.getCommissionExportData();
    const groups = [...cards, otherReferences];
    const hasImage = groups.some(card => (attachments.get(card) || []).length);
    if (!data.sections.length && !hasImage) throw new Error('請先填寫需求或上傳參考圖。');
    const decoded = new Map(); let failed = 0;
    for (const card of groups) {
      const list = [];
      for (const item of attachments.get(card) || []) {
        const image = await decode(item);
        if (image) list.push({ image, size: normalizedSize(item.size) }); else failed++;
      }
      decoded.set(card, list);
    }
    const measure = document.createElement('canvas').getContext('2d');
    const ops = [], strongBreaks = [], lineEnds = [], imageRegions = [];
    let y = 78;
    const family = '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';
    const bodyFont = `27px ${family}`, labelFont = `bold 27px ${family}`;
    const headingFont = `bold 34px ${family}`, titleFont = `bold 43px ${family}`;
    function text(value, x, font, color, h, breakable = true) {
      ops.push({ type: 'text', value, x, y, font, color, h });
      y += h; if (breakable) lineEnds.push(y);
    }
    function title(value) { for (const line of wrap(measure, value, W - 2 * M, titleFont)) text(line, M, titleFont, '#173b59', 62); }
    function heading(value) {
      const wrapped = wrap(measure, value, W - 2 * M - 42, headingFont);
      ops.push({ type: 'headingBand', y: y - 10, h: wrapped.length * 52 + 17 });
      for (const line of wrapped) text(line, M + 21, headingFont, '#1e526c', 52, false);
      y += 13;
    }
    function paragraph(value) {
      for (const p of value.split('\n')) {
        if (!p) { y += 23; continue; }
        for (const line of wrap(measure, p, W - 2 * M, bodyFont)) text(line, M, bodyFont, '#344557', 44);
        y += 5;
      }
    }
    function row(label, value) {
      const caption = `${label}：`;
      measure.font = labelFont;
      const contentX = M + measure.measureText(caption).width + 14;
      ops.push({ type: 'text', value: caption, x: M, y, font: labelFont, color: '#2c6b80', h: 44 });
      value.split('\n').forEach(p => {
        if (!p) { y += 22; return; }
        for (const line of wrap(measure, p, W - M - contentX, bodyFont)) text(line, contentX, bodyFont, '#344557', 44);
      });
      y += 9;
    }
    function divider() { ops.push({ type: 'divider', y }); strongBreaks.push(y + 8); }
    function addImages(list, compact = false) {
      if (!list.length) return;
      y += 8;
      const columnWidth = compact ? Math.floor((W - 2 * M - 20) / 2) : W - 2 * M;
      const perRow = compact ? 2 : 1;
      for (let i = 0; i < list.length; i += perRow) {
        const items = list.slice(i, i + perRow).map(({ image, size }) => {
          const scale = Math.min(1, (columnWidth - 28) / image.width, (compact ? 580 : 950) / image.height) * size / 100;
          return { image, w: Math.max(1, Math.round(image.width * scale)), h: Math.max(1, Math.round(image.height * scale)) };
        });
        const rowHeight = Math.max(...items.map(item => item.h));
        items.forEach((item, column) => {
          const boxX = M + column * (columnWidth + 20);
          ops.push({ type: 'image', image: item.image, x: boxX + (columnWidth - item.w) / 2,
            y: y + 14 + (rowHeight - item.h) / 2, w: item.w, h: item.h,
            boxX, boxW: columnWidth, boxY: y, boxH: rowHeight + 28 });
        });
        imageRegions.push({ top: y, end: y + rowHeight + 28 });
        strongBreaks.push(y, y + rowHeight + 36);
        y += rowHeight + 42;
      }
    }
    function closeSection() { y += 26; divider(); y += 35; }

    ops.push({ type: 'bar' });
    title('繪圖委託需求'); y += 9;
    divider(); y += 30;
    if (data.sections.length && data.greeting) { paragraph(data.greeting); y += 28; }
    const placed = new Set(); let otherPlaced = false;
    for (const section of data.sections) {
      const rows = section.rows.filter(r => !r[2]);
      const others = section.kind === 'delivery' ? decoded.get(otherReferences) : [];
      if (rows.length || section.kind !== 'delivery') {
        heading(section.title); y += 4;
        for (const [label, value] of rows) row(label, value);
      }
      if (section.card) { addImages(decoded.get(section.card) || []); placed.add(section.card); }
      if (others.length) {
        if (rows.length) y += 10;
        heading('其他參考圖'); addImages(others, true); otherPlaced = true;
      }
      closeSection();
    }
    cards.forEach((card, index) => {
      const list = decoded.get(card) || [];
      if (placed.has(card) || !list.length) return;
      heading(`角色 ${index + 1}｜參考設定圖`); addImages(list); closeSection();
    });
    if (!otherPlaced && decoded.get(otherReferences).length) {
      heading('其他參考圖'); addImages(decoded.get(otherReferences), true); closeSection();
    }
    if (data.sections.length && data.closing) paragraph(data.closing);
    const height = Math.ceil(y + M);
    return { ops, height, strongBreaks, lineEnds, imageRegions, failed };
  }

  /* ---------- 依區段繪製（每頁各自繪製，不再受單張畫布長度限制） ---------- */
  function extent(op) {
    if (op.type === 'bar') return [0, 18];
    if (op.type === 'divider') return [op.y, op.y + 2];
    if (op.type === 'image') return [op.boxY, op.boxY + op.boxH];
    return [op.y, op.y + op.h];
  }
  function renderRegion(layout, top, end, scale, canvasH = end - top) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale); canvas.height = Math.round(canvasH * scale);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('此瀏覽器無法產生圖片。');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(scale, 0, 0, scale, 0, -top * scale);
    ctx.beginPath(); ctx.rect(0, top, W, end - top); ctx.clip();
    ctx.textBaseline = 'top';
    for (const op of layout.ops) {
      const [a, b] = extent(op);
      if (b <= top || a >= end) continue;
      if (op.type === 'bar') { ctx.fillStyle = '#173b59'; ctx.fillRect(0, 0, W, 18); }
      if (op.type === 'divider') { ctx.fillStyle = '#d9e3eb'; ctx.fillRect(M, op.y, W - 2 * M, 2); }
      if (op.type === 'headingBand') {
        ctx.fillStyle = '#e9f3f6'; ctx.fillRect(M, op.y, W - 2 * M, op.h);
        ctx.fillStyle = '#3f8194'; ctx.fillRect(M, op.y, 7, op.h);
      }
      if (op.type === 'text') { ctx.font = op.font; ctx.fillStyle = op.color; ctx.fillText(op.value, op.x, op.y); }
      if (op.type === 'image') {
        ctx.fillStyle = '#f5f8fa'; ctx.fillRect(op.boxX, op.boxY, op.boxW, op.boxH);
        ctx.drawImage(op.image, op.x, op.y, op.w, op.h);
      }
    }
    return canvas;
  }
  function pageSlices(layout, cuts = [], pageH = PAGE_H) {
    const { height, strongBreaks, lineEnds, imageRegions } = layout;
    const pages = [];
    for (let top = 0; top < height;) {
      const target = Math.min(top + pageH, height);
      const manual = cuts.find(y => y > top && y <= target);
      let end;
      if (manual) end = manual;
      else if (target === height) end = height;
      else {
        // 優先在段落分隔線／圖片之間換頁；找不到時改在文字行之間換頁，避免把字切成兩半
        end = strongBreaks.filter(y => y >= top + pageH * 0.59 && y <= target - 25).pop()
          ?? lineEnds.filter(y => y >= top + 200 && y <= target).pop()
          ?? target;
        const crossing = imageRegions.find(r => r.top < end && r.end > end && r.top >= top);
        if (crossing) end = crossing.top > top + 50 ? crossing.top : Math.min(crossing.end, target);
      }
      if (end <= top) end = target;
      pages.push({ top, end, manual: Boolean(manual) });
      top = end;
    }
    return pages;
  }
  function snapCut(layout, value) {
    const candidates = [...layout.strongBreaks, ...layout.lineEnds];
    let best = value, distance = 40;
    for (const y of candidates) { const d = Math.abs(y - value); if (d < distance) { distance = d; best = y; } }
    return best;
  }

  /* ---------- 檔案輸出 ---------- */
  function blobFrom(canvas, type, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('無法產生檔案，可能是內容太大，請縮小部分圖片後再試。')), type, quality));
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function deliverFiles(files) {
    if (navigator.share && navigator.canShare?.({ files })) {
      try { await navigator.share({ files, title: '繪圖委託需求' }); return 'shared'; }
      catch (error) { if (error.name === 'AbortError') return 'cancelled'; }
    }
    for (const file of files) {
      const url = URL.createObjectURL(file), link = document.createElement('a');
      link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (files.length > 1) await pause(450);
    }
    return 'downloaded';
  }
  window.commissionDeliver = deliverFiles;
  function pdfFromImages(images) {
    const encoder = new TextEncoder(), chunks = []; let length = 0;
    const offsets = [0];
    function push(bytes) { const data = typeof bytes === 'string' ? encoder.encode(bytes) : bytes; chunks.push(data); length += data.length; }
    function object(id, body) { offsets[id] = length; push(`${id} 0 obj\n`); body(); push('\nendobj\n'); }
    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const kids = images.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    object(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`));
    images.forEach(({ bytes, compressed, width, height }, i) => {
      const page = 3 + i * 3, image = page + 1, content = page + 2;
      object(page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`));
      object(image, () => { push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${compressed ? '/Filter /FlateDecode ' : ''}/Length ${bytes.length} >>\nstream\n`); push(bytes); push('\nendstream'); });
      const commands = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
      object(content, () => push(`<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}\nendstream`));
    });
    const xref = length;
    push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    for (let i = 1; i < offsets.length; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(chunks, { type: 'application/pdf' });
  }
  async function losslessPageImage(page) {
    const { width, height } = page;
    const rgba = page.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4) {
      rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2];
    }
    if (typeof CompressionStream === 'function') {
      try {
        const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'));
        return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), compressed: true, width, height };
      } catch { /* Fall back to uncompressed, still lossless pixels. */ }
    }
    return { bytes: rgb, compressed: false, width, height };
  }
  function skippedNote(layout) {
    return layout.failed ? ` 有 ${layout.failed} 張圖片此瀏覽器無法讀取（例如部分 HEIC），已略過。` : '';
  }

  /* ---------- PDF 預覽 ---------- */
  function showPdfImageControls() {
    pdfImageList.replaceChildren();
    const cards = [...characters.children, otherReferences];
    cards.forEach((card, cardIndex) => {
      (attachments.get(card) || []).forEach((item, imageIndex) => {
        const control = document.createElement('div'); control.className = 'pdf-image-item';
        const image = document.createElement('img'); image.src = item.url; image.alt = '';
        const label = document.createElement('label');
        const id = `pdf-image-size-${cardIndex}-${imageIndex}`; label.htmlFor = id;
        label.title = item.file.name;
        const name = document.createElement('span'); name.className = 'pdf-image-name';
        name.textContent = `${card === otherReferences ? '其他參考圖' : `角色 ${cardIndex + 1}`} · ${item.file.name}`;
        label.append(name);
        const value = document.createElement('output'); value.textContent = `${item.size}%`; label.append(value);
        const slider = document.createElement('input'); slider.type = 'range'; slider.id = id;
        slider.min = '20'; slider.max = '100'; slider.step = '5'; slider.value = String(item.size);
        slider.setAttribute('aria-label', `${item.file.name} 的 PDF 輸出大小`);
        slider.addEventListener('input', () => { value.textContent = `${slider.value}%`; });
        slider.addEventListener('change', () => {
          item.size = Number(slider.value);
          showImages(card);
          imagesChanged();
          schedulePdfRebuild();
        });
        control.append(image, label, slider); pdfImageList.append(control);
      });
    });
    pdfImagePanel.hidden = !pdfImageList.children.length;
  }
  function schedulePdfRebuild() {
    const revision = ++pdfRevision;
    clearTimeout(pdfResizeTimer);
    downloadPdf.disabled = true;
    pdfStatus.textContent = '正在依圖片大小重新排版…';
    pdfResizeTimer = setTimeout(async () => {
      pdfResizeTimer = null;
      try {
        const next = await buildLayout();
        if (revision !== pdfRevision || !pdfDialog.open) return;
        const hadManualCuts = manualCuts.length > 0;
        pdfLayout = next; manualCuts = [];
        renderPages();
        if (hadManualCuts) pdfStatus.textContent += ' · 圖片大小已更新，請重新設定手動分頁';
        downloadPdf.disabled = false;
      } catch (error) {
        if (revision === pdfRevision && pdfDialog.open) pdfStatus.textContent = error.message || '無法更新預覽，請調整圖片大小後再試。';
      }
    }, 150);
  }
  function renderPages() {
    if (!pdfLayout) return;
    const scroll = pdfPages.scrollTop;
    pdfPages.replaceChildren();
    const layout = pdfLayout, { height } = layout;
    const slices = pageSlices(layout, manualCuts);
    slices.forEach((slice, index) => {
      const card = document.createElement('section'); card.className = 'pdf-card';
      const heading = document.createElement('h3'); heading.textContent = `第 ${index + 1} 頁`;
      const sheet = renderRegion(layout, slice.top, slice.end, PREVIEW_SCALE, PAGE_H); sheet.className = 'pdf-sheet';
      sheet.setAttribute('role', 'img'); sheet.setAttribute('aria-label', `PDF 第 ${index + 1} 頁內容預覽`);
      card.append(heading, sheet);
      if (slice.end < height || slice.end - slice.top > 550) {
        const isLast = slice.end === height;
        const control = document.createElement('div'); control.className = 'page-control';
        const label = document.createElement('label');
        const id = `page-cut-${index}`; label.htmlFor = id;
        label.textContent = isLast ? `在第 ${index + 1} 頁新增分頁` : `第 ${index + 1} 頁的頁尾位置`;
        const slider = document.createElement('input');
        slider.type = 'range'; slider.id = id;
        slider.min = String(slice.top + 250);
        slider.max = String(isLast ? slice.end - 250 : Math.min(slice.top + PAGE_H, height - 1));
        slider.step = '1'; slider.value = String(isLast ? Math.max(slice.top + 250, slice.end - 450) : slice.end);
        const help = document.createElement('p'); help.className = 'page-help';
        help.textContent = isLast ? '選好位置後按「新增分頁」，內容會移到下一頁。' : '向左移動會提早換頁；位置會自動對齊到最近的行距，不會切到文字。';
        const apply = () => {
          const next = snapCut(layout, Number(slider.value));
          manualCuts = manualCuts.filter(y => y <= slice.top);
          if (next > slice.top) manualCuts.push(next);
          renderPages();
        };
        if (isLast) {
          const add = document.createElement('button'); add.type = 'button'; add.className = 'secondary';
          add.textContent = '新增分頁'; add.addEventListener('click', apply);
          control.append(label, slider, help, add);
        } else {
          slider.addEventListener('change', apply);
          control.append(label, slider, help);
        }
        card.append(control);
      }
      pdfPages.append(card);
    });
    pdfPages.scrollTop = scroll;
    pdfStatus.textContent = `預覽共 ${slices.length} 頁 · A4 直式${manualCuts.length ? ` · 已調整 ${manualCuts.length} 處分頁` : ' · 自動分頁'}${skippedNote(layout)}`;
  }

  /* ---------- 按鈕 ---------- */
  async function exportPng() {
    pngButton.disabled = true; say('正在排版與產生長圖片…');
    try {
      const layout = await buildLayout();
      const parts = layout.height * W <= PNG_MAX_AREA
        ? [{ top: 0, end: layout.height }]
        : pageSlices(layout, [], PNG_PART_H);
      const files = [];
      for (let i = 0; i < parts.length; i++) {
        const { top, end } = parts[i];
        const scale = Math.max(1, Math.min(2, Math.sqrt(PNG_MAX_AREA / (W * (end - top)))));
        const canvas = renderRegion(layout, top, end, scale);
        const name = parts.length > 1 ? `繪圖委託需求-${i + 1}.png` : '繪圖委託需求.png';
        files.push(new File([await blobFrom(canvas, 'image/png')], name, { type: 'image/png' }));
        canvas.width = canvas.height = 0;
      }
      const result = await deliverFiles(files);
      if (result === 'cancelled') say('已取消分享。');
      else say((parts.length > 1 ? `內容較長，已分成 ${parts.length} 張長圖片；` : '長圖片已產生；') + '請確認圖片與文字內容。' + skippedNote(layout));
    } catch (error) { say(error.message || '匯出失敗，請再試一次。'); }
    finally { pngButton.disabled = false; }
  }
  async function openPdfPreview() {
    if (typeof pdfDialog.showModal !== 'function') { say('此瀏覽器版本較舊，無法開啟 PDF 預覽，請改用「產生長圖片 PNG」。'); return; }
    pdfButton.disabled = true; say('正在產生 PDF 分頁預覽…');
    try {
      pdfLayout = await buildLayout(); manualCuts = [];
      showPdfImageControls();
      pdfDialog.showModal();
      renderPages();
      downloadPdf.disabled = false;
      say('可以在預覽中調整圖片大小與分頁位置。');
    } catch (error) { say(error.message || '無法開啟 PDF 預覽。'); }
    finally { pdfButton.disabled = false; }
  }
  async function exportPdf() {
    if (!pdfLayout) return;
    const layout = pdfLayout;
    pdfImageList.querySelectorAll('input').forEach(input => { input.disabled = true; });
    downloadPdf.disabled = true;
    try {
      const slices = pageSlices(layout, manualCuts);
      const pages = [];
      for (let i = 0; i < slices.length; i++) {
        pdfStatus.textContent = `正在輸出 PDF（${i + 1} / ${slices.length} 頁）…`;
        const page = renderRegion(layout, slices[i].top, slices[i].end, PDF_SCALE, PAGE_H);
        pages.push(await losslessPageImage(page));
        page.width = page.height = 0;
      }
      const result = await deliverFiles([new File([pdfFromImages(pages)], '繪圖委託需求.pdf', { type: 'application/pdf' })]);
      pdfStatus.textContent = result === 'cancelled' ? '已取消分享。' : 'PDF 已產生；可繼續調整或關閉預覽。';
    } catch (error) { pdfStatus.textContent = error.message || 'PDF 輸出失敗，請再試一次。'; }
    finally {
      pdfImageList.querySelectorAll('input').forEach(input => { input.disabled = false; });
      downloadPdf.disabled = false;
    }
  }
  pngButton.addEventListener('click', exportPng);
  pdfButton.addEventListener('click', openPdfPreview);
  downloadPdf.addEventListener('click', exportPdf);
  document.getElementById('resetPages').addEventListener('click', () => { manualCuts = []; renderPages(); });
  document.getElementById('closePdf').addEventListener('click', () => pdfDialog.close());
  pdfDialog.addEventListener('click', event => { if (event.target === pdfDialog) pdfDialog.close(); });
  pdfDialog.addEventListener('close', () => {
    pdfRevision++; clearTimeout(pdfResizeTimer); pdfResizeTimer = null;
    pdfLayout = null; manualCuts = []; pdfPages.replaceChildren(); pdfImageList.replaceChildren();
  });
})();
