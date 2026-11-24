import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, deleteDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => (self.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
const today = () => new Date().toISOString().slice(0, 10);
const nowStr = () => new Date().toLocaleString('en-IN');
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); return el; };
const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
const setHTML = (id, h) => { const el = $(id); if (el) el.innerHTML = h; };

const DEFAULT_CATS = ['Perfume & Attar', 'Watches', 'Earbuds', 'Cosmetics', 'Accessories', 'Other'];
const DEFAULT_SETTINGS = {
  storeName: 'NOORI PERFUME',
  phone: '',
  address: '',
  reorder: 5,
  adTitle: '',
  adText: '',
  adImage: '',
  adVideo: '',
  adSlides: ''
};

let d = {
  settings: { ...DEFAULT_SETTINGS },
  categories: [...DEFAULT_CATS],
  products: [],
  sales: [],
  purchases: [],
  purchaseOrders: [],
  expenses: [],
  attars: [],
  returns: [],
  stockTransfers: [],
  stockAdjustments: [],
  customers: [],
  suppliers: [],
  customerPayments: [],
  supplierPayments: [],
  activityLog: []
};

let cart = [];
let purchaseCart = [];
let syncingPurchaseMath = false;
let auth, db, user, profile, ref, unsub, timer;
let adIndex = 0, adTimer = null, adPaused = false;
let scannerStream = null, scannerLoop = null;

const app = initializeApp(firebaseConfig);
auth = getAuth(app);
db = getFirestore(app);

let toastTimer = null;
function toast(msg, kind = 'ok') {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
    el.style.display = 'none';
  }, kind === 'error' ? 4500 : 2600);
}

function logActivity(type, text) {
  d.activityLog = d.activityLog || [];
  d.activityLog.push({
    id: uid(),
    type,
    text,
    by: profile?.name || user?.email || 'Staff',
    at: nowStr(),
    date: today()
  });
  if (d.activityLog.length > 200) d.activityLog = d.activityLog.slice(-200);
}

function updateDocSizeMeter() {
  try {
    const bytes = new Blob([JSON.stringify(d)]).size;
    const kb = (bytes / 1024).toFixed(1);
    const pct = Math.min(100, Math.round((bytes / (1024 * 1024)) * 100));
    setText('docSize', `Cloud storage used: ${kb} KB / 1024 KB (${pct}%)`);
    if ($('docSizeBar')) {
      $('docSizeBar').style.width = pct + '%';
      $('docSizeBar').style.background = pct > 80 ? '#d9534f' : '#6940a5';
    }
  } catch {}
}

function save() {
  if (!ref) return;
  updateDocSizeMeter();
  clearTimeout(timer);
  timer = setTimeout(() => {
    setDoc(ref, { data: d, updatedAt: serverTimestamp(), updatedBy: user.uid })
      .then(() => { if ($('cloud')) $('cloud').textContent = 'Cloud synced'; })
      .catch((e) => toast('Sync error: ' + e.message, 'error'));
  }, 500);
}

function cats() {
  return [...new Set((d.categories || DEFAULT_CATS).map((c) => String(c).trim()).filter(Boolean))].sort();
}

function fill(id, arr, empty = '') {
  const el = $(id);
  if (!el) return;
  const old = el.value;
  el.innerHTML = (empty ? `<option value="">${esc(empty)}</option>` : '') +
    arr.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  if (arr.includes(old)) el.value = old;
}

function makeSku(category) {
  const c = String(category || '').toLowerCase();
  const prefix = c.includes('perfume') || c.includes('attar') ? 'PER'
    : c.includes('watch') ? 'WAT'
    : c.includes('earbud') ? 'EAR'
    : c.includes('cosmetic') ? 'COS'
    : c.includes('accessor') ? 'ACC' : 'OTH';
  let n = 1, sku;
  do {
    sku = prefix + '-' + String(n++).padStart(4, '0');
  } while (d.products.some((p) => p.sku === sku));
  return sku;
}

/* ---------------- Ad Slider & Slide Manager ---------------- */
function parseSlides(rawText) {
  return String(rawText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, text, image, video] = line.split('|').map((x) => (x || '').trim());
      return { title, text, image, video };
    })
    .filter((s) => s.title || s.text || s.image || s.video);
}

function serializeSlides(slides) {
  return (slides || []).map((s) => [s.title || '', s.text || '', s.image || '', s.video || ''].join(' | ')).join('\n');
}

function getAdSlides() {
  const list = parseSlides(d.settings.adSlides);
  if (!list.length) {
    list.push({
      title: d.settings.adTitle || 'Fragrance that stays with you',
      text: d.settings.adText || 'Attar • Perfumes • Premium Collection',
      image: d.settings.adImage || '',
      video: d.settings.adVideo || ''
    });
  }
  return list;
}

function isDirectVideo(url) {
  return /^(data:video\/|blob:|https?:\/\/.*\.(mp4|webm|ogg)(\?.*)?$)/i.test(String(url || '').trim());
}

function resetAdTimer(count) {
  clearInterval(adTimer);
  adTimer = null;
  if (count > 1 && !adPaused) {
    adTimer = setInterval(() => {
      const total = getAdSlides().length;
      if (total > 1) {
        adIndex = (adIndex + 1) % total;
        renderAds();
      }
    }, 5000);
  }
}

function renderAds() {
  const hero = $('adHero');
  if (!hero) return;
  const slides = getAdSlides();
  if (adIndex >= slides.length) adIndex = 0;
  const s = slides[adIndex] || slides[0];

  if ($('adTitleView')) $('adTitleView').textContent = s.title || 'NOORI PERFUME';
  if ($('adTextView')) $('adTextView').textContent = s.text || '';

  const img = $('adImageView');
  if (img) {
    if (s.image) {
      img.hidden = false;
      img.onerror = () => { img.hidden = true; };
      if (img.src !== s.image) img.src = s.image;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
    }
  }

  const vid = $('adVideoView');
  if (vid) {
    if (s.video && isDirectVideo(s.video)) {
      if (vid.src !== s.video) vid.src = s.video;
      vid.hidden = false;
      vid.play().catch(() => {});
    } else {
      vid.pause();
      vid.removeAttribute('src');
      vid.hidden = true;
    }
  }

  const actions = $('adMediaActions');
  if (actions) {
    actions.innerHTML = s.video && !isDirectVideo(s.video)
      ? `<a class="adVideoLink" href="${esc(s.video)}" target="_blank" rel="noopener">▶ Watch promo video</a>`
      : '';
  }

  const ctrl = $('adControls');
  const dots = $('adDots');
  const playBtn = $('adTogglePlay');
  if (ctrl) ctrl.hidden = slides.length <= 1;
  if (playBtn) playBtn.textContent = adPaused ? 'Play' : 'Pause';
  if (dots) {
    dots.innerHTML = slides.map((_, i) =>
      `<button type="button" class="adDot ${i === adIndex ? 'active' : ''}" data-ad-dot="${i}" aria-label="Slide ${i + 1}"></button>`
    ).join('');
    $$('[data-ad-dot]').forEach((b) => {
      b.onclick = () => {
        adIndex = Number(b.dataset.adDot);
        renderAds();
        resetAdTimer(slides.length);
      };
    });
  }

  resetAdTimer(slides.length);
}

function renderAdSlideManager() {
  const box = $('adSlideList');
  if (!box) return;
  const slides = parseSlides(d.settings.adSlides);
  box.innerHTML = slides.length ? slides.map((s, i) => `
    <div class="slideItem">
      <div>
        <b>#${i + 1} · ${esc(s.title || 'Untitled')}</b>
        <small class="muted">${esc(s.text || '')}${s.image ? ' · Photo' : ''}${s.video ? ' · Video' : ''}</small>
      </div>
      <div class="actions">
        <button type="button" class="alt tiny" data-sm-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="alt tiny" data-sm-dn="${i}" ${i === slides.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="alt tiny" data-sm-edit="${i}">Edit</button>
        <button type="button" class="alt tiny danger" data-sm-del="${i}">Del</button>
      </div>
    </div>
  `).join('') : '<p class="muted">No slides added yet.</p>';

  $$('[data-sm-edit]').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.smEdit);
      const item = slides[i];
      if (!item) return;
      if ($('adEditIndex')) $('adEditIndex').value = String(i);
      if ($('smTitle')) $('smTitle').value = item.title || '';
      if ($('smText')) $('smText').value = item.text || '';
      if ($('smImage')) $('smImage').value = item.image || '';
      if ($('smVideo')) $('smVideo').value = item.video || '';
    };
  });

  $$('[data-sm-del]').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.smDel);
      slides.splice(i, 1);
      d.settings.adSlides = serializeSlides(slides);
      if ($('adSlides')) $('adSlides').value = d.settings.adSlides;
      adIndex = 0;
      changed();
      toast('Slide removed');
    };
  });

  $$('[data-sm-up]').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.smUp);
      if (i <= 0) return;
      [slides[i - 1], slides[i]] = [slides[i], slides[i - 1]];
      d.settings.adSlides = serializeSlides(slides);
      if ($('adSlides')) $('adSlides').value = d.settings.adSlides;
      changed();
      toast('Slide moved up');
    };
  });

  $$('[data-sm-dn]').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.smDn);
      if (i >= slides.length - 1) return;
      [slides[i], slides[i + 1]] = [slides[i + 1], slides[i]];
      d.settings.adSlides = serializeSlides(slides);
      if ($('adSlides')) $('adSlides').value = d.settings.adSlides;
      changed();
      toast('Slide moved down');
    };
  });
}

on('adPrev', 'click', () => {
  const slides = getAdSlides();
  adIndex = (adIndex - 1 + slides.length) % slides.length;
  renderAds();
  resetAdTimer(slides.length);
});

on('adNext', 'click', () => {
  const slides = getAdSlides();
  adIndex = (adIndex + 1) % slides.length;
  renderAds();
  resetAdTimer(slides.length);
});

on('adTogglePlay', 'click', () => {
  adPaused = !adPaused;
  renderAds();
});

function clearSlideForm() {
  if ($('adEditIndex')) $('adEditIndex').value = '-1';
  if ($('smTitle')) $('smTitle').value = '';
  if ($('smText')) $('smText').value = '';
  if ($('smImage')) $('smImage').value = '';
  if ($('smVideo')) $('smVideo').value = '';
  if ($('smImageFile')) $('smImageFile').value = '';
  if ($('smVideoFile')) $('smVideoFile').value = '';
  setText('smPreviewStatus', '');
}

on('smClearSlide', 'click', clearSlideForm);

on('smSaveSlide', 'click', () => {
  const title = ($('smTitle')?.value || '').trim();
  const text = ($('smText')?.value || '').trim();
  const image = ($('smImage')?.value || '').trim();
  const video = ($('smVideo')?.value || '').trim();
  if (!title && !text && !image && !video) {
    return toast('Headline, text, photo ya video mein se kam se kam ek bharo', 'error');
  }
  const slides = parseSlides($('adSlides')?.value ?? d.settings.adSlides);
  const idx = Number($('adEditIndex')?.value ?? -1);
  const entry = { title: title || 'NOORI PERFUME', text, image, video };
  if (idx >= 0 && idx < slides.length) slides[idx] = entry;
  else slides.push(entry);
  d.settings.adSlides = serializeSlides(slides);
  if ($('adSlides')) $('adSlides').value = d.settings.adSlides;
  clearSlideForm();
  changed();
  toast(idx >= 0 ? 'Slide updated' : 'Slide added');
});

/* ---------------- Browse Photo, Video & Product Gallery ---------------- */
function fileToCompressedDataUrl(file, maxW = 800, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / (img.width || maxW));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((img.width || maxW) * scale));
        canvas.height = Math.max(1, Math.round((img.height || maxW) * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Photo load nahi ho saki'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('File read nahi ho saki'));
    reader.readAsDataURL(file);
  });
}

function renderProductGalleryPreview(p) {
  const box = $('mediaUploadPreview');
  if (!box) return;
  if (!p) { box.innerHTML = ''; return; }
  const items = [
    ...(p.photoUrl ? [{ type: 'image', src: p.photoUrl }] : []),
    ...((p.gallery || []).map((g) => (typeof g === 'string' ? { type: isDirectVideo(g) ? 'video' : 'image', src: g } : g)))
  ].filter((item, idx, arr) => item.src && arr.findIndex((x) => x.src === item.src) === idx);

  box.innerHTML = items.length ? items.map((m) => m.type === 'video'
    ? `<video src="${esc(m.src)}" controls muted style="max-width:150px;border-radius:10px;margin:6px"></video>`
    : `<img src="${esc(m.src)}" alt="${esc(p.name)}" style="max-width:120px;border-radius:10px;margin:6px">`
  ).join('') : '<p class="muted">No photo/video gallery items for this product yet.</p>';
}

on('mediaProduct', 'change', () => {
  const p = d.products.find((x) => x.id === $('mediaProduct')?.value);
  renderProductGalleryPreview(p);
});

on('smImageFile', 'change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const dataUrl = await fileToCompressedDataUrl(f);
    if ($('smImage')) $('smImage').value = dataUrl;
    setText('smPreviewStatus', 'Photo ready: ' + f.name + ' (ab "+ Add / Update slide" dabao)');
  } catch (err) {
    toast(err.message, 'error');
  }
});

