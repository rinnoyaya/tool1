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
    let all = [];
    try { all = await getAll(); } catch { bar.hidden = true; return []; }
    countEl.textContent = all.length;
    $('libraryHas').hidden = !all.length; $('openLibrary').hidden = !all.length;
    $('libraryEmpty').hidden = Boolean(all.length);
    bar.classList.toggle('empty', !all.length);
    return all;
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
      use.textContent = inUse.has(record.name) ? '再帶入' : '帶入';
      use.addEventListener('click', () => bringIn(record));
      const mini = document.createElement('div'); mini.className = 'mini';
      const out = document.createElement('button'); out.type = 'button'; out.className = 'text-btn'; out.textContent = '匯出';
      out.addEventListener('click', () => exportRecords([record]));
      const del = document.createElement('button'); del.type = 'button'; del.className = 'text-btn remove'; del.textContent = '刪除';
      del.addEventListener('click', () => remove(record));
      mini.append(out, del);
      acts.append(use, mini);
      item.append(thumb, info, acts);
      return item;
    }));
  }
  async function openDialog() {
    const all = await refreshBar();
    if (!all.length) { toast('角色庫還是空的。在角色卡片上按「存到角色庫」就能存起來。'); return; }
    render(all);
    if (!dialog.open) dialog.showModal();
  }
  $('openLibrary').addEventListener('click', openDialog);

  /* ---------- 匯出：存成角色檔（.json，含設定圖） ---------- */
  const toDataURL = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`; };
  const safe = text => text.replace(/[\\/:*?"<>|\s]+/g, '');
  async function exportRecords(records) {
    if (!records.length) { toast('角色庫還是空的。'); return; }
    try {
      const data = {
        app: 'commission-brief-characters', version: 1, exportedAt: new Date().toISOString(),
        characters: await Promise.all(records.map(async record => ({
          name: record.name, values: record.values, updatedAt: record.updatedAt,
          images: await Promise.all((record.images || []).filter(x => x?.blob instanceof Blob).map(async x => ({
            name: x.name, type: x.type, lastModified: x.lastModified, data: await toDataURL(x.blob),
          }))),
        }))),
      };
      const name = records.length === 1 ? `角色-${safe(records[0].name) || '未命名'}.json` : `角色庫-${records.length}位-${stamp()}.json`;
      const result = await window.commissionDeliver([new File([JSON.stringify(data)], name, { type: 'application/json' })]);
      if (result !== 'cancelled') toast(records.length === 1 ? `已匯出「${records[0].name}」的角色檔` : `已匯出 ${records.length} 位角色`);
    } catch { toast('匯出失敗，請再試一次。'); }
  }
  $('exportLibrary').addEventListener('click', async () => exportRecords(await getAll().catch(() => [])));

  /* ---------- 匯入：角色檔，或本工具的委託備份檔 ---------- */
  const fileInput = $('libraryFile');
  $('importLibrary').addEventListener('click', () => fileInput.click());
  $('importLibraryEmpty').addEventListener('click', () => fileInput.click());
  const fromDataURL = async (url, item) => {
    if (typeof url !== 'string' || !url.startsWith('data:image/')) return null;
    const blob = await (await fetch(url)).blob();
    return { name: item.name || '設定圖.png', type: item.type || blob.type, lastModified: item.lastModified || Date.now(), blob };
  };
  async function recordsFrom(data) {
    const list = [];
    if (data?.app === 'commission-brief-characters' && Array.isArray(data.characters)) {
      for (const c of data.characters) list.push({ name: c?.name, values: c?.values, updatedAt: c?.updatedAt, images: c?.images });
    } else if (data?.app === 'commission-brief' && Array.isArray(data.text?.characters)) {
      // 委託備份檔：把裡面有名字的角色取出來
      data.text.characters.forEach((values, i) => list.push({ name: values?.name, values, images: data.images?.characters?.[i] }));
    } else return null;
    const out = [];
    for (const c of list) {
      const name = typeof c.name === 'string' ? c.name.trim() : '';
      if (!name || !c.values || typeof c.values !== 'object') continue;
      const values = Object.fromEntries(Object.entries(c.values).filter(([, v]) => typeof v === 'string'));
      const pics = (await Promise.all((Array.isArray(c.images) ? c.images : []).map(item => fromDataURL(item?.data, item || {}).catch(() => null)))).filter(Boolean);
      out.push({ name, values: { ...values, name }, images: pics, updatedAt: Number(c.updatedAt) || Date.now() });
    }
    return out;
  }
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files]; fileInput.value = '';
    if (!files.length) return;
    let incoming = [], bad = 0;
    for (const file of files) {
      try {
        const records = await recordsFrom(JSON.parse(await file.text()));
        if (records) incoming.push(...records); else bad++;
      } catch { bad++; }
    }
    if (!incoming.length) { toast(bad ? '這不是本工具的角色檔或備份檔。' : '檔案裡沒有可以匯入的角色（角色需要有名字）。'); return; }
    try {
      const all = await getAll();
      const byName = new Map(all.map(item => [item.name, item]));
      const dupes = incoming.filter(item => byName.has(item.name));
      let replace = true;
      if (dupes.length) replace = confirm(`角色庫裡已經有：${dupes.map(d => `「${d.name}」`).join('、')}。\n\n要用匯入的內容取代嗎？\n（按「取消」會保留原本的，只加入新角色）`);
      let added = 0, updated = 0;
      await run('readwrite', store => {
        for (const item of incoming) {
          const existing = byName.get(item.name);
          if (existing && !replace) continue;
          store.put({ ...item, id: existing?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, updatedAt: Date.now() });
          existing ? updated++ : added++;
        }
      });
      await refreshBar();
      const parts = [added && `新增 ${added} 位`, updated && `更新 ${updated} 位`].filter(Boolean);
      toast(parts.length ? `已匯入角色：${parts.join('、')}` : '沒有新的角色，角色庫維持原樣。');
      if (parts.length) openDialog();
    } catch (error) {
      toast(error?.name === 'QuotaExceededError' ? '裝置儲存空間不足，無法匯入全部角色。' : '匯入失敗，請再試一次。');
    }
  });
  $('closeLibrary').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { thumbUrls.forEach(URL.revokeObjectURL); thumbUrls = []; list.replaceChildren(); });

  refreshBar();
})();
