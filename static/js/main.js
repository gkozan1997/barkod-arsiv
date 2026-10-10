// ==============================================================
// BARKOD & SERİ NO ARŞİVLEME SİSTEMİ - SAĞLAM VE HIZLI JS MOTORU
// ==============================================================

let html5QrCode = null;
let activeCamTarget = null;
let loadedOrders = [];
let activeOrderIndex = -1;
let scanStep = 1; // 1: Kargo Barkodu, 2: Ürün Seri No

// Web Audio API (Lazy, güvenli başlatma)
let audioCtx = null;
function getAudioContext() {
    try {
        if (!audioCtx) {
            const AudioClass = window.AudioContext || window.webkitAudioContext;
            if (AudioClass) audioCtx = new AudioClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    } catch (e) {
        console.warn('AudioContext uyarısı:', e);
    }
    return audioCtx;
}

function playSuccessBeep() {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1320, now + 0.08);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
    } catch (e) {}
}

function playWarningBuzzer() {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.setValueAtTime(220, now + 0.1);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
    } catch (e) {}
}

// --------------------------------------------------------------
// UYGULAMA BAŞLATICI (HER KOŞULDA ÇALIŞIR)
// --------------------------------------------------------------
function initApp() {
    console.log('[Barkod Arşiv] Başlatılıyor...');
    try { initTabs(); } catch (e) { console.error('Tabs error:', e); }
    try { initExcelUpload(); } catch (e) { console.error('Excel upload error:', e); }
    try { initOrderWorkflow(); } catch (e) { console.error('Order workflow error:', e); }
    try { initFreeScan(); } catch (e) { console.error('Free scan error:', e); }
    try { initSearchAndArchive(); } catch (e) { console.error('Search error:', e); }
    try { initCameraScanner(); } catch (e) { console.error('Camera error:', e); }
    console.log('[Barkod Arşiv] Hazır!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// --------------------------------------------------------------
// 1. TAB GEÇİŞLERİ
// --------------------------------------------------------------
function initTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    const panes = document.querySelectorAll('.tab-pane');

    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = tab.dataset.tab;
            if (!targetId) return;

            tabs.forEach(t => t.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const targetPane = document.getElementById(targetId);
            if (targetPane) {
                targetPane.classList.add('active');
            }

            if (targetId === 'tab-siparis') {
                const scanInput = document.getElementById('activeScanInput');
                if (scanInput) scanInput.focus();
            } else if (targetId === 'tab-serbest') {
                const freeInput = document.getElementById('freeScanInput');
                if (freeInput) freeInput.focus();
            } else if (targetId === 'tab-arama') {
                const searchInput = document.getElementById('archiveSearchInput');
                if (searchInput) searchInput.focus();
            }
        });
    });
}

// --------------------------------------------------------------
// 2. EXCEL YÜKLEME & İNDİRİLENLER'DEN GETİR
// --------------------------------------------------------------
function initExcelUpload() {
    const dropzone = document.getElementById('excelDropzone');
    const fileInput = document.getElementById('excelFileInput');
    const browseBtn = document.getElementById('browseExcelBtn');
    const recentBtn = document.getElementById('btnLoadRecentExcel');

    if (browseBtn && fileInput) {
        browseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            fileInput.click();
        });
    }

    if (dropzone && fileInput) {
        dropzone.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            fileInput.click();
        });

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#3B82F6';
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = 'rgba(59, 130, 246, 0.35)';
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'rgba(59, 130, 246, 0.35)';
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFileUpload(e.dataTransfer.files[0]);
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files.length > 0) {
                handleFileUpload(fileInput.files[0]);
            }
        });
    }

    if (recentBtn) {
        recentBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const orig = recentBtn.textContent;
            recentBtn.textContent = 'Yükleniyor...';
            try {
                const response = await fetch('/api/load-recent-download', { method: 'POST' });
                const res = await response.json();
                if (res.status === 'success') {
                    loadedOrders = res.orders || [];
                    const counter = document.getElementById('loadedOrderCount');
                    if (counter) counter.textContent = loadedOrders.length;
                    renderOrderCards();
                    const dropText = document.querySelector('.dropzone-text strong');
                    if (dropText) dropText.textContent = `Yüklendi: ${res.filename} (${loadedOrders.length} Paket)`;
                    if (loadedOrders.length > 0) selectOrder(0);
                    playSuccessBeep();
                } else {
                    alert('Hata: ' + (res.message || 'Dosya okunamadı. Lütfen "Dosya Seç" ile yükleyin.'));
                    playWarningBuzzer();
                }
            } catch (err) {
                alert('İndirilenler klasörüne doğrudan erişim yerel sunucuda (127.0.0.1:5004) çalışır. Bulutta dosyanızı "Dosya Seç" butonu ile yükleyebilirsiniz.');
                playWarningBuzzer();
            } finally {
                recentBtn.textContent = orig;
            }
        });
    }
}

