// ==========================================
// BARKOD & SERİ NO ARŞİVLEME SİSTEMİ (JS ENGINE)
// ==========================================

let html5QrCode = null;
let activeCamTarget = null; // 'order' or 'free'

let loadedOrders = [];
let activeOrderIndex = -1;

// Web Audio API ile net zil ve ikaz sesleri (Harici dosya gerektirmez)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSuccessBeep() {
    try {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        // İki tonlu hoş onay tınısı (880Hz -> 1320Hz)
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1320, now + 0.08);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.start(now);
        osc.stop(now + 0.25);
    } catch (e) {
        console.error('Audio error:', e);
    }
}

function playWarningBuzzer() {
    try {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        // Kalın uyarı sesi (300Hz -> 200Hz)
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.setValueAtTime(220, now + 0.1);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.start(now);
        osc.stop(now + 0.35);
    } catch (e) {
        console.error('Audio error:', e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initExcelUpload();
    initOrderWorkflow();
    initFreeScan();
    initSearchAndArchive();
    initCameraScanner();
});

// ==========================================
// TAB GEÇİŞLERİ
// ==========================================
function initTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    const panes = document.querySelectorAll('.tab-pane');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const targetId = tab.dataset.tab;
            const targetPane = document.getElementById(targetId);
            if (targetPane) {
                targetPane.classList.add('active');
            }

            // Tab geçişinde uygun input'a odaklan
            if (targetId === 'tab-siparis') {
                const scanInput = document.getElementById('activeScanInput');
                if (scanInput && !scanInput.disabled) scanInput.focus();
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

// ==========================================
// EXCEL YÜKLEME
// ==========================================
function initExcelUpload() {
    const dropzone = document.getElementById('excelDropzone');
    const fileInput = document.getElementById('excelFileInput');
    const browseBtn = document.getElementById('browseExcelBtn');

    if (!dropzone || !fileInput) return;

    browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });

    dropzone.addEventListener('click', () => fileInput.click());

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

        const recentBtn = document.getElementById('btnLoadRecentExcel');
    if (recentBtn) {
        recentBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const orig = recentBtn.textContent;
            recentBtn.textContent = 'Yükleniyor...';
            try {
                const response = await fetch('/api/load-recent-download', { method: 'POST' });
                const res = await response.json();
                if (res.status === 'success') {
                    loadedOrders = res.orders || [];
                    document.getElementById('loadedOrderCount').textContent = loadedOrders.length;
                    renderOrderCards();
                    const dropText = document.querySelector('.dropzone-text strong');
                    if (dropText) dropText.textContent = `Yüklendi: ${res.filename} (${loadedOrders.length} Sipariş)`;
                    if (loadedOrders.length > 0) selectOrder(0);
                    playSuccessBeep();
                } else {
                    alert('Hata: ' + (res.message || 'Dosya okunamadı'));
                    playWarningBuzzer();
                }
            } catch (err) {
                alert('İndirilenler klasörüne doğrudan erişim yalnızca yerel programda (127.0.0.1:5004) çalışır. Bulutta dosya seç butonunu kullanınız.');
                playWarningBuzzer();
            } finally {
                recentBtn.textContent = orig;
            }
        });
    }

    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
            handleFileUpload(fileInput.files[0]);
        }
    });
}

async function handleFileUpload(file) {
    const formData = new FormData();
    formData.append('file', file);

    const dropText = document.querySelector('.dropzone-text strong');
    const origText = dropText.textContent;
    dropText.textContent = 'Dosya yükleniyor ve siparişler okunuyor...';

    try {
        const response = await fetch('/api/upload-orders', {
            method: 'POST',
            body: formData
        });
        const res = await response.json();

        if (res.status === 'success') {
            loadedOrders = res.orders || [];
            document.getElementById('loadedOrderCount').textContent = loadedOrders.length;
            renderOrderCards();
            dropText.textContent = `Yüklendi: ${file.name} (${loadedOrders.length} Sipariş)`;
            if (loadedOrders.length > 0) {
                selectOrder(0);
            }
            playSuccessBeep();
        } else {
            alert('Hata: ' + (res.message || 'Dosya okunamadı'));
            dropText.textContent = origText;
            playWarningBuzzer();
        }
    } catch (err) {
        alert('Sunucu hatası: ' + err.message);
        dropText.textContent = origText;
        playWarningBuzzer();
    }
}

// ==========================================
// SİPARİŞ LİSTESİ & EŞLEME AKIŞI
// ==========================================
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
                    processOrderScan(code);
                }
            }
        });
    }

    const nextBtn = document.getElementById('btnNextOrder');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            // Tamamlanmamış ilk siparişi seç
            const nextIdx = loadedOrders.findIndex(o => !o.tamamlandi);
            if (nextIdx !== -1) {
                selectOrder(nextIdx);
            } else {
                alert('Tebrikler! Yüklenen tüm siparişlerin barkodları kaydedildi.');
            }
        });
    }
}

