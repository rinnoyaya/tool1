(() => {
  const form = document.getElementById('briefForm');
  const characters = document.getElementById('characters');
  const status = document.getElementById('draftStatus');
  const imageDraft = window.commissionImageDraft;
  const textKey = 'commissionBriefTextDraftV1';
  const fieldIds = ['workType', 'purpose', 'budget', 'deadline', 'scene', 'interaction',
    'background', 'style', 'size', 'format', 'must', 'avoid', 'references', 'notes', 'greeting', 'closing'];
  let restoring = true, textTimer, imageTimer;

  function message(value) { status.textContent = value; }
  function collectText() {
    const fields = Object.fromEntries(fieldIds.map(id => [id, document.getElementById(id).value]));
    const people = [...characters.children].map(card =>
      Object.fromEntries([...card.querySelectorAll('[data-key]')].map(input => [input.dataset.key, input.value])));
    return { fields, characters: people, savedAt: Date.now() };
  }
  function saveText() {
    clearTimeout(textTimer); textTimer = null;
    if (restoring) return;
    try {
      localStorage.setItem(textKey, JSON.stringify(collectText()));
      message('草稿已自動儲存在這台裝置。');
    } catch { message('此瀏覽器無法儲存文字草稿；請先匯出備份檔。'); }
  }
  function scheduleTextSave() {
    if (restoring) return;
    clearTimeout(textTimer);
    textTimer = setTimeout(saveText, 500);
  }
  function restoreText(data, reset = false) {
    if (!data || typeof data !== 'object') return false;
    const people = Array.isArray(data.characters) ? data.characters : [];
    window.commissionCharacters.setCount(Math.max(1, people.length));
    if (reset) {
      for (const id of fieldIds) document.getElementById(id).value = '';
      characters.querySelectorAll('[data-key]').forEach(input => { input.value = ''; });
    }
    for (const [id, value] of Object.entries(data.fields || {})) {
      if (fieldIds.includes(id) && typeof value === 'string') document.getElementById(id).value = value;
    }
    people.forEach((values, i) => {
      const card = characters.children[i];
      if (!card || !values || typeof values !== 'object') return;
      for (const input of card.querySelectorAll('[data-key]')) {
        if (typeof values[input.dataset.key] === 'string') input.value = values[input.dataset.key];
      }
    });
    form.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  /* ---------- 圖片草稿（IndexedDB） ---------- */
  function openDatabase() {
    return new Promise(resolve => {
      if (!('indexedDB' in window)) { resolve(null); return; }
      let request;
      try { request = indexedDB.open('commission-brief-local-draft', 1); }
      catch { resolve(null); return; }
      request.onupgradeneeded = () => request.result.createObjectStore('draft');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  const database = openDatabase();
  function readImages(db) {
    return new Promise(resolve => {
      try {
        const request = db.transaction('draft', 'readonly').objectStore('draft').get('images');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  function writeImages(db, data) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('draft', 'readwrite');
        tx.objectStore('draft').put(data, 'images');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      } catch (error) { reject(error); }
    });
  }
  let imageWrites = Promise.resolve();
  function flushImages() {
    clearTimeout(imageTimer); imageTimer = null;
    if (restoring) return imageWrites;
    // 在畫面更新完成後才擷取，確保角色順序與圖片對得上
    const snapshot = imageDraft.snapshot();
    imageWrites = imageWrites.catch(() => {}).then(async () => {
      const db = await database;
      if (!db) { message('文字已儲存；此瀏覽器無法保存參考圖，請匯出備份檔。'); return; }
      await writeImages(db, snapshot);
      message('文字與參考圖已自動儲存在這台裝置。');
    }).catch(() => message('文字已儲存；圖片儲存空間不足，請匯出備份檔。'));
    return imageWrites;
  }
  function saveImages() {
    if (restoring) return;
    clearTimeout(imageTimer);
    imageTimer = setTimeout(flushImages, 250);
  }
  function saveAll() { scheduleTextSave(); saveImages(); }

  async function restoreDraft() {
    let restoredText = false, restoredImages = false;
    try {
      const saved = localStorage.getItem(textKey);
      if (saved) restoredText = restoreText(JSON.parse(saved));
    } catch { /* A blocked or invalid local draft leaves the form usable. */ }
    const db = await database;
    if (db) {
      const images = await readImages(db);
      if (images) {
        try { imageDraft.restore(images); restoredImages = true; } catch { /* Keep text if files cannot be restored. */ }
      }
    }
    restoring = false;
    message(restoredText || restoredImages
      ? '已恢復這台裝置上次填寫的草稿。後續修改會自動儲存。'
      : '開始填寫後會自動儲存在這台裝置。');
  }

  /* ---------- 備份檔：匯出／匯入 ---------- */
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  function stamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
  async function exportBackup() {
    const button = document.getElementById('exportBackup');
    button.disabled = true; message('正在準備備份檔…');
    try {
      const snap = imageDraft.snapshot();
      const pack = list => Promise.all(list.map(async x => ({
        name: x.name, type: x.type, lastModified: x.lastModified, size: x.size, data: await blobToDataURL(x.blob),
      })));
      const backup = {
        app: 'commission-brief', version: 1, exportedAt: new Date().toISOString(),
        text: collectText(),
        images: { characters: await Promise.all(snap.characters.map(pack)), other: await pack(snap.other) },
      };
      const firstName = backup.text.characters.map(c => c.name?.trim()).find(Boolean);
      const name = `委託需求備份${firstName ? '-' + firstName.replace(/[\\/:*?"<>|]/g, '') : ''}-${stamp()}.json`;
      const result = await window.commissionDeliver([new File([JSON.stringify(backup)], name, { type: 'application/json' })]);
      message(result === 'cancelled' ? '已取消匯出備份。' : '備份檔已匯出（含文字與參考圖），之後可用「匯入備份檔」還原。');
    } catch { message('備份檔匯出失敗，請再試一次。'); }
    finally { button.disabled = false; }
  }
  async function importBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { message('無法讀取這個檔案，請確認是本工具匯出的備份檔（.json）。'); return; }
    if (data?.app !== 'commission-brief' || !data.text || typeof data.text !== 'object') {
      message('這不是本工具的備份檔。'); return;
    }
    const current = window.getCommissionExportData();
    const hasImages = [...characters.children, document.getElementById('otherReferenceUpload')].some(el => imageDraft.count(el));
    if ((current.text || hasImages) && !confirm('匯入會取代目前填寫的文字與參考圖，確定要繼續嗎？\n（建議先匯出目前內容的備份檔）')) return;
    message('正在匯入備份檔…');
    restoring = true; clearTimeout(textTimer); clearTimeout(imageTimer);
    try {
      restoreText(data.text, true);
      const unpack = list => Promise.all((Array.isArray(list) ? list : [])
        .filter(x => typeof x?.data === 'string' && x.data.startsWith('data:image/'))
        .map(async x => ({ ...x, blob: await (await fetch(x.data)).blob() })));
      const people = Array.isArray(data.images?.characters) ? data.images.characters : [];
      imageDraft.restore({ characters: await Promise.all(people.map(unpack)), other: await unpack(data.images?.other) });
    } catch { message('部分內容無法匯入，請確認備份檔是否完整。'); }
    finally { restoring = false; }
    saveText(); await flushImages();
    message('已匯入備份檔，並儲存在這台裝置。');
    window.commissionCharacters.notify?.('已匯入備份檔');
  }

  form.addEventListener('input', scheduleTextSave);
  document.getElementById('addCharacter').addEventListener('click', saveAll);
  window.addEventListener('commission:changed', saveAll);
  window.addEventListener('commission:images-changed', saveImages);
  window.addEventListener('pagehide', () => {
    if (textTimer) saveText();
    if (imageTimer) flushImages();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (textTimer) saveText(); if (imageTimer) flushImages(); }
  });
  document.getElementById('exportBackup').addEventListener('click', exportBackup);
  const backupInput = document.getElementById('backupFile');
  document.getElementById('importBackup').addEventListener('click', () => backupInput.click());
  backupInput.addEventListener('change', () => {
    const file = backupInput.files[0]; backupInput.value = '';
    if (file) importBackup(file);
  });
  document.getElementById('clearDraft').addEventListener('click', async () => {
    if (!confirm('要清除這台裝置保存的文字和參考圖，開始新的委託嗎？這項操作無法復原。\n（需要保留的話，請先按「匯出備份檔」）')) return;
    restoring = true; clearTimeout(textTimer); clearTimeout(imageTimer);
    try { localStorage.removeItem(textKey); } catch {}
    await imageWrites.catch(() => {});
    const db = await database;
    if (db) {
      try { await new Promise(resolve => {
        const tx = db.transaction('draft', 'readwrite');
        tx.objectStore('draft').delete('images');
        tx.oncomplete = tx.onerror = tx.onabort = resolve;
      }); } catch {}
    }
    location.reload();
  });
  restoreDraft();
})();