async function handleFileUpload(file) {
    const formData = new FormData();
    formData.append('file', file);

    const dropText = document.querySelector('.dropzone-text strong');
    const origText = dropText ? dropText.textContent : '';
    if (dropText) dropText.textContent = 'Dosya yükleniyor ve siparişler okunuyor...';

    try {
        const response = await fetch('/api/upload-orders', {
            method: 'POST',
            body: formData
        });
        const res = await response.json();

        if (res.status === 'success') {
            loadedOrders = res.orders || [];
            const counter = document.getElementById('loadedOrderCount');
            if (counter) counter.textContent = loadedOrders.length;
            renderOrderCards();
            if (dropText) dropText.textContent = `Yüklendi: ${file.name} (${loadedOrders.length} Paket)`;
            if (loadedOrders.length > 0) {
                selectOrder(0);
            }
            playSuccessBeep();
        } else {
            alert('Hata: ' + (res.message || 'Dosya okunamadı'));
            if (dropText) dropText.textContent = origText;
            playWarningBuzzer();
        }
    } catch (err) {
        alert('Sunucu hatası: ' + err.message);
        if (dropText) dropText.textContent = origText;
        playWarningBuzzer();
    }
}

// --------------------------------------------------------------
// 3. 2 ADIMLI AKILLI DEPO TARAMA AKIŞI
// --------------------------------------------------------------
function setScanStep(step) {
    scanStep = step;
    const chip1 = document.getElementById('stepChip1');
    const chip2 = document.getElementById('stepChip2');
    const title = document.getElementById('scanLabelTitle');
    const hint = document.getElementById('scanLabelHint');
    const input = document.getElementById('activeScanInput');

    if (!input) return;

    if (step === 1) {
        if (chip1) chip1.className = 'step-chip active';
        if (chip2) chip2.className = 'step-chip';
        if (title) {
            title.innerHTML = '📦 1. Adım: Kargo Barkodunu Okutun';
            title.style.color = '#38BDF8';
        }
        if (hint) hint.textContent = 'Kolideki kargo etiketini okutun, müşteri ve ürünler otomatik açılsın';
        input.className = 'scan-large-input step1-mode';
        input.placeholder = '1. ADIM: Koli Kargo Barkodunu Okutun...';
    } else {
        if (chip1) chip1.className = 'step-chip';
        if (chip2) chip2.className = 'step-chip active-step2';
        const order = (activeOrderIndex !== -1 && loadedOrders[activeOrderIndex]) ? loadedOrders[activeOrderIndex] : null;
        const musteriStr = order ? `(${order.musteri_adi})` : '';
        if (title) {
            title.innerHTML = `🎯 2. Adım: Ürün Seri No / Barkodunu Okutun ${musteriStr}`;
            title.style.color = '#34D399';
        }
        if (hint) hint.textContent = 'Pakete koyduğunuz cihazın seri numarasını (SN/IMEI) okutun';
        input.className = 'scan-large-input step2-mode';
        input.placeholder = '2. ADIM: Ürün Seri Numarası / Barkod Okutun...';
    }
    input.disabled = false;
    input.value = '';
    input.focus();
}

function initOrderWorkflow() {
    const filterInput = document.getElementById('orderFilterInput');
    if (filterInput) {
        filterInput.addEventListener('input', () => {
            renderOrderCards(filterInput.value.trim().toLowerCase());
        });
    }

    const scanInput = document.getElementById('activeScanInput');
    if (scanInput) {
        scanInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const code = scanInput.value.trim();
                if (code) {
                    handleSmartScan(code);
                }
            }
        });
    }

    const resetBtn = document.getElementById('btnResetToStep1');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            setScanStep(1);
        });
    }

    const nextBtn = document.getElementById('btnNextOrder');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            setScanStep(1);
            const banner = document.getElementById('orderCompleteBanner');
            if (banner) banner.style.display = 'none';
        });
    }

    setScanStep(1);
}