on('smVideoFile', 'change', (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.size > 600 * 1024) {
    toast('Video 600 KB se bada hai; Firestore cloud limit ke liye chhota MP4 clip ya public link use karein', 'error');
  }
  const reader = new FileReader();
  reader.onload = () => {
    if ($('smVideo')) $('smVideo').value = reader.result;
    setText('smPreviewStatus', 'Video ready: ' + f.name + ' (ab "+ Add / Update slide" dabao)');
  };
  reader.readAsDataURL(f);
});

on('productPhotoUpload', 'change', async (e) => {
  const files = Array.from(e.target.files || []);
  const p = d.products.find((x) => x.id === $('mediaProduct')?.value);
  if (!files.length) return;
  if (!p) return toast('Pehle upar Product select karo', 'error');
  try {
    p.gallery = p.gallery || [];
    for (const f of files) {
      const dataUrl = await fileToCompressedDataUrl(f);
      p.gallery.push({ type: 'image', src: dataUrl });
      if (!p.photoUrl) p.photoUrl = dataUrl;
    }
    renderProductGalleryPreview(p);
    setText('mediaUploadStatus', `${files.length} photo(s) added to ${p.name} gallery`);
    changed();
    toast('Product gallery updated');
  } catch (err) {
    toast(err.message, 'error');
  }
});

on('setProductPhoto', 'click', () => {
  const p = d.products.find((x) => x.id === $('mediaProduct')?.value);
  const url = ($('mediaUrl')?.value || '').trim();
  if (!p) return toast('Pehle Product select karo', 'error');
  if (!url) return toast('Media URL daalo ya upar se photo browse karo', 'error');
  const isVid = isDirectVideo(url) || /youtu\.?be|vimeo/i.test(url);
  p.gallery = p.gallery || [];
  p.gallery.push({ type: isVid ? 'video' : 'image', src: url });
  if (!isVid) p.photoUrl = url;
  renderProductGalleryPreview(p);
  setText('mediaUploadStatus', (isVid ? 'Video added to ' : 'Photo set for ') + p.name);
  changed();
  toast('Product media saved');
});

on('adPhotoUpload', 'change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  try {
    const title = ($('adSlideTitle')?.value || '').trim() || 'NOORI PERFUME';
    const text = ($('adSlideText')?.value || '').trim();
    for (const f of files) {
      const dataUrl = await fileToCompressedDataUrl(f);
      const line = [title, text, dataUrl, ''].join(' | ');
      d.settings.adSlides = (d.settings.adSlides ? d.settings.adSlides + '\n' : '') + line;
    }
    if ($('adSlides')) $('adSlides').value = d.settings.adSlides;
    setText('mediaUploadStatus', `${files.length} ad photo slide(s) added`);
    changed();
    toast('Ad slide(s) added');
  } catch (err) {
    toast(err.message, 'error');
  }
});

on('adVideoUpload', 'change', (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.size > 600 * 1024) {
    toast('Video 600 KB se bada hai; chhota clip ya link behtar rahega', 'error');
  }
  const reader = new FileReader();
  reader.onload = () => {
    const title = ($('adSlideTitle')?.value || '').trim() || 'NOORI PERFUME';
    const text = ($('adSlideText')?.value || '').trim();
    const line = [title, text, '', reader.result].join(' | ');
    d.settings.adSlides = (d.settings.adSlides ? d.settings.adSlides + '\n' : '') + line;
    if ($('adSlides')) $('adSlides').value = d.settings.adSlides;
    setText('mediaUploadStatus', 'Ad video slide add ho gaya: ' + f.name);
    changed();
    toast('Ad video slide added');
  };
  reader.readAsDataURL(f);
});

on('addAdSlide', 'click', () => {
  const url = ($('mediaUrl')?.value || '').trim();
  const title = ($('adSlideTitle')?.value || '').trim() || 'NOORI PERFUME';
  const text = ($('adSlideText')?.value || '').trim();
  if (!url && !title && !text) return toast('URL ya headline/text daalo', 'error');
  const isVid = isDirectVideo(url) || /youtu\.?be|vimeo/i.test(url);
  const line = [title, text, isVid ? '' : url, isVid ? url : ''].join(' | ');
  d.settings.adSlides = (d.settings.adSlides ? d.settings.adSlides + '\n' : '') + line;
  if ($('adSlides')) $('adSlides').value = d.settings.adSlides;
  setText('mediaUploadStatus', 'Dashboard slide add ho gaya');
  changed();
  toast('Dashboard slide added');
});

/* ---------------- Core App & Auth ---------------- */
function changed() {
  render();
  save();
}

onAuthStateChanged(auth, async (u) => {
  if (unsub) { unsub(); unsub = null; }
  user = u;
  ref = null;
  if (!u) {
    if ($('login')) $('login').hidden = false;
    if ($('app')) $('app').hidden = true;
    if ($('logout')) $('logout').hidden = true;
    return;
  }
  try {
    const p = await getDoc(doc(db, 'users', u.uid));
    if (!p.exists()) throw new Error('No staff profile. Ask owner to create users/' + u.uid + ' in Firestore.');
    profile = p.data();
    if (!profile.shopId || !['owner', 'staff'].includes(profile.role)) throw new Error('Invalid profile fields.');
    ref = doc(db, 'shops', profile.shopId, 'appData', 'main');
    if ($('login')) $('login').hidden = true;
    if ($('app')) $('app').hidden = false;
    if ($('logout')) $('logout').hidden = false;
    if ($('who')) $('who').textContent = profile.name || u.email;
    if ($('role')) $('role').textContent = `Signed in as ${profile.role} · Shop ID: ${profile.shopId}`;
    unsub = onSnapshot(ref, (s) => {
      if (s.exists()) {
        const incoming = s.data().data || {};
        d = {
          ...d,
          ...incoming,
          settings: { ...DEFAULT_SETTINGS, ...(incoming.settings || {}) },
          categories: incoming.categories || [...DEFAULT_CATS],
          products: incoming.products || [],
          sales: incoming.sales || [],
          purchases: incoming.purchases || [],
          purchaseOrders: incoming.purchaseOrders || [],
          expenses: incoming.expenses || [],
          attars: incoming.attars || [],
          returns: incoming.returns || [],
          stockTransfers: incoming.stockTransfers || [],
          stockAdjustments: incoming.stockAdjustments || [],
          customers: incoming.customers || [],
          suppliers: incoming.suppliers || [],
          customerPayments: incoming.customerPayments || [],
          supplierPayments: incoming.supplierPayments || [],
          activityLog: incoming.activityLog || []
        };
      } else if (profile.role === 'owner') {
        setDoc(ref, { data: d, updatedAt: serverTimestamp() });
      }
      if ($('cloud')) $('cloud').textContent = 'Cloud connected';
      render();
    }, (e) => toast(e.message, 'error'));
  } catch (e) {
    await signOut(auth);
    if ($('loginError')) $('loginError').textContent = e.message;
  }
});

on('loginForm', 'submit', async (e) => {
  e.preventDefault();
  if ($('loginError')) $('loginError').textContent = '';
  try {
    await signInWithEmailAndPassword(auth, $('email').value, $('password').value);
  } catch (x) {
    if ($('loginError')) $('loginError').textContent = x.message;
  }
});

on('logout', 'click', () => signOut(auth));

$$('nav button').forEach((b) => {
  b.onclick = () => {
    $$('.page').forEach((p) => { p.hidden = true; });
    if ($(b.dataset.page)) $(b.dataset.page).hidden = false;
    $$('nav button').forEach((x) => x.classList.toggle('active', x === b));
    if (b.dataset.page === 'settings') loadCloudBackups();
    render();
  };
});

/* ---------------- Products & Stock Adjustment ---------------- */
function syncProductFields() {
  const kind = $('stockType')?.value || 'normal';
  const unit = $('unit')?.value || 'pcs';
  const looseMl = kind === 'loose' && unit === 'ml';
  if ($('contentMlWrap')) $('contentMlWrap').hidden = kind !== 'packed';
  if ($('price3Wrap')) $('price3Wrap').hidden = !looseMl;
  if ($('price6Wrap')) $('price6Wrap').hidden = !looseMl;
  if ($('price12Wrap')) $('price12Wrap').hidden = !looseMl;
  if ($('genericPriceWrap')) {
    $('genericPriceWrap').hidden = looseMl;
    const inp = $('genericPriceWrap').querySelector('input');
    if (inp) inp.required = !looseMl;
  }
}

on('stockType', 'change', () => {
  if (!$('stockType') || !$('unit')) return;
  if ($('stockType').value === 'loose') $('unit').value = 'ml';
  else if ($('stockType').value === 'packed') $('unit').value = 'pcs';
  syncProductFields();
});
on('unit', 'change', syncProductFields);

function edit(id) {
  const p = d.products.find((x) => x.id === id);
  if (!p) return;
  if ($('modalTitle')) $('modalTitle').textContent = 'Edit product';
  if ($('pid')) $('pid').value = id;
  if ($('pname')) $('pname').value = p.name;
  if ($('pcat')) $('pcat').value = p.category;
  if ($('brand')) $('brand').value = p.brand || '';
  if ($('sku')) $('sku').value = p.sku || '';
  if ($('quality')) $('quality').value = p.quality || '';
  if ($('model')) $('model').value = p.model || '';
  if ($('photoUrl')) $('photoUrl').value = p.photoUrl || '';
  if ($('unit')) $('unit').value = p.unit || 'pcs';
  if ($('stockType')) $('stockType').value = p.stockType || 'normal';
  if ($('contentMl')) $('contentMl').value = p.contentMl || 0;
  if ($('price3')) $('price3').value = p.price3 || 0;
  if ($('price6')) $('price6').value = p.price6 || 0;
  if ($('price12')) $('price12').value = p.price12 || 0;
  if ($('stock')) $('stock').value = p.stock;
  if ($('pReorder')) $('pReorder').value = p.reorder;
  if ($('cost')) $('cost').value = p.cost;
  if ($('price')) $('price').value = p.price;
  if ($('notes')) $('notes').value = p.notes || '';
  syncProductFields();
  if ($('modal')) $('modal').hidden = false;
}

on('newProduct', 'click', () => {
  if ($('productForm')) $('productForm').reset();
  if ($('pid')) $('pid').value = '';
  if ($('modalTitle')) $('modalTitle').textContent = 'Add product';
  if ($('pReorder')) $('pReorder').value = d.settings.reorder ?? 5;
  if ($('stockType')) $('stockType').value = 'normal';
  if ($('contentMl')) $('contentMl').value = 0;
  if ($('price3')) $('price3').value = 0;
  if ($('price6')) $('price6').value = 0;
  if ($('price12')) $('price12').value = 0;
  syncProductFields();
  if ($('modal')) $('modal').hidden = false;
});

on('close', 'click', () => { if ($('modal')) $('modal').hidden = true; });

on('productForm', 'submit', (e) => {
  e.preventDefault();
  const id = $('pid').value || uid();
  const old = d.products.find((p) => p.id === id);
  const kind = $('stockType')?.value || 'normal';
  const unit = $('unit')?.value || 'pcs';
  if (kind === 'loose' && !['ml', 'gram'].includes(unit)) return toast('Loose attar unit ml ya gram hona chahiye', 'error');
  if (kind === 'packed' && unit !== 'pcs') return toast('Packed attar unit pieces hona chahiye', 'error');
  if (kind === 'loose' && unit === 'ml' && (!(+$('price3').value > 0) || !(+$('price6').value > 0) || !(+$('price12').value > 0))) {
    return toast('3 ml, 6 ml aur 12 ml teeno rates daalo', 'error');
  }
  if (kind === 'packed' && !(+$('contentMl').value > 0)) return toast('Packed piece ka ml daalo', 'error');

  const photoVal = $('photoUrl').value || '';
  const gallery = [...(old?.gallery || [])];
  if (photoVal && !gallery.some((g) => (typeof g === 'string' ? g : g.src) === photoVal)) {
    gallery.unshift({ type: 'image', src: photoVal });
  }

  const p = {
    id,
    name: $('pname').value.trim(),
    category: $('pcat').value,
    brand: $('brand').value,
    sku: $('sku').value.trim() || (old?.sku || makeSku($('pcat').value)),
    quality: $('quality').value || '',
    model: $('model').value || '',
    photoUrl: photoVal,
    gallery,
    unit,
    stockType: kind,
    contentMl: +$('contentMl').value || 0,
    price3: +$('price3').value || 0,
    price6: +$('price6').value || 0,
    price12: +$('price12').value || 0,
    stock: +$('stock').value,
    reorder: +$('pReorder').value,
    cost: +$('cost').value,
    price: kind === 'loose' && unit === 'ml' ? (+$('price12').value || 0) : +$('price').value,
    notes: $('notes').value
  };
  if (old && p.stock !== old.stock && !confirm('Save direct stock adjustment?')) return;
  if (old) {
    d.products = d.products.map((x) => (x.id === id ? p : x));
    logActivity('product', `Product updated: ${p.name} (${p.sku})`);
  } else {
    d.products.push(p);
    logActivity('product', `Product added: ${p.name} (${p.sku})`);
  }
  if ($('modal')) $('modal').hidden = true;
  changed();
  toast('Product saved');
});