function renderOrderCards(filterText = '') {
    const container = document.getElementById('orderCardsContainer');
    if (!container) return;

    container.innerHTML = '';
    if (loadedOrders.length === 0) {
        container.innerHTML = '<div class="empty-state">Henüz sipariş yüklenmedi.</div>';
        return;
    }

    loadedOrders.forEach((order, idx) => {
        if (filterText) {
            const matchKargo = (order.kargo_barkodu || '').toLowerCase().includes(filterText);
            const matchOrder = (order.siparis_no || '').toLowerCase().includes(filterText) || matchKargo;
            const matchCustomer = (order.musteri_adi || '').toLowerCase().includes(filterText);
            if (!matchOrder && !matchCustomer) return;
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

    // Sol listeyi güncelle
    renderOrderCards(document.getElementById('orderFilterInput')?.value.trim().toLowerCase() || '');

    // Sağ paneli doldur
    const kargoBilgisi = order.kargo_firmasi ? ` (${order.kargo_firmasi})` : '';
    document.getElementById('activeMarketplace').textContent = (order.pazaryeri || 'Pazaryeri') + kargoBilgisi;
    document.getElementById('activeOrderTitle').textContent = `🏷️ Kargo Barkodu: ${order.kargo_barkodu || order.siparis_no}`;
    document.getElementById('activeCustomerName').textContent = `Alıcı: ${order.musteri_adi || 'Bilinmiyor'} • Sipariş No: ${order.siparis_no || '-'}`;

    renderActiveOrderItems();
    updateOrderProgress();

    // Scan input'u etkinleştir ve odakla
    const scanInput = document.getElementById('activeScanInput');
    if (scanInput) {
        scanInput.disabled = false;
        scanInput.value = '';
        scanInput.focus();
    }

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
    document.getElementById('orderProgressPercent').textContent = `%${percent}`;

    const banner = document.getElementById('orderCompleteBanner');
    if (percent === 100) {
        order.tamamlandi = true;
        if (banner) banner.style.display = 'flex';
    } else {
        order.tamamlandi = false;
        if (banner) banner.style.display = 'none';
    }
}

async function processOrderScan(barcode) {
    // 1. Akıllı Kargo Barkodu Tespiti: Okutulan kod mevcut paketlerden birinin kargo barkodu ise o paketi aç!
    const matchedPkgIdx = loadedOrders.findIndex(o => (o.kargo_barkodu && o.kargo_barkodu.trim() === barcode.trim()) || (o.siparis_no && o.siparis_no.trim() === barcode.trim()));
    if (matchedPkgIdx !== -1 && matchedPkgIdx !== activeOrderIndex) {
        selectOrder(matchedPkgIdx);
        playSuccessBeep();
        const scanInput = document.getElementById('activeScanInput');
        if (scanInput) { scanInput.value = ''; scanInput.focus(); }
        return;
    }

    if (activeOrderIndex === -1) {
        alert('Lütfen önce bir paket seçin veya kargo barkodunu okutun!');
        return;
    }
    const order = loadedOrders[activeOrderIndex];
    const alertBox = document.getElementById('orderScanAlert');
    const scanInput = document.getElementById('activeScanInput');

    // Henüz tamamlanmamış ilk kalemi bul
    const pendingItem = order.urunler.find(i => !i.tamamlandi);
    if (!pendingItem) {
        showAlert(alertBox, 'duplicate', 'Bu siparişteki tüm ürünler zaten tamamlandı!');
        scanInput.value = '';
        return;
    }

    // Backend'e kaydet (Çift katmanlı koruma + mükerrer kontrolü)
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
                okutma_yontemi: 'El Terminali / Eşleme'
            })
        });
        const res = await response.json();

        if (res.status === 'success') {
            if (!pendingItem.seri_nolar) pendingItem.seri_nolar = [];
            pendingItem.seri_nolar.push(barcode);
            pendingItem.okunan_adet = (pendingItem.okunan_adet || 0) + 1;

            // Tek okutma kuralı: Tek bir okutmada o kalemin tüm adetleri onaylanır
            pendingItem.tamamlandi = true;
            pendingItem.okunan_adet = pendingItem.adet;

            renderActiveOrderItems();
            updateOrderProgress();
            renderOrderCards();

            updateHeaderStats(res.stats);

            if (res.is_duplicate) {
                playWarningBuzzer();
                showAlert(alertBox, 'duplicate', `⚠️ UYARI: Bu Seri No (${barcode}) daha önce kaydedilmiş! (Sipariş: ${res.duplicate_info.siparis_no} - ${res.duplicate_info.kayit_tarihi}). Yine de arşivlendi.`);
            } else {
                playSuccessBeep();
                showAlert(alertBox, 'success', `✅ Seri No Kaydedildi ve Mühürlendi: ${barcode}`);
            }

            scanInput.value = '';
            scanInput.focus();
        } else {
            playWarningBuzzer();
            showAlert(alertBox, 'error', 'Hata: ' + (res.message || 'Kaydedilemedi'));
        }
    } catch (err) {
        playWarningBuzzer();
        showAlert(alertBox, 'error', 'Bağlantı hatası: ' + err.message);
    }
}