async function handleSmartScan(code) {
    const cleanCode = code.trim();
    const alertBox = document.getElementById('orderScanAlert');
    const scanInput = document.getElementById('activeScanInput');

    if (!cleanCode) return;

    if (loadedOrders.length === 0) {
        playWarningBuzzer();
        showAlert(alertBox, 'error', 'Henüz sipariş listesi yüklenmedi! Lütfen yukarıdan "İndirilenler'den Getir" veya "Dosya Seç" ile listenizi yükleyin.');
        scanInput.value = '';
        return;
    }

    // Kargo Barkodu Eşleşme Kontrolü
    const matchedIdx = loadedOrders.findIndex(o => 
        (o.kargo_barkodu && o.kargo_barkodu.trim().toLowerCase() === cleanCode.toLowerCase()) ||
        (o.siparis_no && o.siparis_no.trim().toLowerCase() === cleanCode.toLowerCase())
    );

    if (scanStep === 1 || matchedIdx !== -1) {
        if (matchedIdx !== -1) {
            selectOrder(matchedIdx);
            setScanStep(2);
            playSuccessBeep();
            const order = loadedOrders[matchedIdx];
            showAlert(alertBox, 'success', `📦 PAKET AÇILDI: ${order.musteri_adi} | Kargo: ${order.kargo_barkodu || order.siparis_no} (${order.pazaryeri})`);
            return;
        } else {
            playWarningBuzzer();
            showAlert(alertBox, 'error', `⚠️ Bu kargo barkodu listede bulunamadı: "${cleanCode}". Kolideki doğru barkodu okutun.`);
            scanInput.value = '';
            scanInput.focus();
            return;
        }
    }

    if (scanStep === 2) {
        if (activeOrderIndex === -1) {
            setScanStep(1);
            return;
        }
        await processProductSerialScan(cleanCode);
    }
}

async function processProductSerialScan(barcode) {
    if (activeOrderIndex === -1) return;
    const order = loadedOrders[activeOrderIndex];
    const alertBox = document.getElementById('orderScanAlert');
    const scanInput = document.getElementById('activeScanInput');

    const pendingItem = order.urunler.find(i => !i.tamamlandi);
    if (!pendingItem) {
        showAlert(alertBox, 'duplicate', 'Bu paketteki tüm ürünler zaten tamamlanmış!');
        scanInput.value = '';
        setScanStep(1);
        return;
    }

    try {
        const response = await fetch('/api/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kargo_barkodu: order.kargo_barkodu || '',
                siparis_no: order.siparis_no || '',
                musteri_adi: order.musteri_adi,
                urun_adi: pendingItem.urun_adi,
                barkod_seri_no: barcode,
                pazaryeri: order.pazaryeri,
                okutma_yontemi: 'El Terminali / Kargo Eşleme'
            })
        });
        const res = await response.json();

        if (res.status === 'success') {
            if (!pendingItem.seri_nolar) pendingItem.seri_nolar = [];
            pendingItem.seri_nolar.push(barcode);
            pendingItem.okunan_adet = (pendingItem.okunan_adet || 0) + 1;
            pendingItem.tamamlandi = true;
            pendingItem.okunan_adet = pendingItem.adet;

            renderActiveOrderItems();
            updateOrderProgress();
            renderOrderCards();
            updateHeaderStats(res.stats);

            const allDone = order.urunler.every(i => i.tamamlandi);

            if (res.is_duplicate) {
                playWarningBuzzer();
                showAlert(alertBox, 'duplicate', `⚠️ MÜKERRER UYARISI: Bu Seri No (${barcode}) daha önce kaydedilmiş! Yine de arşive mühürlendi.`);
            } else {
                playSuccessBeep();
                showAlert(alertBox, 'success', `✅ ÜRÜN MÜHÜRLENDİ: ${pendingItem.urun_adi.substring(0, 35)}... (Seri No: ${barcode})`);
            }

            if (allDone) {
                playSuccessBeep();
                setTimeout(() => {
                    showAlert(alertBox, 'success', `🎉 TEBRİKLER! Bu paketin tüm ürünleri tamamlandı. Sıradaki koli için KARGO BARKODU okutun.`);
                    setScanStep(1);
                }, 1200);
            } else {
                scanInput.value = '';
                scanInput.focus();
            }
        } else {
            playWarningBuzzer();
            showAlert(alertBox, 'error', 'Hata: ' + (res.message || 'Kaydedilemedi'));
        }
    } catch (err) {
        playWarningBuzzer();
        showAlert(alertBox, 'error', 'Bağlantı hatası: ' + err.message);
    }
}