on('newCategory', 'click', () => {
  const c = prompt('New category name');
  if (c?.trim() && !cats().some((x) => x.toLowerCase() === c.trim().toLowerCase())) {
    d.categories.push(c.trim());
    changed();
  }
});

on('search', 'input', render);
on('catFilter', 'change', render);

on('stockAdjustmentForm', 'submit', (e) => {
  e.preventDefault();
  const p = d.products.find((x) => x.id === $('adjustProduct')?.value);
  const type = $('adjustType')?.value || 'add';
  const qty = +$('adjustQty')?.value || 0;
  const reason = ($('adjustReason')?.value || '').trim();
  if (!p || qty <= 0) return toast('Product aur valid quantity chuno', 'error');
  const before = +p.stock || 0;
  let after = before;
  if (type === 'add') after = before + qty;
  else if (type === 'remove') after = Math.max(0, before - qty);
  else if (type === 'set') after = qty;
  p.stock = +after.toFixed(3);
  d.stockAdjustments = d.stockAdjustments || [];
  d.stockAdjustments.push({ id: uid(), productId: p.id, name: p.name, type, qty, before, after: p.stock, unit: p.unit, reason, date: today() });
  logActivity('stock', `Stock ${type}: ${p.name} (${before} → ${p.stock} ${p.unit}) · ${reason}`);
  e.target.reset();
  changed();
  toast('Stock adjusted');
});

/* ---------------- Sales & Billing ---------------- */
on('saleProduct', 'change', () => {
  const p = d.products.find((x) => x.id === $('saleProduct')?.value);
  if (!p) return;
  if ($('saleUnit')) $('saleUnit').innerHTML = `<option value="${esc(p.unit)}">${esc(p.stockType === 'loose' ? 'ml (3 / 6 / 12)' : p.unit)}</option>`;
  if ($('saleQty')) {
    $('saleQty').step = p.stockType === 'loose' ? '3' : '1';
    $('saleQty').min = p.stockType === 'loose' ? '3' : '1';
    $('saleQty').value = p.stockType === 'loose' ? '3' : '1';
  }
});

on('addLine', 'click', () => {
  const p = d.products.find((x) => x.id === $('saleProduct')?.value);
  const qty = +$('saleQty')?.value || 0;
  if (!p || qty <= 0) return toast('Product aur valid quantity chuno', 'error');
  let price, amount, unit;
  if (p.stockType === 'loose') {
    if (![3, 6, 12].includes(qty)) return toast('Loose attar sirf 3, 6 ya 12 ml mein sell hota hai', 'error');
    if (p.unit !== 'ml') return toast('Loose attar unit ml hona chahiye', 'error');
    if (qty > p.stock) return toast('Stock kam hai', 'error');
    price = qty === 3 ? p.price3 : qty === 6 ? p.price6 : p.price12;
    if (!(price > 0)) return toast('Product Edit mein is ml size ka rate set karo', 'error');
    amount = price;
    unit = 'ml';
  } else {
    unit = $('saleUnit')?.value || p.unit;
    if (unit !== p.unit) return toast('Unit match nahi kar raha: ' + p.unit, 'error');
    if (qty > p.stock) return toast('Insufficient stock', 'error');
    price = p.price;
    amount = qty * price;
  }
  cart.push({ id: p.id, name: p.name, qty, unit, price, amount, cost: p.cost, stockType: p.stockType });
  renderCart();
});

function totals() {
  const sub = cart.reduce((a, x) => a + (x.amount ?? x.qty * x.price), 0);
  const v = +$('discount')?.value || 0;
  const off = $('discountType')?.value === 'percent' ? (sub * Math.min(100, v)) / 100 : Math.min(sub, v);
  return { sub, off, total: sub - off };
}

function renderCart() {
  const t = totals();
  if ($('cart')) {
    $('cart').innerHTML = cart.map((x, i) =>
      `<div class="line">${esc(x.name)} · ${x.qty} ${x.unit} <b>${money(x.amount ?? x.qty * x.price)} <button type="button" data-rm="${i}">×</button></b></div>`
    ).join('') || '<p class="muted">No items added.</p>';
    $$('[data-rm]').forEach((b) => {
      b.onclick = () => { cart.splice(+b.dataset.rm, 1); renderCart(); };
    });
  }
  if ($('subtotal')) $('subtotal').textContent = money(t.sub);
  if ($('discountOut')) $('discountOut').textContent = money(t.off);
  if ($('total')) $('total').textContent = money(t.total);
}

on('discount', 'input', renderCart);
on('discountType', 'change', renderCart);
on('payMode', 'change', () => {
  if ($('splitPayment')) $('splitPayment').hidden = $('payMode')?.value !== 'Split';
});
on('clear', 'click', () => { cart = []; renderCart(); });

on('finish', 'click', () => {
  if (!cart.length) return toast('Pehle items add karo', 'error');
  const mode = $('payMode')?.value || 'Cash';
  const custName = ($('customer')?.value || '').trim();
  if (mode === 'Credit' && !custName) return toast('Credit bill ke liye Customer naam zaroori hai', 'error');
  if (mode === 'Split' && Math.abs((+$('splitCash')?.value || 0) + (+$('splitOther')?.value || 0) - totals().total) > 0.009) {
    return toast('Split payment total ke barabar hona chahiye', 'error');
  }
  for (const l of cart) {
    const p = d.products.find((x) => x.id === l.id);
    if (!p || p.stock < l.qty) return toast('Stock badal gaya hai; bill check karo', 'error');
  }
  const t = totals();
  if (custName && !(d.customers || []).some((c) => c.name.toLowerCase() === custName.toLowerCase())) {
    d.customers = d.customers || [];
    d.customers.push({ id: uid(), name: custName, mobile: '', address: '', notes: 'Auto-added from bill' });
  }
  const s = {
    id: uid(),
    billNo: 'NP-' + Date.now().toString().slice(-8),
    date: today(),
    customer: custName,
    mode,
    paymentBreakdown: mode === 'Split' ? { cash: +$('splitCash')?.value || 0, other: +$('splitOther')?.value || 0 } : null,
    lines: cart.map((x) => ({ ...x })),
    subtotal: t.sub,
    discount: t.off,
    total: t.total
  };
  cart.forEach((l) => {
    const p = d.products.find((x) => x.id === l.id);
    if (p) p.stock = +(p.stock - l.qty).toFixed(3);
  });
  d.sales.push(s);
  logActivity('sale', `Sale ${s.billNo} (${s.customer || 'Walk-in'}) · ${money(s.total)} [${s.mode}]`);
  cart = [];
  if ($('discount')) $('discount').value = '0';
  if ($('splitCash')) $('splitCash').value = '0';
  if ($('splitOther')) $('splitOther').value = '0';
  changed();
  printBill(s);
  toast('Sale saved');
});