// ==========================================
// HIZLI SERBEST KAYIT
// ==========================================
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
    const barcode = scanInput.value.trim();
    const alertBox = document.getElementById('freeScanAlert');

    if (!barcode) {
        showAlert(alertBox, 'error', 'Lütfen geçerli bir barkod / seri no okutun!');
        return;
    }

    const kargoBarcode = document.getElementById('freeKargoBarcode')?.value.trim() || '';
    const orderNo = document.getElementById('freeOrderNo').value.trim();
    const customer = document.getElementById('freeCustomerName').value.trim();
    const product = document.getElementById('freeProductName').value.trim();
    const marketplace = document.getElementById('freeMarketplace').value;

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
                showAlert(alertBox, 'duplicate', `⚠️ MÜKERRER BARKOD: Bu Seri No (${barcode}) daha önce kaydedilmiş! (Tarih: ${res.duplicate_info.kayit_tarihi}). Kayıt mühürlendi.`);
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

// ==========================================
// ARAMA & KANIT ARŞİVİ
// ==========================================
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
            const q = document.getElementById('archiveSearchInput').value.trim();
            const start = document.getElementById('archiveStartDate').value;
            const end = document.getElementById('archiveEndDate').value;
            window.location.href = `/api/export-excel?q=${encodeURIComponent(q)}&start_date=${start}&end_date=${end}`;
        });
    }

    if (fullBackupBtn) {
        fullBackupBtn.addEventListener('click', () => {
            window.location.href = '/api/export-excel';
        });
    }

    // Modal Kapatma
    document.getElementById('btnCloseProofModal')?.addEventListener('click', () => {
        document.getElementById('proofModal').style.display = 'none';
    });
    document.getElementById('btnDismissProof')?.addEventListener('click', () => {
        document.getElementById('proofModal').style.display = 'none';
    });
    document.getElementById('btnPrintProof')?.addEventListener('click', () => {
        window.print();
    });
}

async function executeArchiveSearch() {
    const q = document.getElementById('archiveSearchInput').value.trim();
    const start = document.getElementById('archiveStartDate').value;
    const end = document.getElementById('archiveEndDate').value;
    const tbody = document.getElementById('searchResultsBody');
    const countSpan = document.getElementById('searchResultCount');

    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Aranıyor...</td></tr>';

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&start_date=${start}&end_date=${end}`);
        const res = await response.json();

        if (res.status === 'success') {
            countSpan.textContent = res.count;
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
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Arama hatası: ${err.message}</td></tr>`;
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

            document.getElementById('proofModal').style.display = 'flex';
        }
    } catch (err) {
        alert('Kanıt belgesi yüklenemedi: ' + err.message);
    }
};

// ==========================================
// KAMERA İLE TARAMA (HTML5-QRCODE)
// ==========================================
function initCameraScanner() {
    const btnOrder = document.getElementById('btnToggleCamOrder');
    const btnFree = document.getElementById('btnToggleCamFree');
    const closeBtn = document.getElementById('btnCloseCamModal');

    if (btnOrder) {
        btnOrder.addEventListener('click', () => startCameraScanner('order'));
    }
    if (btnFree) {
        btnFree.addEventListener('click', () => startCameraScanner('free'));
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', stopCameraScanner);
    }
}

function startCameraScanner(target) {
    activeCamTarget = target;
    const modal = document.getElementById('camModal');
    const statusText = document.getElementById('camStatusText');
    modal.style.display = 'flex';
    statusText.textContent = 'Kamera başlatılıyor, lütfen kameraya izin verin...';

    if (typeof Html5Qrcode === 'undefined') {
        statusText.textContent = 'Hata: Kamera kütüphanesi yüklenemedi. USB okuyucu kullanınız.';
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
    html5QrCode = new Html5Qrcode("cameraPreview");
    const config = { fps: 15, qrbox: { width: 280, height: 180 } };

    html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
            // Başarılı tarama
            stopCameraScanner();
            if (activeCamTarget === 'order') {
                const scanInput = document.getElementById('activeScanInput');
                if (scanInput) {
                    scanInput.value = decodedText;
                    processOrderScan(decodedText);
                }
            } else if (activeCamTarget === 'free') {
                const freeInput = document.getElementById('freeScanInput');
                if (freeInput) {
                    freeInput.value = decodedText;
                    executeFreeScan();
                }
            }
        },
        (errorMessage) => {
            // Her karede tarama denemesi (sessiz)
        }
    ).then(() => {
        statusText.textContent = 'Kamera aktif. Barkod veya seri numarasını kutu içine getirin.';
    }).catch(err => {
        statusText.textContent = 'Kamera erişim hatası: ' + err;
    });
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

// ==========================================
// YARDIMCI FONKSİYONLAR
// ==========================================
function showAlert(el, type, message) {
    if (!el) return;
    el.className = `scan-feedback-alert ${type}`;
    el.textContent = message;
    el.style.display = 'block';

    setTimeout(() => {
        if (el.className.includes(type)) {
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