function renderOrderCards(filterText = '') {
    const container = document.getElementById('orderCardsContainer');
    if (!container) return;

    container.innerHTML = '';
    if (loadedOrders.length === 0) {
        container.innerHTML = '<div class="empty-state">Henüz sipariş yüklenmedi.<br>Yukarıdaki alandan Excel dosyanızı seçin.</div>';
        return;
    }

    loadedOrders.forEach((order, idx) => {
        if (filterText) {
            const matchKargo = (order.kargo_barkodu || '').toLowerCase().includes(filterText);
            const matchOrder = (order.siparis_no || '').toLowerCase().includes(filterText);
            const matchCustomer = (order.musteri_adi || '').toLowerCase().includes(filterText);
            if (!matchKargo && !matchOrder && !matchCustomer) return;
        }

        const isSelected = (idx === activeOrderIndex);
        const card = document.createElement('div');
        card.className = `order-card-item ${isSelected ? 'selected' : ''} ${order.tamamlandi ? 'completed' : ''}`;
        const kargoGosterim = order.kargo_barkodu || order.siparis_no || 'Barkod Yok';
        const kargoBilgi = order.kargo_firmasi ? ` • ${order.kargo_firmasi}` : '';

        card.innerHTML = `
            <div class="card-item-top">
                <span class="card-order-no" style="font-size: 14px; color: #38BDF8;">🏷️ ${kargoGosterim}</span>
                <span class="card-market-tag">${order.pazaryeri || 'Pazar'}${kargoBilgi}</span>
            </div>
            <div class="card-customer">${order.musteri_adi || 'Müşteri'}</div>
            <div class="card-item-summary" style="display: flex; justify-content: space-between;">
                <span>${order.urunler.length} Kalem Ürün</span>
                <span style="font-size: 11px; color: var(--text-muted);">Sipariş: ${order.siparis_no || '-'}</span>
                ${order.tamamlandi ? '<span>✅</span>' : ''}
            </div>
        `;
        card.addEventListener('click', () => selectOrder(idx));
        container.appendChild(card);
    });
}

function selectOrder(index) {
    if (index < 0 || index >= loadedOrders.length) return;
    activeOrderIndex = index;
    const order = loadedOrders[index];

    renderOrderCards(document.getElementById('orderFilterInput')?.value.trim().toLowerCase() || '');

    const kargoBilgisi = order.kargo_firmasi ? ` (${order.kargo_firmasi})` : '';
    const mBadge = document.getElementById('activeMarketplace');
    if (mBadge) mBadge.textContent = (order.pazaryeri || 'Pazaryeri') + kargoBilgisi;

    const oTitle = document.getElementById('activeOrderTitle');
    if (oTitle) oTitle.textContent = `🏷️ Kargo Barkodu: ${order.kargo_barkodu || order.siparis_no}`;

    const cName = document.getElementById('activeCustomerName');
    if (cName) cName.textContent = `Alıcı: ${order.musteri_adi || 'Bilinmiyor'} • Sipariş No: ${order.siparis_no || '-'}`;

    renderActiveOrderItems();
    updateOrderProgress();

    setScanStep(2);

    const alertBox = document.getElementById('orderScanAlert');
    if (alertBox) alertBox.style.display = 'none';
}