function printBill(s) {
  const w = open('', '_blank', 'width=480,height=760');
  if (!w) return toast('Bill print ke liye pop-ups allow karo', 'error');
  const storeName = d.settings.storeName || 'NOORI PERFUME';
  w.document.write(`<html><head><title>${esc(storeName)} Bill</title><style>body{font:14px Arial;color:#302345;padding:20px}h1{text-align:center;color:#6840a0;margin:0}small{display:block;text-align:center;color:#9a4b86;margin:4px}hr{border:0;border-top:1px dashed #987}table{width:100%;border-collapse:collapse}td{padding:8px 2px;border-bottom:1px solid #eee}td:last-child{text-align:right}.total{font-size:22px;color:#6b3b9c;font-weight:bold;text-align:right}</style></head><body><h1>${esc(storeName)}</h1><small>FRAGRANCE • ATTAR • PERFUMES</small><center>${esc(d.settings.address || '')}<br>${esc(d.settings.phone || '')}</center><hr>Bill ${esc(s.billNo)} · ${esc(s.date)}<br>Customer: ${esc(s.customer || 'Walk-in')} · Mode: ${esc(s.mode)}<hr><table>${(s.lines || []).map((x) => `<tr><td>${esc(x.name)}<br><small>${x.qty} ${x.unit} × ${money(x.price)}</small></td><td>${money(x.amount ?? x.qty * x.price)}</td></tr>`).join('')}</table><hr>Subtotal: ${money(s.subtotal)}<br>Discount: ${money(s.discount)}<div class="total">TOTAL ${money(s.total)}</div><hr><center>Thank you for shopping with ${esc(storeName)}</center><script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
}

function printSettlementReceipt(kind, partyName, amount, mode, note, remainingDue) {
  const w = open('', '_blank', 'width=460,height=640');
  if (!w) return toast('Receipt print ke liye pop-ups allow karo', 'error');
  const storeName = d.settings.storeName || 'NOORI PERFUME';
  const title = kind === 'customer' ? 'CUSTOMER PAYMENT RECEIPT' : 'SUPPLIER PAYMENT VOUCHER';
  const partyLabel = kind === 'customer' ? 'Customer' : 'Supplier';
  w.document.write(`<html><head><title>${esc(title)}</title><style>body{font:14px Arial;color:#2b223a;padding:22px}h2{text-align:center;color:#6840a0;margin:0}small{display:block;text-align:center;color:#7a6796;margin:4px 0 12px}hr{border:0;border-top:1px dashed #999}.row{display:flex;justify-content:space-between;margin:10px 0}.amt{font-size:20px;font-weight:bold;color:#6840a0}</style></head><body><h2>${esc(storeName)}</h2><small>${esc(title)} · ${esc(today())}</small><hr><div class="row"><span>${esc(partyLabel)}:</span><b>${esc(partyName)}</b></div><div class="row"><span>Mode:</span><span>${esc(mode || 'Cash')}</span></div><div class="row"><span>Note:</span><span>${esc(note || 'Due settlement')}</span></div><hr><div class="row amt"><span>Paid Amount:</span><span>${money(amount)}</span></div><div class="row"><span>Remaining Due:</span><b>${money(remainingDue)}</b></div><hr><small>Saved in ${esc(storeName)}</small><script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
}

/* ---------------- Tally-Style Purchase Order + Per-Unit Rate + Previous Rate Memory ---------------- */
function getLastPurchaseForProduct(p) {
  if (!p) return null;
  const prev = [...(d.purchases || [])].reverse().find((x) => x.productId === p.id || x.name === p.name);
  if (prev) {
    const rate = +(prev.cost ?? ((prev.totalCost || 0) / (prev.qty || 1))) || 0;
    const lastAmt = +(prev.totalCost ?? (rate * (prev.qty || 0))) || 0;
    return { rate, qty: prev.qty, lastAmt, date: prev.date || '', supplier: prev.supplier || '' };
  }
  const prevPo = [...(d.purchaseOrders || [])].reverse().flatMap((o) => (o.lines || []).map((l) => ({ ...l, date: o.date, supplier: o.supplier })))
    .find((l) => l.productId === p.id || l.name === p.name);
  if (prevPo) {
    return { rate: +prevPo.rate || 0, qty: prevPo.qty, lastAmt: +prevPo.amount || 0, date: prevPo.date || '', supplier: prevPo.supplier || '' };
  }
  if (+p.cost > 0) {
    return { rate: +p.cost, qty: 0, lastAmt: 0, date: '', supplier: '' };
  }
  return null;
}

function ensurePurchaseUpgradesUI() {
  const form = $('purchaseForm');
  if (!form) return;

  const costInput = $('purchaseCost');
  const costLabel = costInput?.closest('label');
  if (costLabel) {
    const firstNode = Array.from(costLabel.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (firstNode) firstNode.textContent = 'Rate per Unit (₹) ';
  }
  if (costInput) costInput.required = false;
  if ($('purchaseQty')) $('purchaseQty').required = false;

  if (!$('purchaseUpgradeBox')) {
    const submitBtn = form.querySelector('button[type="submit"]');
    const box = document.createElement('div');
    box.id = 'purchaseUpgradeBox';
    box.style.marginTop = '8px';
    box.innerHTML = `
      <div id="purchaseLastRateInfo" class="muted" style="margin:4px 0 8px;font-size:13px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <label>PO / Voucher No. (Tally Order)
          <input type="text" id="purchasePoNo" placeholder="PO-${today().replaceAll('-', '')}-01">
        </label>
        <label>Calculated Total (₹)
          <input type="number" id="purchaseLineTotal" min="0" step="0.01" placeholder="Auto: Rate × Qty">
        </label>
      </div>
      <div class="actions" style="margin-bottom:10px">
        <button type="button" class="alt" id="addPurchaseLine">+ Add Item to Order</button>
        <button type="button" class="alt" id="savePurchaseOrderBtn">Save as Purchase Order (PO)</button>
        <button type="button" class="alt" id="clearPurchaseCart">Clear</button>
      </div>
      <div id="purchaseCartBox" style="border:1px dashed #c8bce0;border-radius:10px;padding:10px;margin-bottom:10px;background:#faf8ff">
        <div id="purchaseCartRows"><p class="muted" style="margin:0">Rate × Qty se item add karo; pehle Purchase Order banao ya seedha Purchase Bill save karo.</p></div>
        <div id="purchaseCartTotal" style="margin-top:8px;font-weight:bold;color:#6840a0"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <label>Bill Payment Mode
          <select id="purchasePayMode">
            <option value="Cash">Cash (Paid Full)</option>
            <option value="UPI">UPI (Paid Full)</option>
            <option value="Bank">Bank Transfer (Paid Full)</option>
            <option value="Credit">Credit (Add to Supplier Due)</option>
            <option value="Partial">Partial Payment</option>
          </select>
        </label>
        <label id="purchasePaidWrap" hidden>Paid Now (₹)
          <input type="number" id="purchasePaidNow" min="0" step="0.01" value="0">
        </label>
      </div>
    `;
    if (submitBtn) {
      submitBtn.textContent = 'Save Purchase Bill (Stock In)';
      form.insertBefore(box, submitBtn);
    } else {
      form.appendChild(box);
    }

    if ($('purchasePoNo') && !$('purchasePoNo').value) {
      $('purchasePoNo').value = 'PO-' + String((d.purchaseOrders?.length || 0) + 1).padStart(4, '0');
    }

    on('purchasePayMode', 'change', () => {
      const mode = $('purchasePayMode')?.value || 'Cash';
      if ($('purchasePaidWrap')) $('purchasePaidWrap').hidden = mode !== 'Partial';
    });

    on('purchaseQty', 'input', () => {
      if (syncingPurchaseMath) return;
      syncingPurchaseMath = true;
      const qty = +$('purchaseQty')?.value || 0;
      const rate = +$('purchaseCost')?.value || 0;
      if ($('purchaseLineTotal')) $('purchaseLineTotal').value = qty > 0 && rate >= 0 ? +(qty * rate).toFixed(2) : '';
      syncingPurchaseMath = false;
      updatePurchaseLivePreview();
    });

    on('purchaseCost', 'input', () => {
      if (syncingPurchaseMath) return;
      syncingPurchaseMath = true;
      const qty = +$('purchaseQty')?.value || 0;
      const rate = +$('purchaseCost')?.value || 0;
      if ($('purchaseLineTotal')) $('purchaseLineTotal').value = qty > 0 && rate >= 0 ? +(qty * rate).toFixed(2) : '';
      syncingPurchaseMath = false;
      updatePurchaseLivePreview();
    });

    on('purchaseLineTotal', 'input', () => {
      if (syncingPurchaseMath) return;
      syncingPurchaseMath = true;
      const qty = +$('purchaseQty')?.value || 0;
      const tot = +$('purchaseLineTotal')?.value || 0;
      if (qty > 0 && $('purchaseCost')) $('purchaseCost').value = +(tot / qty).toFixed(4);
      syncingPurchaseMath = false;
      updatePurchaseLivePreview();
    });

    on('addPurchaseLine', 'click', () => {
      const line = readCurrentPurchaseLine();
      if (!line) return;
      purchaseCart.push(line);
      if ($('purchaseQty')) $('purchaseQty').value = '';
      if ($('purchaseLineTotal')) $('purchaseLineTotal').value = '';
      updatePurchaseLivePreview();
      renderPurchaseCart();
      toast(`${line.name} added to order`);
    });

    on('savePurchaseOrderBtn', 'click', () => {
      saveCurrentPurchaseOrder();
    });

    on('clearPurchaseCart', 'click', () => {
      purchaseCart = [];
      renderPurchaseCart();
    });
  }

  if ($('purchaseRows') && !$('purchaseOrderBox')) {
    const poBox = document.createElement('div');
    poBox.id = 'purchaseOrderBox';
    poBox.style.marginBottom = '14px';
    poBox.innerHTML = `<h4 style="margin:0 0 6px;color:#6840a0">Purchase Orders (Tally Order Queue)</h4><div id="purchaseOrderRows"></div><hr style="margin:12px 0"><h4 style="margin:0 0 6px;color:#6840a0">Saved Purchase Bills</h4>`;
    $('purchaseRows').parentNode.insertBefore(poBox, $('purchaseRows'));
  }
}

function readCurrentPurchaseLine() {
  const p = d.products.find((x) => x.id === $('purchaseProduct')?.value);
  const qty = +$('purchaseQty')?.value || 0;
  let rate = +$('purchaseCost')?.value || 0;
  let totalCost = +$('purchaseLineTotal')?.value || 0;
  if (!p || qty <= 0) {
    toast('Product aur Quantity (0 se zyada) daalo', 'error');
    return null;
  }
  if (rate <= 0 && totalCost > 0) rate = totalCost / qty;
  if (totalCost <= 0 && rate > 0) totalCost = qty * rate;
  if (rate <= 0 || totalCost <= 0) {
    toast('1 unit ka Rate (ya Total) 0 se zyada daalo', 'error');
    return null;
  }
  return {
    productId: p.id,
    name: p.name,
    qty,
    unit: p.unit,
    rate: +rate.toFixed(4),
    totalCost: +totalCost.toFixed(2)
  };
}

function autofillPreviousRateForSelectedProduct(force = false) {
  const p = d.products.find((x) => x.id === $('purchaseProduct')?.value);
  const infoEl = $('purchaseLastRateInfo');
  if (!p) { if (infoEl) infoEl.textContent = ''; return; }
  const prev = getLastPurchaseForProduct(p);
  if (prev && prev.rate > 0) {
    if ($('purchaseCost') && (force || !+$('purchaseCost').value)) {
      $('purchaseCost').value = +prev.rate.toFixed(2);
    }
    if (infoEl) {
      infoEl.innerHTML = `Pichla Rate: <b>${money(prev.rate)} / ${esc(p.unit)}</b>` +
        (prev.qty ? ` (Pichli bar: ${prev.qty} ${esc(p.unit)} = <b>${money(prev.lastAmt)}</b>${prev.date ? ' · ' + esc(prev.date) : ''}${prev.supplier ? ' · ' + esc(prev.supplier) : ''})` : '') +
        ` · Current Stock: <b>${p.stock} ${esc(p.unit)}</b>`;
    }
  } else if (infoEl) {
    infoEl.innerHTML = `Pichla purchase record nahi hai · Current Stock: <b>${p.stock} ${esc(p.unit)}</b>`;
  }
}

function updatePurchaseLivePreview() {
  const p = d.products.find((x) => x.id === $('purchaseProduct')?.value);
  const qty = +$('purchaseQty')?.value || 0;
  let rate = +$('purchaseCost')?.value || 0;
  let total = +$('purchaseLineTotal')?.value || 0;
  if (rate <= 0 && qty > 0 && total > 0) rate = total / qty;
  if (total <= 0 && qty > 0 && rate > 0) total = qty * rate;

  if ($('purchaseLineTotal') && document.activeElement !== $('purchaseLineTotal')) {
    $('purchaseLineTotal').value = qty > 0 && total > 0 ? total.toFixed(2) : '';
  }

  const infoEl = $('purchaseLastRateInfo');
  if (!infoEl || !p) return;
  const prev = getLastPurchaseForProduct(p);
  const prevPart = prev && prev.rate > 0
    ? `Pichla Rate: <b>${money(prev.rate)}/${esc(p.unit)}</b>${prev.lastAmt ? ` (Pichla Bill: ${money(prev.lastAmt)})` : ''} · `
    : '';
  const calcPart = qty > 0 && rate > 0
    ? `Abhi ka Hisab: <b>${qty} ${esc(p.unit)} × ${money(rate)} = ${money(total)}</b>`
    : `Stock: <b>${p.stock} ${esc(p.unit)}</b>`;
  infoEl.innerHTML = prevPart + calcPart;
}

function renderPurchaseCart() {
  const rows = $('purchaseCartRows');
  const totEl = $('purchaseCartTotal');
  if (!rows) return;
  if (!purchaseCart.length) {
    rows.innerHTML = '<p class="muted" style="margin:0">Rate × Qty se item add karo; pehle Purchase Order banao ya seedha Purchase Bill save karo.</p>';
    if (totEl) totEl.textContent = '';
    return;
  }
  const sum = purchaseCart.reduce((a, b) => a + b.totalCost, 0);
  rows.innerHTML = purchaseCart.map((item, i) => `
    <div class="line">
      <span><b>${esc(item.name)}</b> · ${item.qty} ${esc(item.unit)} × ${money(item.rate)}/${esc(item.unit)}</span>
      <span><b>${money(item.totalCost)}</b> <button type="button" class="alt tiny" data-prm-cart="${i}">×</button></span>
    </div>
  `).join('');
  if (totEl) totEl.textContent = `Order Items: ${purchaseCart.length} · Order Total: ${money(sum)}`;
  $$('[data-prm-cart]').forEach((b) => {
    b.onclick = () => {
      purchaseCart.splice(+b.dataset.prmCart, 1);
      renderPurchaseCart();
    };
  });
}

function collectPurchaseLinesOrCurrent() {
  const lines = [...purchaseCart];
  const hasCurrentInputs = Boolean(+$('purchaseQty')?.value > 0 || +$('purchaseCost')?.value > 0 || +$('purchaseLineTotal')?.value > 0);
  if (hasCurrentInputs) {
    const line = readCurrentPurchaseLine();
    if (!line) return null;
    lines.push(line);
  }
  if (!lines.length) {
    toast('Kam se kam ek item (Qty + Rate) daalo', 'error');
    return null;
  }
  return lines;
}

function saveCurrentPurchaseOrder() {
  const lines = collectPurchaseLinesOrCurrent();
  if (!lines) return;
  const supplierName = ($('supplier')?.value || '').trim();
  const poNo = ($('purchasePoNo')?.value || '').trim() || ('PO-' + Date.now().toString().slice(-6));
  const totalAmount = +lines.reduce((a, b) => a + b.totalCost, 0).toFixed(2);

  if (supplierName && !(d.suppliers || []).some((s) => s.name.toLowerCase() === supplierName.toLowerCase())) {
    d.suppliers = d.suppliers || [];
    d.suppliers.push({ id: uid(), name: supplierName, mobile: '', address: '', notes: 'Auto-added from PO' });
  }

  d.purchaseOrders = d.purchaseOrders || [];
  d.purchaseOrders.push({
    id: uid(),
    poNo,
    date: today(),
    supplier: supplierName,
    lines,
    totalAmount,
    status: 'Pending'
  });

  logActivity('purchase', `Purchase Order ${poNo}: ${lines.length} item(s) · ${money(totalAmount)}${supplierName ? ' · ' + supplierName : ''}`);
  purchaseCart = [];
  if ($('purchaseQty')) $('purchaseQty').value = '';
  if ($('purchaseLineTotal')) $('purchaseLineTotal').value = '';
  if ($('purchasePoNo')) $('purchasePoNo').value = 'PO-' + String((d.purchaseOrders?.length || 0) + 1).padStart(4, '0');
  renderPurchaseCart();
  changed();
  toast(`Purchase Order ${poNo} saved (${money(totalAmount)})`);
}

function convertPurchaseOrderToBill(poId) {
  const po = (d.purchaseOrders || []).find((x) => x.id === poId);
  if (!po || po.status === 'Received') return;
  const payMode = $('purchasePayMode')?.value || 'Cash';
  const supplierName = (po.supplier || $('supplier')?.value || '').trim();
  const grandTotal = +(po.totalAmount ?? (po.lines || []).reduce((a, b) => a + (+b.totalCost || 0), 0)).toFixed(2);

  if ((payMode === 'Credit' || payMode === 'Partial') && !supplierName) {
    return toast('Credit/Partial bill ke liye Supplier naam chahiye', 'error');
  }

  let paidNow = 0;
  if (payMode === 'Credit') paidNow = 0;
  else if (payMode === 'Partial') {
    paidNow = +$('purchasePaidNow')?.value || 0;
    if (paidNow < 0 || paidNow > grandTotal + 0.009) {
      return toast(`Paid amount 0 se ${money(grandTotal)} ke beech hona chahiye`, 'error');
    }
  } else {
    paidNow = grandTotal;
  }

  let linkedPaymentId = null;
  if (supplierName && paidNow > 0) {
    linkedPaymentId = uid();
    d.supplierPayments = d.supplierPayments || [];
    d.supplierPayments.push({
      id: linkedPaymentId,
      supplier: supplierName,
      amount: +paidNow.toFixed(2),
      mode: payMode === 'Partial' ? 'Cash' : payMode,
      note: `Paid against ${po.poNo}`,
      date: today()
    });
  }

  const batchNo = 'PUR-' + Date.now().toString().slice(-6);
  (po.lines || []).forEach((line) => {
    const p = d.products.find((x) => x.id === line.productId || x.name === line.name);
    if (!p) return;
    const oldQty = +p.stock || 0;
    const oldCost = +p.cost || 0;
    const lineRate = +(line.rate ?? ((line.totalCost || 0) / (line.qty || 1))) || 0;
    const lineTot = +(line.totalCost ?? (lineRate * (line.qty || 0))) || 0;
    p.stock = +(oldQty + (+line.qty || 0)).toFixed(3);
    p.cost = oldQty + (+line.qty || 0) > 0
      ? +(((oldQty * oldCost) + lineTot) / (oldQty + (+line.qty || 0))).toFixed(4)
      : lineRate;

    d.purchases.push({
      id: uid(),
      batchNo,
      poNo: po.poNo,
      productId: p.id,
      name: p.name,
      qty: +line.qty || 0,
      unit: line.unit || p.unit,
      cost: lineRate,
      totalCost: lineTot,
      supplier: supplierName,
      payMode,
      paymentId: linkedPaymentId,
      date: today()
    });
  });

  po.status = 'Received';
  logActivity('purchase', `${po.poNo} converted to Purchase Bill ${batchNo} (${money(grandTotal)})`);
  changed();
  toast(`${po.poNo} ka maal stock mein chadh gaya!`);
}

on('purchaseProduct', 'change', () => {
  const p = d.products.find((x) => x.id === $('purchaseProduct')?.value);
  if (p && $('purchaseUnit')) {
    $('purchaseUnit').innerHTML = `<option value="${esc(p.unit)}">${esc(p.unit)}</option>`;
    if ($('purchaseUnitHelp')) $('purchaseUnitHelp').textContent = `Purchased in ${p.unit}. 1 ${p.unit} ka Rate daalo; Total = Rate × Qty auto banega.`;
  }
  autofillPreviousRateForSelectedProduct(true);
  if ($('purchaseQty') && $('purchaseCost') && +$('purchaseQty').value > 0 && +$('purchaseCost').value >= 0 && $('purchaseLineTotal')) {
    $('purchaseLineTotal').value = (+$('purchaseQty').value * +$('purchaseCost').value).toFixed(2);
  }
  updatePurchaseLivePreview();
});

on('purchaseNewProduct', 'click', () => { if ($('newProduct')) $('newProduct').click(); });

function deletePurchaseEntry(purchaseId) {
  const item = (d.purchases || []).find((x) => x.id === purchaseId);
  if (!item) return;
  if (!confirm(`Delete purchase "${item.name} (${item.qty} ${item.unit})"? Stock aur supplier hisab reverse ho jayega.`)) return;
  const p = d.products.find((x) => x.id === item.productId || x.name === item.name);
  if (p) {
    p.stock = Math.max(0, +((+p.stock || 0) - (+item.qty || 0)).toFixed(3));
  }
  if (item.paymentId) {
    d.supplierPayments = (d.supplierPayments || []).filter((sp) => sp.id !== item.paymentId);
  }
  d.purchases = (d.purchases || []).filter((x) => x.id !== purchaseId);
  logActivity('purchase', `Purchase deleted: ${item.name} (${item.qty} ${item.unit})`);
  changed();
  toast('Purchase deleted & stock adjusted');
}

function deleteReturnEntry(returnId, fallbackIndex = -1) {
  const list = d.returns || [];
  const idx = returnId ? list.findIndex((x) => x.id === returnId) : fallbackIndex;
  if (idx < 0 || !list[idx]) return;
  const item = list[idx];
  if (!confirm(`Delete return entry "${item.productName} (${item.qty} ${item.unit})"? Stock wapas ghatega.`)) return;
  const sale = d.sales.find((s) => s.id === item.saleId || s.billNo === item.billNo);
  const line = sale?.lines?.[item.lineIndex];
  const product = d.products.find((p) => p.id === (item.productId || line?.id) || p.name === item.productName);
  if (product && +item.qty > 0) {
    product.stock = Math.max(0, +((+product.stock || 0) - (+item.qty || 0)).toFixed(3));
  }
  d.returns = list.filter((_, i) => i !== idx);
  logActivity('sale', `Return deleted: ${item.productName} (${item.qty} ${item.unit}) on ${item.billNo || ''}`);
  changed();
  toast('Return entry deleted & stock updated');
}

on('purchaseForm', 'submit', (e) => {
  e.preventDefault();
  ensurePurchaseUpgradesUI();

  const lines = collectPurchaseLinesOrCurrent();
  if (!lines) return;

  const supplierName = ($('supplier')?.value || '').trim();
  const poNo = ($('purchasePoNo')?.value || '').trim() || ('PO-' + String((d.purchaseOrders?.length || 0) + 1).padStart(4, '0'));
  const payMode = $('purchasePayMode')?.value || 'Cash';
  const grandTotal = +lines.reduce((a, b) => a + b.totalCost, 0).toFixed(2);
  let paidNow = 0;

  if (payMode === 'Credit') {
    if (!supplierName) return toast('Credit purchase ke liye Supplier naam zaroori hai', 'error');
    paidNow = 0;
  } else if (payMode === 'Partial') {
    if (!supplierName) return toast('Partial payment ke liye Supplier naam zaroori hai', 'error');
    paidNow = +$('purchasePaidNow')?.value || 0;
    if (paidNow < 0 || paidNow > grandTotal + 0.009) {
      return toast(`Paid amount 0 se ${money(grandTotal)} ke beech hona chahiye`, 'error');
    }
  } else {
    paidNow = grandTotal;
  }

  if (supplierName && !(d.suppliers || []).some((s) => s.name.toLowerCase() === supplierName.toLowerCase())) {
    d.suppliers = d.suppliers || [];
    d.suppliers.push({ id: uid(), name: supplierName, mobile: '', address: '', notes: 'Auto-added from purchase' });
  }

  let linkedPaymentId = null;
  if (supplierName && paidNow > 0) {
    linkedPaymentId = uid();
    d.supplierPayments = d.supplierPayments || [];
    d.supplierPayments.push({
      id: linkedPaymentId,
      supplier: supplierName,
      amount: +paidNow.toFixed(2),
      mode: payMode === 'Partial' ? 'Cash' : payMode,
      note: `Paid with purchase ${poNo} (${lines.length} item${lines.length > 1 ? 's' : ''})`,
      date: today()
    });
  }

  const batchNo = 'PUR-' + Date.now().toString().slice(-6);
  lines.forEach((line) => {
    const p = d.products.find((x) => x.id === line.productId);
    if (!p) return;
    const oldQty = +p.stock || 0;
    const oldCost = +p.cost || 0;
    p.stock = +(oldQty + line.qty).toFixed(3);
    p.cost = oldQty + line.qty > 0
      ? +(((oldQty * oldCost) + line.totalCost) / (oldQty + line.qty)).toFixed(4)
      : line.rate;

    d.purchases.push({
      id: uid(),
      batchNo,
      poNo,
      productId: p.id,
      name: p.name,
      qty: line.qty,
      unit: line.unit,
      cost: line.rate,
      totalCost: line.totalCost,
      supplier: supplierName,
      payMode,
      paymentId: linkedPaymentId,
      date: today()
    });
  });

  logActivity('purchase', `Purchase ${batchNo} (${poNo}): ${lines.length} item(s) · ${money(grandTotal)} [${payMode}]${supplierName ? ' · ' + supplierName : ''}`);
  purchaseCart = [];
  e.target.reset();
  if ($('purchasePayMode')) $('purchasePayMode').value = 'Cash';
  if ($('purchasePaidWrap')) $('purchasePaidWrap').hidden = true;
  if ($('purchasePoNo')) $('purchasePoNo').value = 'PO-' + String((d.purchaseOrders?.length || 0) + 1).padStart(4, '0');
  renderPurchaseCart();
  changed();
  toast(payMode === 'Credit'
    ? `Purchase saved · ${money(grandTotal)} added to ${supplierName} due`
    : payMode === 'Partial'
      ? `Purchase saved · Paid ${money(paidNow)}, Due ${money(grandTotal - paidNow)}`
      : `Purchase saved (${lines.length} item${lines.length > 1 ? 's' : ''})`);
});

on('transferProduct', 'change', () => {
  const p = d.products.find((x) => x.id === $('transferProduct')?.value);
  if (p?.contentMl && $('transferMl')) $('transferMl').value = p.contentMl;
});

on('transferForm', 'submit', (e) => {
  e.preventDefault();
  const src = d.products.find((p) => p.id === $('transferProduct')?.value);
  const dst = d.products.find((p) => p.id === $('transferTarget')?.value);
  const pieces = +$('transferPieces')?.value || 0;
  const ml = (+$('transferMl')?.value) || (+src?.contentMl || 0);
  if (!src || !dst || src.stockType !== 'packed' || dst.stockType !== 'loose' || pieces <= 0 || ml <= 0) {
    return toast('Packed aur loose attar products chuno', 'error');
  }
  if (src.stock < pieces) return toast('Packed pieces kam hain', 'error');
  const total = pieces * ml;
  const oldLoose = +dst.stock || 0;
  const derivedCost = (+src.cost || 0) / ml;
  src.stock = +(src.stock - pieces).toFixed(3);
  dst.cost = (oldLoose + total) > 0 ? ((oldLoose * (+dst.cost || 0)) + (total * derivedCost)) / (oldLoose + total) : derivedCost;
  dst.stock = +(oldLoose + total).toFixed(3);
  d.stockTransfers = d.stockTransfers || [];
  d.stockTransfers.push({ id: uid(), from: src.id, to: dst.id, pieces, mlEach: ml, totalMl: total, derivedCostPerMl: derivedCost, date: today() });
  logActivity('stock', `Transferred ${pieces} pcs ${src.name} → ${total} ml ${dst.name}`);
  changed();
  toast(`${pieces} pieces converted to ${total} ml loose stock`);
});

/* ---------------- Customers & Suppliers Due + Settlement ---------------- */
function getCustomerBalances() {
  const map = {};
  (d.customers || []).forEach((c) => {
    map[c.name] = { name: c.name, mobile: c.mobile || '', sales: 0, credit: 0, paid: 0, due: 0 };
  });
  (d.sales || []).forEach((s) => {
    const n = (s.customer || '').trim();
    if (!n) return;
    if (!map[n]) map[n] = { name: n, mobile: '', sales: 0, credit: 0, paid: 0, due: 0 };
    const amt = +s.total || 0;
    map[n].sales += amt;
    if (s.mode === 'Credit') map[n].credit += amt;
  });
  (d.customerPayments || []).forEach((p) => {
    const n = (p.customer || '').trim();
    if (!n) return;
    if (!map[n]) map[n] = { name: n, mobile: '', sales: 0, credit: 0, paid: 0, due: 0 };
    map[n].paid += +p.amount || 0;
  });
  return Object.values(map)
    .map((x) => ({
      ...x,
      sales: +x.sales.toFixed(2),
      credit: +x.credit.toFixed(2),
      paid: +x.paid.toFixed(2),
      due: Math.max(0, +(x.credit - x.paid).toFixed(2))
    }))
    .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
}

function getSupplierBalances() {
  const map = {};
  (d.suppliers || []).forEach((s) => {
    map[s.name] = { name: s.name, mobile: s.mobile || '', purchased: 0, paid: 0, due: 0 };
  });
  (d.purchases || []).forEach((p) => {
    const n = (p.supplier || '').trim();
    if (!n) return;
    if (!map[n]) map[n] = { name: n, mobile: '', purchased: 0, paid: 0, due: 0 };
    map[n].purchased += +(p.totalCost ?? p.qty * p.cost) || 0;
  });
  (d.supplierPayments || []).forEach((p) => {
    const n = (p.supplier || '').trim();
    if (!n) return;
    if (!map[n]) map[n] = { name: n, mobile: '', purchased: 0, paid: 0, due: 0 };
    map[n].paid += +p.amount || 0;
  });
  return Object.values(map)
    .map((x) => ({
      ...x,
      purchased: +x.purchased.toFixed(2),
      paid: +x.paid.toFixed(2),
      due: Math.max(0, +(x.purchased - x.paid).toFixed(2))
    }))
    .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
}

function settleCustomerPayment(customer, amount, mode = 'Cash', note = '', printSlip = false) {
  const cleanName = String(customer || '').trim();
  const amt = +amount || 0;
  if (!cleanName || amt <= 0) return toast('Customer aur valid payment amount chuno', 'error');
  const current = getCustomerBalances().find((c) => c.name === cleanName);
  const maxDue = current?.due ?? 0;
  if (maxDue > 0 && amt > maxDue + 0.009) {
    return toast(`Amount baaki due (${money(maxDue)}) se zyada nahi hona chahiye`, 'error');
  }
  d.customerPayments = d.customerPayments || [];
  d.customerPayments.push({
    id: uid(),
    customer: cleanName,
    amount: +amt.toFixed(2),
    mode: mode || 'Cash',
    note: note || (amt >= maxDue && maxDue > 0 ? 'Full due settled' : 'Partial due payment'),
    date: today()
  });
  logActivity('payment', `Customer payment: ${cleanName} · ${money(amt)} [${mode || 'Cash'}]`);
  changed();
  const after = getCustomerBalances().find((c) => c.name === cleanName)?.due ?? 0;
  toast(`Payment received: ${money(amt)} · Remaining due: ${money(after)}`);
  if (printSlip) printSettlementReceipt('customer', cleanName, amt, mode, note, after);
}

function settleSupplierPayment(supplier, amount, mode = 'Cash', note = '', printSlip = false) {
  const cleanName = String(supplier || '').trim();
  const amt = +amount || 0;
  if (!cleanName || amt <= 0) return toast('Supplier aur valid payment amount chuno', 'error');
  const current = getSupplierBalances().find((s) => s.name === cleanName);
  const maxDue = current?.due ?? 0;
  if (maxDue > 0 && amt > maxDue + 0.009) {
    return toast(`Amount baaki supplier due (${money(maxDue)}) se zyada nahi hona chahiye`, 'error');
  }
  d.supplierPayments = d.supplierPayments || [];
  d.supplierPayments.push({
    id: uid(),
    supplier: cleanName,
    amount: +amt.toFixed(2),
    mode: mode || 'Cash',
    note: note || (amt >= maxDue && maxDue > 0 ? 'Full supplier due settled' : 'Partial supplier payment'),
    date: today()
  });
  logActivity('payment', `Supplier payment: ${cleanName} · ${money(amt)} [${mode || 'Cash'}]`);
  changed();
  const after = getSupplierBalances().find((s) => s.name === cleanName)?.due ?? 0;
  toast(`Supplier payment saved: ${money(amt)} · Remaining due: ${money(after)}`);
  if (printSlip) printSettlementReceipt('supplier', cleanName, amt, mode, note, after);
}

on('customerForm', 'submit', (e) => {
  e.preventDefault();
  const id = $('customerId').value || uid();
  const item = {
    id,
    name: $('customerName').value.trim(),
    mobile: $('customerMobile').value.trim(),
    address: $('customerAddress').value.trim(),
    notes: $('customerNotes').value.trim()
  };
  const exists = (d.customers || []).some((x) => x.id === id);
  d.customers = exists ? d.customers.map((x) => (x.id === id ? item : x)) : [...(d.customers || []), item];
  e.target.reset();
  if ($('customerId')) $('customerId').value = '';
  changed();
  toast('Customer saved');
});

on('customerCancel', 'click', () => {
  if ($('customerForm')) $('customerForm').reset();
  if ($('customerId')) $('customerId').value = '';
});
on('customerSearch', 'input', render);

on('customerPaymentName', 'change', () => {
  const c = getCustomerBalances().find((x) => x.name === $('customerPaymentName')?.value);
  if (c && c.due > 0 && $('customerPaymentAmount') && !+$('customerPaymentAmount').value) {
    $('customerPaymentAmount').value = c.due.toFixed(2);
  }
});

on('customerPaymentForm', 'submit', (e) => {
  e.preventDefault();
  settleCustomerPayment(
    $('customerPaymentName')?.value,
    $('customerPaymentAmount')?.value,
    $('customerPaymentMode')?.value || 'Cash',
    $('customerPaymentNote')?.value || '',
    true
  );
  e.target.reset();
});

on('supplierForm', 'submit', (e) => {
  e.preventDefault();
  const id = $('supplierId').value || uid();
  const item = {
    id,
    name: $('supplierName').value.trim(),
    mobile: $('supplierMobile').value.trim(),
    address: $('supplierAddress').value.trim(),
    notes: $('supplierNotes').value.trim()
  };
  const exists = (d.suppliers || []).some((x) => x.id === id);
  d.suppliers = exists ? d.suppliers.map((x) => (x.id === id ? item : x)) : [...(d.suppliers || []), item];
  e.target.reset();
  if ($('supplierId')) $('supplierId').value = '';
  changed();
  toast('Supplier saved');
});

on('supplierCancel', 'click', () => {
  if ($('supplierForm')) $('supplierForm').reset();
  if ($('supplierId')) $('supplierId').value = '';
});
on('supplierSearch', 'input', render);

on('supplierPaymentName', 'change', () => {
  const s = getSupplierBalances().find((x) => x.name === $('supplierPaymentName')?.value);
  if (s && s.due > 0 && $('supplierPaymentAmount') && !+$('supplierPaymentAmount').value) {
    $('supplierPaymentAmount').value = s.due.toFixed(2);
  }
});

on('supplierPaymentForm', 'submit', (e) => {
  e.preventDefault();
  settleSupplierPayment(
    $('supplierPaymentName')?.value,
    $('supplierPaymentAmount')?.value,
    $('supplierPaymentMode')?.value || 'Cash',
    $('supplierPaymentNote')?.value || '',
    true
  );
  e.target.reset();
});

/* ---------------- Expenses, Settings, Backup & Reports ---------------- */
if ($('expenseDate')) $('expenseDate').value = today();
on('expenseForm', 'submit', (e) => {
  e.preventDefault();
  const title = $('expenseTitle').value;
  const amount = +$('expenseAmount').value;
  d.expenses.push({
    title,
    amount,
    mode: $('expenseMode').value,
    date: $('expenseDate').value || today()
  });
  logActivity('payment', `Expense: ${title} · ${money(amount)}`);
  e.target.reset();
  if ($('expenseDate')) $('expenseDate').value = today();
  changed();
  toast('Expense saved');
});

on('settingsForm', 'submit', (e) => {
  e.preventDefault();
  d.settings = {
    ...d.settings,
    storeName: $('storeName')?.value || 'NOORI PERFUME',
    phone: $('storePhone')?.value || '',
    address: $('storeAddress')?.value || '',
    reorder: +$('reorder')?.value || 5,
    adTitle: $('adTitle')?.value || '',
    adText: $('adText')?.value || '',
    adImage: $('adImage')?.value || '',
    adVideo: $('adVideo')?.value || '',
    adSlides: $('adSlides')?.value || ''
  };
  changed();
  toast('Noori Perfume settings saved');
});

on('backup', 'click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ data: d }, null, 2)], { type: 'application/json' }));
  a.download = 'noori-perfume-backup-' + today() + '.json';
  a.click();
});

on('restore', 'change', async (e) => {
  try {
    const j = JSON.parse(await e.target.files[0].text());
    if (!j.data?.products) throw new Error('Invalid backup');
    if (confirm('Replace current store data?')) {
      d = {
        ...d,
        ...j.data,
        settings: { ...DEFAULT_SETTINGS, ...(j.data.settings || {}) },
        categories: j.data.categories || [...DEFAULT_CATS],
        products: j.data.products || [],
        sales: j.data.sales || [],
        purchases: j.data.purchases || [],
        purchaseOrders: j.data.purchaseOrders || [],
        expenses: j.data.expenses || [],
        attars: j.data.attars || [],
        returns: j.data.returns || [],
        stockTransfers: j.data.stockTransfers || [],
        stockAdjustments: j.data.stockAdjustments || [],
        customers: j.data.customers || [],
        suppliers: j.data.suppliers || [],
        customerPayments: j.data.customerPayments || [],
        supplierPayments: j.data.supplierPayments || [],
        activityLog: j.data.activityLog || []
      };
      changed();
      if ($('backupMsg')) $('backupMsg').textContent = 'Restored';
    }
  } catch (x) {
    if ($('backupMsg')) $('backupMsg').textContent = x.message;
  }
});

async function loadCloudBackups() {
  if (!profile?.shopId || !$('backupHistoryRows')) return;
  try {
    const snap = await getDocs(collection(db, 'shops', profile.shopId, 'backups'));
    const list = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => String(b.createdAtStr || b.id).localeCompare(String(a.createdAtStr || a.id)));
    $('backupHistoryRows').innerHTML = list.length ? list.map((b) => `
      <div class="line">
        <span>${esc(b.createdAtStr || b.id)} · ${esc(b.createdBy || '')}</span>
        <div>
          <button type="button" class="alt tiny" data-bk-restore="${esc(b.id)}">Restore</button>
          <button type="button" class="alt tiny danger" data-bk-del="${esc(b.id)}">Del</button>
        </div>
      </div>
    `).join('') : '<p class="muted">No cloud snapshots yet.</p>';

    $$('[data-bk-restore]').forEach((btn) => {
      btn.onclick = () => {
        const item = list.find((x) => x.id === btn.dataset.bkRestore);
        if (item?.data && confirm('Restore this cloud snapshot?')) {
          d = { ...d, ...item.data, settings: { ...DEFAULT_SETTINGS, ...(item.data.settings || {}) } };
          changed();
          toast('Cloud snapshot restored');
        }
      };
    });

    $$('[data-bk-del]').forEach((btn) => {
      btn.onclick = async () => {
        await deleteDoc(doc(db, 'shops', profile.shopId, 'backups', btn.dataset.bkDel));
        loadCloudBackups();
        toast('Snapshot deleted');
      };
    });
  } catch (e) {
    setText('backupHistoryRows', e.message);
  }
}

on('createCloudBackup', 'click', async () => {
  if (!profile?.shopId) return;
  try {
    const id = 'snap-' + Date.now();
    await setDoc(doc(db, 'shops', profile.shopId, 'backups', id), {
      data: d,
      createdAt: serverTimestamp(),
      createdAtStr: nowStr(),
      createdBy: profile.name || user.email
    });
    const snap = await getDocs(collection(db, 'shops', profile.shopId, 'backups'));
    const sorted = snap.docs.sort((a, b) => b.id.localeCompare(a.id));
    for (const extra of sorted.slice(5)) {
      await deleteDoc(doc(db, 'shops', profile.shopId, 'backups', extra.id));
    }
    loadCloudBackups();
    toast('Cloud snapshot created');
  } catch (e) {
    toast('Cloud backup error: ' + e.message, 'error');
  }
});

on('refreshBackupHistory', 'click', loadCloudBackups);

if ($('from')) $('from').value = today().slice(0, 8) + '01';
if ($('to')) $('to').value = today();

on('runReport', 'click', () => {
  const a = $('from')?.value || '', b = $('to')?.value || '';
  const ss = d.sales.filter((s) => s.date >= a && s.date <= b);
  const ex = d.expenses.filter((x) => x.date >= a && x.date <= b);
  const saleIds = new Set(ss.map((s) => s.id));
  const rr = d.returns.filter((r) => saleIds.has(r.saleId));
  const refunds = rr.reduce((v, r) => v + (+r.refund || 0), 0);
  const sales = ss.reduce((v, s) => v + (+s.total || 0), 0) - refunds;
  const rawCost = ss.reduce((v, s) => v + (s.lines || []).reduce((z, l) => z + (+l.qty || 0) * (+l.cost || 0), 0), 0);
  const returnedCost = rr.reduce((v, r) => {
    const sale = ss.find((s) => s.id === r.saleId);
    const line = sale?.lines?.[r.lineIndex];
    return v + (+r.qty || 0) * (+line?.cost || 0);
  }, 0);
  const cost = Math.max(0, rawCost - returnedCost);
  const expenses = ex.reduce((v, x) => v + (+x.amount || 0), 0);
  if ($('rSales')) $('rSales').textContent = money(sales);
  if ($('rCost')) $('rCost').textContent = money(cost);
  if ($('rProfit')) $('rProfit').textContent = money(sales - cost);
  if ($('rExpenses')) $('rExpenses').textContent = money(expenses);
  if ($('reportRows')) {
    $('reportRows').innerHTML = ss.map((s) => `<div class="line">${esc(s.billNo)} · ${esc(s.date)}<b>${money(s.total)}</b></div>`).join('') +
      (rr.length ? `<div class="line">Returns / refunds <b>-${money(refunds)}</b></div>` : '') || 'No sales';
  }
});

on('csv', 'click', () => {
  const rows = [['Bill', 'Date', 'Customer', 'Payment', 'Subtotal', 'Discount', 'Total'], ...d.sales.map((s) => [s.billNo, s.date, s.customer, s.mode, s.subtotal, s.discount, s.total])];
  const csv = rows.map((r) => r.map((x) => '"' + String(x ?? '').replaceAll('"', '""') + '"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'noori-sales.csv';
  a.click();
});

/* ---------------- Attar Calculator, Returns, Labels & Scanner ---------------- */
function v3ProductOptions(id, kind) {
  const el = $(id);
  if (!el) return;
  const old = el.value;
  const list = d.products.filter((p) => !kind || p.stockType === kind);
  el.innerHTML = list.map((p) => `<option value="${p.id}">${esc(p.name)} · ${p.stock} ${esc(p.unit)}</option>`).join('') || '<option value="">No matching products</option>';
  if (list.some((p) => p.id === old)) el.value = old;
}

function v3CalcInfo() {
  const p = d.products.find((x) => x.id === $('calcAttar')?.value);
  const info = $('calcRateInfo');
  if (!p || !info) return;
  info.textContent = `${p.name}: 3 ml ${money(p.price3)}, 6 ml ${money(p.price6)}, 12 ml ${money(p.price12)}. Purchase cost is ${money(p.cost)} per ${p.unit}.`;
}

on('calcAttar', 'change', v3CalcInfo);
on('attarAddProduct', 'click', () => {
  if ($('newProduct')) $('newProduct').click();
  setTimeout(() => {
    if ($('stockType')) $('stockType').value = 'loose';
    if ($('unit')) $('unit').value = 'ml';
    syncProductFields();
  }, 0);
});

on('calculatePerfume', 'click', () => {
  const p = d.products.find((x) => x.id === $('calcAttar')?.value);
  const qty = +$('calcQty')?.value || 0;
  if (!p || qty <= 0) return toast('Loose attar aur quantity chuno', 'error');
  const base30 = (+p.cost || 0) * 12 + (+$('making')?.value || 0);
  const total = (base30 * qty) / 30;
  if ($('calcResult')) {
    $('calcResult').textContent = 'Estimated making cost: ' + money(total) + ' · Suggested menu: ' +
      (qty === 3 ? money(p.price3) : qty === 6 ? money(p.price6) : qty === 12 ? money(p.price12) : 'Set a menu rate');
  }
});

on('printAttarMenu', 'click', () => {
  const items = d.products.filter((p) => p.stockType === 'loose');
  const w = open('', '_blank');
  if (!w) return toast('Menu print ke liye pop-ups allow karo', 'error');
  w.document.write(`<html><head><title>NOORI PERFUME Attar Menu</title><style>@page{size:A4;margin:18mm}body{font-family:Arial;color:#29213b}h1,h2{text-align:center;color:#6940a5}table{width:100%;border-collapse:collapse;margin-top:25px}th,td{border:1px solid #777;padding:12px;text-align:center}th{background:#eee}</style></head><body><h1>${esc(d.settings.storeName || 'NOORI PERFUME')}</h1><h2>ATTAR PRICE MENU</h2><table><tr><th>Attar Name</th><th>3 ml</th><th>6 ml</th><th>12 ml</th></tr>${items.map((x) => `<tr><td>${esc(x.name)}</td><td>${money(x.price3)}</td><td>${money(x.price6)}</td><td>${money(x.price12)}</td></tr>`).join('')}</table><script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
});

function updateReturnProducts() {
  const bill = d.sales.find((x) => x.id === $('returnBill')?.value);
  if ($('returnProduct')) {
    $('returnProduct').innerHTML = (bill?.lines || []).map((x, i) => `<option value="${i}">${esc(x.name)} · ${x.qty} ${x.unit} · ${money(x.price)}</option>`).join('');
  }
  suggestRefund();
}

function suggestRefund() {
  const sale = d.sales.find((x) => x.id === $('returnBill')?.value);
  const line = sale?.lines?.[+$('returnProduct')?.value];
  const qty = +$('returnQty')?.value || 0;
  if (line && qty > 0 && $('refundAmount')) {
    const lineTotal = +(line.amount ?? (line.qty * line.price)) || 0;
    $('refundAmount').value = (lineTotal * qty / (+line.qty || 1)).toFixed(2);
  }
}

on('returnBill', 'change', updateReturnProducts);
on('returnProduct', 'change', suggestRefund);
on('returnQty', 'input', suggestRefund);

on('returnForm', 'submit', (e) => {
  e.preventDefault();
  const sale = d.sales.find((x) => x.id === $('returnBill')?.value);
  const idx = +$('returnProduct')?.value;
  const line = sale?.lines?.[idx];
  const qty = +$('returnQty')?.value || 0;
  const refund = +$('refundAmount')?.value || 0;
  if (!sale || !line || qty <= 0 || refund < 0) return toast('Return details check karo', 'error');
  const already = d.returns.filter((x) => x.saleId === sale.id && x.lineIndex === idx).reduce((n, x) => n + x.qty, 0);
  if (already + qty > line.qty) return toast('Return quantity sold quantity se zyada hai', 'error');
  const product = d.products.find((x) => x.id === line.id);
  if (product) product.stock = +(product.stock + qty).toFixed(3);
  d.returns.push({ id: uid(), saleId: sale.id, billNo: sale.billNo, lineIndex: idx, productId: line.id, productName: line.name, qty, unit: line.unit, refund, reason: $('returnReason')?.value || '', date: today() });
  logActivity('sale', `Return on ${sale.billNo}: ${line.name} (${qty} ${line.unit})`);
  e.target.reset();
  changed();
  toast('Return saved and stock updated');
});

on('printLabels', 'click', () => {
  const ids = $$('.labelPick:checked').map((x) => x.value);
  const items = d.products.filter((x) => ids.includes(x.id));
  if (!items.length) return toast('Kam se kam ek product chuno', 'error');
  const size = ($('labelSize')?.value || '50x30').split('x').map(Number);
  const w = open('', '_blank');
  if (!w) return toast('Labels print ke liye pop-ups allow karo', 'error');
  w.document.write(`<html><head><title>Product Labels</title><style>@page{size:A4;margin:8mm}.grid{display:grid;grid-template-columns:repeat(3,${size[0]}mm);gap:3mm}.tag{height:${size[1]}mm;border:1px dashed #777;padding:2mm;box-sizing:border-box;font:10px Arial;overflow:hidden}.tag b{font-size:12px}.price{font-weight:bold;margin-top:3px}</style></head><body><div class="grid">${items.map((p) => `<div class="tag"><b>NOORI PERFUME</b><br>${esc(p.sku)}<br>${esc(p.name)} · ${esc(p.quality || '')}<div class="price">${money(p.price)}</div></div>`).join('')}</div><script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
});

function addScannedToSale(p) {
  if (!p) return;
  if ($('saleProduct')) $('saleProduct').value = p.id;
  const qty = p.stockType === 'loose' ? 3 : 1;
  const price = p.stockType === 'loose' ? p.price3 : p.price;
  cart.push({ id: p.id, name: p.name, qty, unit: p.unit, price, amount: price, cost: p.cost, stockType: p.stockType });
  renderCart();
  toast(`${p.name} added to bill`);
}

function showScannedSku(code) {
  const q = String(code || '').trim().toLowerCase();
  const p = d.products.find((x) => String(x.sku || '').toLowerCase() === q || x.name.toLowerCase().includes(q));
  setHTML('scannerResult', p
    ? `<div class="line"><span><b>${esc(p.name)}</b> · SKU: ${esc(p.sku)} · Stock: ${p.stock} ${esc(p.unit)} · Price: ${money(p.price)}</span><button type="button" class="alt tiny" id="scanAddBill">+ Add to Bill</button></div>`
    : '<p class="muted">No matching product found.</p>');
  if (p && $('scanAddBill')) $('scanAddBill').onclick = () => addScannedToSale(p);
}

on('lookupSku', 'click', () => showScannedSku($('manualSku')?.value));
on('manualSku', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); showScannedSku($('manualSku')?.value); } });

on('startScanner', 'click', async () => {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return toast('Camera supported nahi hai', 'error');
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('scannerVideo');
    if (v) { v.srcObject = scannerStream; v.hidden = false; }
    if ('BarcodeDetector' in window) {
      const detector = new window.BarcodeDetector();
      clearInterval(scannerLoop);
      scannerLoop = setInterval(async () => {
        try {
          const codes = await detector.detect(v);
          if (codes?.[0]?.rawValue) {
            if ($('manualSku')) $('manualSku').value = codes[0].rawValue;
            showScannedSku(codes[0].rawValue);
          }
        } catch {}
      }, 600);
    } else {
      setText('scannerPreview', 'Camera active. Use USB barcode scanner or type SKU below.');
    }
  } catch (e) {
    toast('Camera error: ' + e.message, 'error');
  }
});

on('stopScanner', 'click', () => {
  clearInterval(scannerLoop);
  if (scannerStream) scannerStream.getTracks().forEach((t) => t.stop());
  scannerStream = null;
  if ($('scannerVideo')) $('scannerVideo').hidden = true;
});

on('activityFilter', 'change', render);
on('refreshActivity', 'click', render);

/* ---------------- Master Render ---------------- */
function render() {
  ensurePurchaseUpgradesUI();
  fill('catFilter', cats(), 'All categories');
  fill('pcat', cats());

  const q = ($('search')?.value || '').toLowerCase();
  const filter = $('catFilter')?.value || '';
  const ps = d.products.filter((p) => (!filter || p.category === filter) && [p.name, p.brand, p.sku].join(' ').toLowerCase().includes(q));

  if ($('productRows')) {
    $('productRows').innerHTML = ps.map((p) => {
      const galCount = (p.gallery || []).length + (p.photoUrl ? 1 : 0);
      return `<tr><td>${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:8px">` : ''}<b>${esc(p.name)}</b>${galCount > 1 ? ` <small class="muted">(${galCount} media)</small>` : ''}<br><small>${esc(p.brand || '')}</small></td><td>${esc(p.category)}</td><td>${esc(p.sku || '—')}</td><td>${p.stock} ${esc(p.unit)}</td><td>${money(p.cost)} / ${esc(p.unit || 'unit')}</td><td>${p.stockType === 'loose' && p.unit === 'ml' ? `3ml ${money(p.price3)} · 6ml ${money(p.price6)} · 12ml ${money(p.price12)}` : money(p.price)}</td><td><button type="button" class="alt" data-edit="${p.id}">Edit</button> <button type="button" class="alt" data-del="${p.id}">Del</button></td></tr>`;
    }).join('');
    $$('[data-edit]').forEach((b) => { b.onclick = () => edit(b.dataset.edit); });
    $$('[data-del]').forEach((b) => {
      b.onclick = () => {
        if (confirm('Delete product?')) {
          d.products = d.products.filter((p) => p.id !== b.dataset.del);
          changed();
        }
      };
    });
  }

  const opts = d.products.map((p) => {
    const prev = getLastPurchaseForProduct(p);
    const rateTxt = prev && prev.rate > 0 ? ` · Last Rate ${money(prev.rate)}/${p.unit}` : '';
    return {
      id: p.id,
      label: `${p.name} · ${p.stock} ${p.unit}${rateTxt}`
    };
  });

  ['saleProduct', 'purchaseProduct', 'adjustProduct'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const old = el.value;
    el.innerHTML = opts.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join('');
    if (d.products.some((p) => p.id === old)) el.value = old;
  });

  if ($('stockAdjustmentRows')) {
    $('stockAdjustmentRows').innerHTML = (d.stockAdjustments || []).slice(-8).reverse().map((a) =>
      `<div class="line">${esc(a.name)} · ${esc(a.type)} (${a.before} → ${a.after} ${esc(a.unit)}) · ${esc(a.reason)}</div>`
    ).join('') || '';
  }

  const selectedPurchase = d.products.find((p) => p.id === $('purchaseProduct')?.value);
  if (selectedPurchase && $('purchaseUnit')) {
    $('purchaseUnit').innerHTML = `<option value="${esc(selectedPurchase.unit)}">${esc(selectedPurchase.unit)}</option>`;
    if ($('purchaseUnitHelp')) {
      $('purchaseUnitHelp').textContent = `Purchased in ${selectedPurchase.unit}. 1 ${selectedPurchase.unit} ka Rate daalo; Total = Rate × Qty auto banega.`;
    }
    autofillPreviousRateForSelectedProduct(false);
  }
  updatePurchaseLivePreview();
  renderPurchaseCart();

  if ($('purchaseOrderRows')) {
    const orders = (d.purchaseOrders || []).slice().reverse();
    $('purchaseOrderRows').innerHTML = orders.length ? orders.map((o) => {
      const itemsText = (o.lines || []).map((l) => `${esc(l.name)} (${l.qty} ${esc(l.unit)} × ${money(l.rate)})`).join(', ');
      const isPending = o.status !== 'Received';
      return `<div class="line"><span><b>${esc(o.poNo)}</b> · ${esc(o.supplier || 'No Supplier')} · ${esc(o.date || '')}<br><small class="muted">${itemsText}</small></span><span><b>${money(o.totalAmount)}</b> ${isPending ? `<button type="button" class="alt tiny" data-po-bill="${esc(o.id)}">Make Bill</button>` : '<small class="muted">[Billed]</small>'}</span></div>`;
    }).join('') : '<p class="muted">No purchase orders yet.</p>';
    $$('[data-po-bill]').forEach((b) => {
      b.onclick = () => convertPurchaseOrderToBill(b.dataset.poBill);
    });
  }

  const low = d.products.filter((p) => p.stock <= p.reorder);
  if ($('count')) $('count').textContent = d.products.length;
  if ($('low')) $('low').textContent = low.length;
  if ($('lowList')) $('lowList').innerHTML = low.map((p) => `<div class="line">${esc(p.name)} <b>${p.stock} ${esc(p.unit)}</b></div>`).join('') || 'No low stock';

  const ss = d.sales.filter((s) => s.date === today());
  if ($('todaySales')) $('todaySales').textContent = money(ss.reduce((a, s) => a + s.total, 0));
  if ($('bills')) $('bills').textContent = ss.length;
  if ($('recent')) $('recent').innerHTML = d.sales.slice(-6).reverse().map((s) => `<div class="line">${esc(s.billNo)} · ${esc(s.customer || 'Walk-in')} <b>${money(s.total)}</b></div>`).join('') || 'No sales yet';

  if ($('purchaseRows')) {
    $('purchaseRows').innerHTML = d.purchases.slice(-15).reverse().map((p) => {
      const total = +(p.totalCost ?? p.qty * p.cost) || 0;
      const badge = p.payMode ? ` [${esc(p.payMode)}]` : '';
      const supp = p.supplier ? ` · ${esc(p.supplier)}` : '';
      const poTag = p.poNo ? ` · ${esc(p.poNo)}` : '';
      return `<div class="line"><span><b>${esc(p.name)}</b> · ${p.qty} ${esc(p.unit)} × ${money(p.cost)}/${esc(p.unit)}${supp}${poTag}${badge} · <small class="muted">${esc(p.date || '')}</small></span><span><b>${money(total)}</b> ${p.id ? `<button type="button" class="alt tiny danger" data-del-pur="${esc(p.id)}">Del</button>` : ''}</span></div>`;
    }).join('') || 'No purchases';
    $$('[data-del-pur]').forEach((b) => {
      b.onclick = () => deletePurchaseEntry(b.dataset.delPur);
    });
  }

  if ($('expenseRows')) $('expenseRows').innerHTML = d.expenses.slice(-10).reverse().map((x) => `<div class="line">${esc(x.title)} · ${esc(x.date)}<b>${money(x.amount)}</b></div>`).join('') || 'No expenses';

  // Customers & Suppliers Due + Settlement UI
  const custBals = getCustomerBalances();
  const suppBals = getSupplierBalances();
  const custDueOnly = custBals.filter((x) => x.due > 0);
  const suppDueOnly = suppBals.filter((x) => x.due > 0);

  setHTML('dashboardCustomerDue', custDueOnly.length
    ? `<div class="line"><b>Total Customer Due</b><b>${money(custDueOnly.reduce((a, b) => a + b.due, 0))}</b></div>` +
      custDueOnly.map((c) => `<div class="line"><span>${esc(c.name)}</span><span><b>${money(c.due)}</b> <button type="button" class="alt tiny" data-q-cust-settle="${esc(c.name)}" data-q-cust-due="${c.due}">Settle</button></span></div>`).join('')
    : 'No customer due');

  setHTML('dashboardSupplierDue', suppDueOnly.length
    ? `<div class="line"><b>Total Supplier Due</b><b>${money(suppDueOnly.reduce((a, b) => a + b.due, 0))}</b></div>` +
      suppDueOnly.map((s) => `<div class="line"><span>${esc(s.name)}</span><span><b>${money(s.due)}</b> <button type="button" class="alt tiny" data-q-supp-settle="${esc(s.name)}" data-q-supp-due="${s.due}">Settle</button></span></div>`).join('')
    : 'No supplier due');

  setHTML('saleCustomerDue', custDueOnly.length
    ? custDueOnly.map((c) => `<div class="line"><span>${esc(c.name)} · Credit ${money(c.credit)} · Paid ${money(c.paid)}</span><span><b>Due ${money(c.due)}</b> <button type="button" class="alt tiny" data-q-cust-settle="${esc(c.name)}" data-q-cust-due="${c.due}">Collect Full</button></span></div>`).join('')
    : 'No pending customer credit');

  $$('[data-q-cust-settle]').forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.qCustSettle;
      const due = +b.dataset.qCustDue || 0;
      const val = prompt(`${name} ka due ${money(due)} hai. Kitna payment receive hua?`, due.toFixed(2));
      if (val !== null) settleCustomerPayment(name, +val, 'Cash', 'Quick due settlement', true);
    };
  });

  $$('[data-q-supp-settle]').forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.qSuppSettle;
      const due = +b.dataset.qSuppDue || 0;
      const val = prompt(`${name} ka due ${money(due)} hai. Kitna payment bhejna hai?`, due.toFixed(2));
      if (val !== null) settleSupplierPayment(name, +val, 'Cash', 'Quick supplier settlement', true);
    };
  });

  if ($('customerOptions')) $('customerOptions').innerHTML = custBals.map((c) => `<option value="${esc(c.name)}">`).join('');
  if ($('supplierOptions')) $('supplierOptions').innerHTML = suppBals.map((s) => `<option value="${esc(s.name)}">`).join('');
  fill('customerPaymentName', custBals.map((c) => c.name), 'Select customer');
  fill('supplierPaymentName', suppBals.map((s) => s.name), 'Select supplier');

  const cq = ($('customerSearch')?.value || '').toLowerCase();
  setHTML('customerRows', (d.customers || []).filter((c) => [c.name, c.mobile].join(' ').toLowerCase().includes(cq)).map((c) => {
    const bal = custBals.find((x) => x.name === c.name) || { due: 0 };
    return `<div class="line"><span><b>${esc(c.name)}</b> · ${esc(c.mobile || '')} · Due: <b>${money(bal.due)}</b></span><button type="button" class="alt tiny" data-cedit="${c.id}">Edit</button></div>`;
  }).join('') || 'No customers added');
  $$('[data-cedit]').forEach((b) => {
    b.onclick = () => {
      const c = d.customers.find((x) => x.id === b.dataset.cedit);
      if (!c) return;
      $('customerId').value = c.id;
      $('customerName').value = c.name;
      $('customerMobile').value = c.mobile || '';
      $('customerAddress').value = c.address || '';
      $('customerNotes').value = c.notes || '';
    };
  });

  const payHist = (d.customerPayments || []).slice(-6).reverse().map((p) =>
    `<div class="line"><small class="muted">Paid ${esc(p.date)} · ${esc(p.customer)} [${esc(p.mode)}] ${p.note ? '· ' + esc(p.note) : ''}</small><b>-${money(p.amount)}</b></div>`
  ).join('');
  setHTML('customerCreditRows', (custBals.length ? custBals.map((c) =>
    `<div class="line"><span><b>${esc(c.name)}</b> · Credit ${money(c.credit)} · Paid ${money(c.paid)}</span><span><b>Due ${money(c.due)}</b> ${c.due > 0 ? `<button type="button" class="alt tiny" data-q-cust-settle="${esc(c.name)}" data-q-cust-due="${c.due}">Settle</button>` : ''}</span></div>`
  ).join('') : '<p class="muted">No credit records</p>') + (payHist ? `<hr><small class="muted">Recent Customer Payments</small>${payHist}` : ''));

  $$('#customerCreditRows [data-q-cust-settle]').forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.qCustSettle;
      const due = +b.dataset.qCustDue || 0;
      const val = prompt(`${name} ka due ${money(due)} hai. Kitna payment receive hua?`, due.toFixed(2));
      if (val !== null) settleCustomerPayment(name, +val, 'Cash', 'Due settlement', true);
    };
  });

  const sq = ($('supplierSearch')?.value || '').toLowerCase();
  setHTML('supplierRows', (d.suppliers || []).filter((s) => [s.name, s.mobile].join(' ').toLowerCase().includes(sq)).map((s) => {
    const bal = suppBals.find((x) => x.name === s.name) || { due: 0 };
    return `<div class="line"><span><b>${esc(s.name)}</b> · ${esc(s.mobile || '')} · Due: <b>${money(bal.due)}</b></span><button type="button" class="alt tiny" data-sedit="${s.id}">Edit</button></div>`;
  }).join('') || 'No suppliers added');
  $$('[data-sedit]').forEach((b) => {
    b.onclick = () => {
      const s = d.suppliers.find((x) => x.id === b.dataset.sedit);
      if (!s) return;
      $('supplierId').value = s.id;
      $('supplierName').value = s.name;
      $('supplierMobile').value = s.mobile || '';
      $('supplierAddress').value = s.address || '';
      $('supplierNotes').value = s.notes || '';
    };
  });

  setHTML('supplierDueRows', suppBals.map((s) =>
    `<div class="line"><span><b>${esc(s.name)}</b> · Purchased ${money(s.purchased)} · Paid ${money(s.paid)}</span><span><b>Due ${money(s.due)}</b> ${s.due > 0 ? `<button type="button" class="alt tiny" data-q-supp-settle="${esc(s.name)}" data-q-supp-due="${s.due}">Pay Due</button>` : ''}</span></div>`
  ).join('') || 'No supplier records');

  $$('#supplierDueRows [data-q-supp-settle]').forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.qSuppSettle;
      const due = +b.dataset.qSuppDue || 0;
      const val = prompt(`${name} ka due ${money(due)} hai. Kitna payment bhejna hai?`, due.toFixed(2));
      if (val !== null) settleSupplierPayment(name, +val, 'Cash', 'Supplier due settlement', true);
    };
  });

  setHTML('supplierPaymentRows', (d.supplierPayments || []).slice(-8).reverse().map((p) =>
    `<div class="line">${esc(p.supplier)} · ${esc(p.mode)} · ${esc(p.date)} ${p.note ? '· ' + esc(p.note) : ''} <b>-${money(p.amount)}</b></div>`
  ).join('') || 'No supplier payments yet');

  // Reports extras
  setHTML('customerSalesReport', custBals.map((c) => `<div class="line">${esc(c.name)} · Due ${money(c.due)} <b>Sales ${money(c.sales)}</b></div>`).join('') || 'No customer sales');
  setHTML('supplierPurchaseReport', suppBals.map((s) => `<div class="line">${esc(s.name)} · Due ${money(s.due)} <b>Purchase ${money(s.purchased)}</b></div>`).join('') || 'No supplier purchases');
  const stockVal = d.products.reduce((sum, p) => sum + (+p.stock || 0) * (+p.cost || 0), 0);
  setHTML('stockValuationReport', `<div class="line">Total Inventory Cost Value <b>${money(stockVal)}</b></div>`);

  // Activity Log
  const actType = $('activityFilter')?.value || '';
  const acts = (d.activityLog || []).filter((a) => !actType || a.type === actType).slice(-40).reverse();
  setHTML('activityRows', acts.map((a) => `<div class="line"><span>[${esc(a.type)}] ${esc(a.text)}</span><small class="muted">${esc(a.at)}</small></div>`).join('') || 'No activity yet');

  // Settings
  if (['Noori Store', 'Noori Store Manager', 'NOORI STORE MANAGER'].includes(d.settings.storeName)) {
    d.settings.storeName = 'NOORI PERFUME';
  }
  if ($('storeName')) $('storeName').value = d.settings.storeName || 'NOORI PERFUME';
  if ($('storePhone')) $('storePhone').value = d.settings.phone || '';
  if ($('storeAddress')) $('storeAddress').value = d.settings.address || '';
  if ($('reorder')) $('reorder').value = d.settings.reorder ?? 5;
  if ($('adTitle')) $('adTitle').value = d.settings.adTitle || '';
  if ($('adText')) $('adText').value = d.settings.adText || '';
  if ($('adImage')) $('adImage').value = d.settings.adImage || '';
  if ($('adVideo')) $('adVideo').value = d.settings.adVideo || '';
  if ($('adSlides')) $('adSlides').value = d.settings.adSlides || '';

  const mediaSel = $('mediaProduct');
  if (mediaSel) {
    const oldM = mediaSel.value;
    mediaSel.innerHTML = `<option value="">Select product</option>` + d.products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    if (d.products.some((p) => p.id === oldM)) mediaSel.value = oldM;
    renderProductGalleryPreview(d.products.find((p) => p.id === mediaSel.value));
  }

  const loose = d.products.filter((p) => p.stockType === 'loose');
  if ($('attarRows')) {
    $('attarRows').innerHTML = loose.map((p) =>
      `<div class="line"><b>${esc(p.name)}</b> · Cost/ml ${money(p.cost)} · 3 ml ${money(p.price3)} · 6 ml ${money(p.price6)} · 12 ml ${money(p.price12)} <button type="button" class="alt" data-product-edit="${p.id}">Edit product</button></div>`
    ).join('') || 'No loose attar products yet. Add one using Add Loose Attar Product.';
    $$('[data-product-edit]').forEach((b) => { b.onclick = () => edit(b.dataset.productEdit); });
  }

  if ($('attarMenuPreview')) {
    $('attarMenuPreview').innerHTML = `<table><thead><tr><th>Attar</th><th>3 ml</th><th>6 ml</th><th>12 ml</th></tr></thead><tbody>${loose.map((p) => `<tr><td>${esc(p.name)}</td><td>${money(p.price3)}</td><td>${money(p.price6)}</td><td>${money(p.price12)}</td></tr>`).join('')}</tbody></table>`;
  }

  if ($('returnBill')) {
    const oldB = $('returnBill').value;
    $('returnBill').innerHTML = d.sales.map((x) => `<option value="${x.id}">${esc(x.billNo)} · ${esc(x.date)} · ${money(x.total)}</option>`).join('');
    if (d.sales.some((x) => x.id === oldB)) $('returnBill').value = oldB;
  }
  updateReturnProducts();

  if ($('returnRows')) {
    const list = d.returns || [];
    $('returnRows').innerHTML = list.length ? list.map((x, idx) => ({ x, idx })).reverse().map(({ x, idx }) =>
      `<div class="line"><span>${esc(x.billNo || '')} · ${esc(x.productName)} · ${x.qty} ${esc(x.unit)} · Refund ${money(x.refund)} · ${esc(x.date || '')}</span><button type="button" class="alt tiny danger" data-del-ret="${esc(x.id || '')}" data-ret-idx="${idx}">Del</button></div>`
    ).join('') : 'No returns yet';
    $$('[data-del-ret]').forEach((b) => {
      b.onclick = () => deleteReturnEntry(b.dataset.delRet, Number(b.dataset.retIdx));
    });
  }

  if ($('labelProducts')) {
    $('labelProducts').innerHTML = d.products.map((p) =>
      `<label class="line"><input type="checkbox" class="labelPick" value="${p.id}"> ${esc(p.name)} · ${esc(p.sku || '')} · ${money(p.price)}</label>`
    ).join('') || 'No products';
  }

  renderAds();
  renderAdSlideManager();
  updateDocSizeMeter();
  v3ProductOptions('transferProduct', 'packed');
  v3ProductOptions('transferTarget', 'loose');

  const cp = $('calcAttar');
  if (cp) {
    const oldC = cp.value;
    cp.innerHTML = loose.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('') || '<option value="">Add a loose attar product first</option>';
    if (loose.some((p) => p.id === oldC)) cp.value = oldC;
    v3CalcInfo();
  }

  renderCart();
}
