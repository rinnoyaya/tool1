// 角色庫：把常用角色（文字與設定圖）存在這台裝置，下次委託直接帶入
(() => {
  const $ = id => document.getElementById(id);
  const characters = $('characters'), dialog = $('libraryDialog'), list = $('libraryList');
  const bar = $('libraryBar'), countEl = $('libraryCount');
  const images = window.commissionImageDraft, people = window.commissionCharacters;
  const toast = message => people?.notify?.(message);
  let thumbUrls = [];

  function openDatabase() {
    return new Promise(resolve => {
      if (!('indexedDB' in window)) { resolve(null); return; }
      let request;
      try { request = indexedDB.open('commission-brief-characters', 1); } catch { resolve(null); return; }
      request.onupgradeneeded = () => request.result.createObjectStore('characters', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  const database = openDatabase();
  async function run(mode, work) {
    const db = await database;
    if (!db) throw new Error('這個瀏覽器無法使用角色庫（可能是無痕模式）。');
    return new Promise((resolve, reject) => {
      const tx = db.transaction('characters', mode);
      const request = work(tx.objectStore('characters'));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('儲存空間不足'));
    });
  }
  const getAll = async () => ((await run('readonly', store => store.getAll())) || []).sort((a, b) => b.updatedAt - a.updatedAt);

  async function refreshBar() {
    try {
      const all = await getAll();
      countEl.textContent = all.length;
      bar.hidden = !all.length;
      return all;
    } catch { bar.hidden = true; return []; }
  }

  /* ---------- 存到角色庫 ---------- */
  async function save(card) {
    const values = Object.fromEntries([...card.querySelectorAll('[data-key]')].map(input => [input.dataset.key, input.value]));
    const name = (values.name || '').trim();
    if (!name) {
      toast('請先填寫角色名稱，才能存到角色庫。');
      card.querySelector('[data-key="name"]').focus();
      return;
    }
    const files = images.files(card);
    try {
      const all = await getAll();
      const same = all.find(item => item.name === name);
      if (same && !confirm(`角色庫裡已經有「${name}」，要用這張卡片的內容更新嗎？`)) return;
      const record = {
        id: same?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name, values, updatedAt: Date.now(),
        images: files.map(file => ({ name: file.name, type: file.type, lastModified: file.lastModified, blob: file })),
      };
      await run('readwrite', store => store.put(record));
      await refreshBar();
      toast(same ? `已更新角色庫中的「${name}」` : `已把「${name}」存到角色庫${files.length ? `（含 ${files.length} 張設定圖）` : ''}`);
    } catch (error) {
      toast(error?.name === 'QuotaExceededError' ? '裝置儲存空間不足，請減少設定圖後再試。' : (error?.message || '存到角色庫失敗，請再試一次。'));
    }
  }
  characters.addEventListener('click', event => {
    const button = event.target.closest('.save-char');
    if (button) save(button.closest('.character'));
  });

  /* ---------- 從角色庫帶入 ---------- */
  function bringIn(record) {
    // 只有一張空白卡片時直接填入，否則新增一位角色
    const empty = [...characters.children].find(card => people.isEmpty(card));
    const card = empty || people.add();
    for (const input of card.querySelectorAll('[data-key]')) {
      input.value = typeof record.values?.[input.dataset.key] === 'string' ? record.values[input.dataset.key] : '';
    }
    const files = (record.images || []).filter(item => item?.blob instanceof Blob)
      .map(item => new File([item.blob], item.name || '設定圖.png', { type: item.type || item.blob.type, lastModified: item.lastModified || Date.now() }));
    if (files.length) images.addTo(card, files);
    $('briefForm').dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new Event('commission:changed'));
    dialog.close();
    setTimeout(() => toast(`已帶入「${record.name}」${files.length ? `（含 ${files.length} 張設定圖）` : ''}`), 60);
    setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
  async function remove(record) {
    if (!confirm(`要從角色庫刪除「${record.name}」嗎？（這次委託裡已經帶入的內容不會受影響）`)) return;
    try { await run('readwrite', store => store.delete(record.id)); } catch { toast('刪除失敗，請再試一次。'); return; }
    const all = await refreshBar();
    if (all.length) render(all); else dialog.close();
    toast(`已刪除「${record.name}」`);
  }
  function render(all) {
    thumbUrls.forEach(URL.revokeObjectURL); thumbUrls = [];
    const inUse = new Set([...characters.querySelectorAll('[data-key="name"]')].map(input => input.value.trim()).filter(Boolean));
    list.replaceChildren(...all.map(record => {
      const item = document.createElement('div'); item.className = 'lib-item';
      const first = record.images?.find(x => x?.blob instanceof Blob);
      let thumb;
      if (first) {
        thumb = document.createElement('img'); thumb.className = 'lib-thumb'; thumb.alt = '';
        const url = URL.createObjectURL(first.blob); thumbUrls.push(url); thumb.src = url;
      } else {
        thumb = document.createElement('span'); thumb.className = 'lib-thumb'; thumb.textContent = Array.from(record.name)[0] || '?';
      }
      const info = document.createElement('div'); info.className = 'lib-info';
      const name = document.createElement('strong');
      name.textContent = record.values?.romaji?.trim() ? `${record.name}（${record.values.romaji.trim()}）` : record.name;
      const role = document.createElement('span'); role.textContent = record.values?.role?.trim() || record.values?.appearance?.trim().split('\n')[0] || '　';
      const meta = document.createElement('span');
      const d = new Date(record.updatedAt);
      meta.textContent = `${record.images?.length ? `設定圖 ${record.images.length} 張 · ` : ''}${d.getMonth() + 1}/${d.getDate()} 更新`;
      info.append(name, role, meta);
      const acts = document.createElement('div'); acts.className = 'lib-acts';
      const use = document.createElement('button'); use.type = 'button'; use.className = 'big';
      use.textContent = inUse.has(record.name) ? '再帶入一次' : '帶入';
      use.addEventListener('click', () => bringIn(record));
      const del = document.createElement('button'); del.type = 'button'; del.className = 'text-btn remove'; del.textContent = '刪除';
      del.addEventListener('click', () => remove(record));
      acts.append(use, del);
      item.append(thumb, info, acts);
      return item;
    }));
  }
  $('openLibrary').addEventListener('click', async () => {
    const all = await refreshBar();
    if (!all.length) { toast('角色庫還是空的。在角色卡片上按「存到角色庫」就能存起來。'); return; }
    render(all);
    dialog.showModal();
  });
  $('closeLibrary').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { thumbUrls.forEach(URL.revokeObjectURL); thumbUrls = []; list.replaceChildren(); });

  refreshBar();
})();