function renderActiveOrderItems() {
    const tbody = document.getElementById('activeOrderItemsBody');
    if (!tbody || activeOrderIndex === -1) return;

    const order = loadedOrders[activeOrderIndex];
    tbody.innerHTML = '';

    order.urunler.forEach((item, itemIdx) => {
        const isDone = item.tamamlandi;
        const tr = document.createElement('tr');
        if (isDone) tr.className = 'completed-row';

        const serialsHtml = (item.seri_nolar && item.seri_nolar.length > 0)
            ? item.seri_nolar.map(sn => `<span class="code-pill">${sn}</span>`).join(' ')
            : '<span class="text-muted">Okutulmadı</span>';

        tr.innerHTML = `
            <td><span class="item-check-icon">${isDone ? '✅' : '⏳'}</span></td>
            <td><strong>${item.urun_adi}</strong></td>
            <td style="text-align: center;"><strong>${item.okunan_adet || 0} / ${item.adet}</strong></td>
            <td>${serialsHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

function updateOrderProgress() {
    if (activeOrderIndex === -1) return;
    const order = loadedOrders[activeOrderIndex];

    let totalItems = order.urunler.length;
    let completedItems = order.urunler.filter(i => i.tamamlandi).length;

    let percent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
    const progressEl = document.getElementById('orderProgressPercent');
    if (progressEl) progressEl.textContent = `%${percent}`;

    const banner = document.getElementById('orderCompleteBanner');
    if (percent === 100) {
        order.tamamlandi = true;
        if (banner) banner.style.display = 'flex';
    } else {
        order.tamamlandi = false;
        if (banner) banner.style.display = 'none';
    }
}

// --------------------------------------------------------------
// 4. HIZLI SERBEST KAYIT
// --------------------------------------------------------------
function initFreeScan() {
    const scanInput = document.getElementById('freeScanInput');
    const saveBtn = document.getElementById('btnSaveFreeScan');
    const refreshBtn = document.getElementById('btnRefreshStats');

    if (scanInput) {
        scanInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                executeFreeScan();
            }
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', executeFreeScan);
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshDashboardStats);
    }
}

async function executeFreeScan() {
    const scanInput = document.getElementById('freeScanInput');
    const barcode = scanInput ? scanInput.value.trim() : '';
    const alertBox = document.getElementById('freeScanAlert');

    if (!barcode) {
        showAlert(alertBox, 'error', 'Lütfen geçerli bir barkod / seri no okutun!');
        return;
    }

    const kargoBarcode = document.getElementById('freeKargoBarcode')?.value.trim() || '';
    const orderNo = document.getElementById('freeOrderNo')?.value.trim() || '';
    const customer = document.getElementById('freeCustomerName')?.value.trim() || '';
    const product = document.getElementById('freeProductName')?.value.trim() || '';
    const marketplace = document.getElementById('freeMarketplace')?.value || 'Diğer';

    try {
        const response = await fetch('/api/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kargo_barkodu: kargoBarcode,
                siparis_no: orderNo,
                musteri_adi: customer,
                urun_adi: product,
                barkod_seri_no: barcode,
                pazaryeri: marketplace,
                okutma_yontemi: 'Hızlı Serbest Kayıt'
            })
        });
        const res = await response.json();

        if (res.status === 'success') {
            updateHeaderStats(res.stats);
            addRecentScanRow(res.record);

            if (res.is_duplicate) {
                playWarningBuzzer();
                showAlert(alertBox, 'duplicate', `⚠️ MÜKERRER BARKOD: Bu Seri No (${barcode}) daha önce kaydedilmiş! Kayıt mühürlendi.`);
            } else {
                playSuccessBeep();
                showAlert(alertBox, 'success', `✅ Seri No Başarıyla Diske Yazıldı: ${barcode}`);
            }

            scanInput.value = '';
            scanInput.focus();
        } else {
            playWarningBuzzer();
            showAlert(alertBox, 'error', 'Hata: ' + (res.message || 'Kayıt başarısız'));
        }
    } catch (err) {
        playWarningBuzzer();
        showAlert(alertBox, 'error', 'Sunucu hatası: ' + err.message);
    }
}

function addRecentScanRow(record) {
    const tbody = document.getElementById('recentScansBody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${record.kayit_tarihi}</td>
        <td><span class="code-pill">${record.barkod_seri_no}</span></td>
        <td><strong>${record.kargo_barkodu || record.siparis_no || '-'}</strong></td>
        <td>${record.musteri_adi || '-'}</td>
        <td><span class="market-tag">${record.pazaryeri || 'Diğer'}</span></td>
    `;
    tbody.insertBefore(tr, tbody.firstChild);
}

// --------------------------------------------------------------
// 5. ARAMA & KANIT ARŞİVİ
// --------------------------------------------------------------
function initSearchAndArchive() {
    const searchBtn = document.getElementById('btnExecuteSearch');
    const searchInput = document.getElementById('archiveSearchInput');
    const excelBtn = document.getElementById('btnDownloadExcelArchive');
    const fullBackupBtn = document.getElementById('btnFullExcelExport');

    if (searchBtn) searchBtn.addEventListener('click', executeArchiveSearch);
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                executeArchiveSearch();
            }
        });
    }

    if (excelBtn) {
        excelBtn.addEventListener('click', () => {
            const q = document.getElementById('archiveSearchInput')?.value.trim() || '';
            const start = document.getElementById('archiveStartDate')?.value || '';
            const end = document.getElementById('archiveEndDate')?.value || '';
            window.location.href = `/api/export-excel?q=${encodeURIComponent(q)}&start_date=${start}&end_date=${end}`;
        });
    }

    if (fullBackupBtn) {
        fullBackupBtn.addEventListener('click', () => {
            window.location.href = '/api/export-excel';
        });
    }

    document.getElementById('btnCloseProofModal')?.addEventListener('click', () => {
        const m = document.getElementById('proofModal');
        if (m) m.style.display = 'none';
    });
    document.getElementById('btnDismissProof')?.addEventListener('click', () => {
        const m = document.getElementById('proofModal');
        if (m) m.style.display = 'none';
    });
    document.getElementById('btnPrintProof')?.addEventListener('click', () => {
        window.print();
    });
}

async function executeArchiveSearch() {
    const q = document.getElementById('archiveSearchInput')?.value.trim() || '';
    const start = document.getElementById('archiveStartDate')?.value || '';
    const end = document.getElementById('archiveEndDate')?.value || '';
    const tbody = document.getElementById('searchResultsBody');
    const countSpan = document.getElementById('searchResultCount');

    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center">Aranıyor...</td></tr>';

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&start_date=${start}&end_date=${end}`);
        const res = await response.json();

        if (res.status === 'success') {
            if (countSpan) countSpan.textContent = res.count;
            if (!tbody) return;

            if (res.records.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Kayıt bulunamadı.</td></tr>';
                return;
            }

            tbody.innerHTML = '';
            res.records.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>#${r.id}</td>
                    <td>${r.kayit_tarihi}</td>
                    <td><strong style="color: #38BDF8;">🏷️ ${r.kargo_barkodu || '-'}</strong></td>
                    <td><span class="code-pill">${r.barkod_seri_no}</span></td>
                    <td>${r.siparis_no || '-'}</td>
                    <td>${r.musteri_adi || '-'}</td>
                    <td>${r.urun_adi || '-'}</td>
                    <td><span class="market-tag">${r.pazaryeri}</span></td>
                    <td>
                        <button class="btn-secondary btn-sm" onclick="openProofModal(${r.id})">Kanıt Belgesi 📜</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Arama hatası: ${err.message}</td></tr>`;
    }
}

window.openProofModal = async function(recordId) {
    try {
        const response = await fetch(`/api/proof/${recordId}`);
        const res = await response.json();

        if (res.status === 'success') {
            const r = res.record;
            document.getElementById('proofId').textContent = r.id;
            document.getElementById('proofCertDate').textContent = 'Tarih: ' + r.kayit_tarihi;
            const proofKargoEl = document.getElementById('proofKargoBarcode');
            if (proofKargoEl) proofKargoEl.textContent = r.kargo_barkodu || r.siparis_no || '-';
            document.getElementById('proofOrderNo').textContent = r.siparis_no || 'Belirtilmedi';
            document.getElementById('proofCustomer').textContent = r.musteri_adi || 'Belirtilmedi';
            document.getElementById('proofProduct').textContent = r.urun_adi || 'Genel Ürün';
            document.getElementById('proofMarketplace').textContent = r.pazaryeri || 'Doğrudan';
            document.getElementById('proofBarcode').textContent = r.barkod_seri_no;
            document.getElementById('proofTime').textContent = r.kayit_tarihi + ' (İstanbul UTC+3)';

            const m = document.getElementById('proofModal');
            if (m) m.style.display = 'flex';
        }
    } catch (err) {
        alert('Kanıt belgesi yüklenemedi: ' + err.message);
    }
};

// --------------------------------------------------------------
// 6. KAMERA İLE TARAMA
// --------------------------------------------------------------
function initCameraScanner() {
    const btnOrder = document.getElementById('btnToggleCamOrder');
    const btnFree = document.getElementById('btnToggleCamFree');
    const closeBtn = document.getElementById('btnCloseCamModal');

    if (btnOrder) btnOrder.addEventListener('click', () => startCameraScanner('order'));
    if (btnFree) btnFree.addEventListener('click', () => startCameraScanner('free'));
    if (closeBtn) closeBtn.addEventListener('click', stopCameraScanner);
}

function startCameraScanner(target) {
    activeCamTarget = target;
    const modal = document.getElementById('camModal');
    const statusText = document.getElementById('camStatusText');
    if (modal) modal.style.display = 'flex';
    if (statusText) statusText.textContent = 'Kamera başlatılıyor, lütfen kameraya izin verin...';

    if (typeof Html5Qrcode === 'undefined') {
        if (statusText) statusText.textContent = 'Kamera kütüphanesi yükleniyor, lütfen birkaç saniye bekleyin...';
        return;
    }

    if (html5QrCode) {
        html5QrCode.stop().catch(() => {}).finally(() => {
            html5QrCode = null;
            launchHtml5QrCode(statusText);
        });
    } else {
        launchHtml5QrCode(statusText);
    }
}

function launchHtml5QrCode(statusText) {
    try {
        html5QrCode = new Html5Qrcode("cameraPreview");
        const config = { fps: 15, qrbox: { width: 280, height: 180 } };

        html5QrCode.start(
            { facingMode: "environment" },
            config,
            (decodedText) => {
                stopCameraScanner();
                if (activeCamTarget === 'order') {
                    const scanInput = document.getElementById('activeScanInput');
                    if (scanInput) {
                        scanInput.value = decodedText;
                        handleSmartScan(decodedText);
                    }
                } else if (activeCamTarget === 'free') {
                    const freeInput = document.getElementById('freeScanInput');
                    if (freeInput) {
                        freeInput.value = decodedText;
                        executeFreeScan();
                    }
                }
            },
            () => {}
        ).then(() => {
            if (statusText) statusText.textContent = 'Kamera aktif. Barkod veya seri numarasını kutu içine getirin.';
        }).catch(err => {
            if (statusText) statusText.textContent = 'Kamera erişim hatası: ' + err;
        });
    } catch (e) {
        if (statusText) statusText.textContent = 'Kamera başlatılamadı: ' + e.message;
    }
}

function stopCameraScanner() {
    const modal = document.getElementById('camModal');
    if (modal) modal.style.display = 'none';

    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            html5QrCode = null;
        }).catch(() => {
            html5QrCode = null;
        });
    }
}

// --------------------------------------------------------------
// YARDIMCI FONKSİYONLAR
// --------------------------------------------------------------
function showAlert(el, type, message) {
    if (!el) return;
    el.className = `scan-feedback-alert ${type}`;
    el.textContent = message;
    el.style.display = 'block';

    setTimeout(() => {
        if (el && el.className.includes(type)) {
            el.style.display = 'none';
        }
    }, 6000);
}

function updateHeaderStats(stats) {
    if (!stats) return;
    if (stats.bugun_kayit !== undefined) {
        const el = document.getElementById('headerTodayCount');
        if (el) el.textContent = stats.bugun_kayit;
        const el2 = document.getElementById('statTodayScans');
        if (el2) el2.textContent = stats.bugun_kayit;
    }
    if (stats.toplam_kayit !== undefined) {
        const el = document.getElementById('statTotalScans');
        if (el) el.textContent = stats.toplam_kayit;
    }
}

async function refreshDashboardStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        updateHeaderStats(data);
    } catch (e) {
        console.error('Stats refresh error:', e);
    }
}
