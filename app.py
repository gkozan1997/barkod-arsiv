from core_cloud_sync import (
    save_orders_to_cloud,
    get_orders_from_cloud,
    clear_orders_from_cloud,
    update_order_progress_cloud,
    remove_serial_from_cloud,
    update_serial_in_cloud,
    sync_db_with_cloud_archive,
    restore_scanned_status_from_archive,
)
import os
import io
import webbrowser
import threading
import secrets
import tempfile
from flask import Flask, render_template, request, jsonify, send_file
from core_db import IS_CLOUD, init_db, add_barcode_record, check_duplicate, search_records, get_stats, get_record_by_id, export_records_to_excel, save_active_orders_file, get_active_orders_file, clear_active_orders_file, delete_record_by_id, delete_record_by_barcode, update_record_by_id, update_record_by_barcode
from core_parser import parse_order_file

app = Flask(__name__)
app.config['SECRET_KEY'] = 'barkod-arsiv-secret-2026-key'
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024

PORT = 5004

try:
    init_db()
except Exception as e:
    print(f"DB başlatma: {e}")

def get_temp_upload_dir():
    if IS_CLOUD:
        temp_dir = os.path.join(tempfile.gettempdir(), 'temp_uploads')
    else:
        temp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'temp_uploads')
    os.makedirs(temp_dir, exist_ok=True)
    return temp_dir

@app.route('/')
def index():
    stats = get_stats()
    return render_template('index.html', stats=stats)

@app.route('/api/arsiv/load-recent-download', methods=['POST'])
@app.route('/api/load-recent-download', methods=['POST'])
def load_recent_download():
    """Yerelde İndirilenler klasöründeki en güncel pazaryeri veya e-ticaret web sipariş dosyasını otomatik yükler."""
    downloads_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
    if not os.path.exists(downloads_dir):
        return jsonify({'status': 'error', 'message': 'İndirilenler klasörü bulunamadı'}), 404

    recent_candidates = []
    for f in os.listdir(downloads_dir):
        if f.startswith('~') or f.startswith('.'):
            continue
        fl = f.lower()
        if not fl.endswith(('.xlsx', '.xls', '.csv')):
            continue
        # Sistem kendi ürettiği çıktı dosyalarını hariç tutar
        if any(fl.startswith(prefix) for prefix in ['barkod_serino_kayitlari_', 'urun_toplama_listesi_', 'beko_urun_toplama_']):
            continue
        fp = os.path.join(downloads_dir, f)
        try:
            mtime = os.path.getmtime(fp)
            recent_candidates.append((mtime, fp, f))
        except Exception:
            pass

    if not recent_candidates:
        return jsonify({'status': 'error', 'message': 'İndirilenler klasöründe sipariş dosyası bulunamadı'}), 404

    recent_candidates.sort(key=lambda x: x[0], reverse=True)

    # En son indirilen geçerli sipariş dosyasını otomatik tara ve bul
    selected_fp = None
    selected_name = None
    orders = []

    for _, fp, fname in recent_candidates[:10]:
        try:
            parsed = parse_order_file(fp)
            if parsed and len(parsed) > 0:
                selected_fp = fp
                selected_name = fname
                orders = parsed
                break
        except Exception:
            continue

    if not selected_fp or not orders:
        return jsonify({'status': 'error', 'message': 'İndirilenler klasöründe geçerli sipariş içeren dosya bulunamadı'}), 404

    try:
        try:
            orders = restore_scanned_status_from_archive(orders)
            save_active_orders_file(selected_name, orders)
            save_orders_to_cloud(selected_name, orders)
        except Exception as e:
            print(f"[ArsivRestore/CloudSync] Hata: {e}")
        return jsonify({
            'status': 'success',
            'filename': selected_name,
            'order_count': len(orders),
            'orders': orders
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Dosya işlenirken hata: {str(e)}'}), 500

@app.route('/api/arsiv/upload-orders', methods=['POST'])
@app.route('/api/upload-orders', methods=['POST'])
def upload_orders():
    # Coklu Excel yukleme destegi (files veya file listesi)
    raw_files = request.files.getlist('files')
    if not raw_files:
        raw_files = request.files.getlist('file')
    valid_files = [f for f in raw_files if f and getattr(f, 'filename', '').strip() != '']

    if not valid_files:
        return jsonify({'status': 'error', 'message': 'Hiçbir dosya seçilmedi veya dosya adı geçersiz'}), 400

    upload_dir = get_temp_upload_dir()
    saved_paths = []
    file_names = []

    try:
        all_packages_map = {}

        for f in valid_files:
            fname = f.filename
            file_names.append(fname)
            unique_name = f"{secrets.token_hex(4)}_{fname}"
            temp_path = os.path.join(upload_dir, unique_name)
            f.save(temp_path)
            saved_paths.append(temp_path)

            file_orders = parse_order_file(temp_path)
            for pkg in file_orders:
                key = pkg.get('kargo_barkodu') or pkg.get('siparis_no') or pkg.get('paket_no')
                if not key:
                    key = f"pkg_{len(all_packages_map)+1}"

                if key not in all_packages_map:
                    all_packages_map[key] = pkg
                else:
                    # Mükerrer/Aynı paket gelmişse ürün kalemlerini birleştir
                    existing = all_packages_map[key]
                    existing_items = existing.setdefault('urunler', [])
                    for item in pkg.get('urunler', []):
                        item_copy = dict(item)
                        item_copy['item_id'] = f"item_{len(existing_items) + 1}"
                        existing_items.append(item_copy)

        merged_orders = list(all_packages_map.values())

        if not merged_orders:
            return jsonify({'status': 'error', 'message': 'Seçilen dosyalarda uygun sipariş satırı tespit edilemedi'}), 400

        if len(file_names) == 1:
            summary_name = file_names[0]
        else:
            names_summary = ", ".join(file_names[:2])
            if len(file_names) > 2:
                names_summary += f" (+{len(file_names)-2} dosya)"
            summary_name = f"{len(file_names)} Dosya ({names_summary})"

        try:
            merged_orders = restore_scanned_status_from_archive(merged_orders)
            save_active_orders_file(summary_name, merged_orders)
            save_orders_to_cloud(summary_name, merged_orders)
        except Exception as e:
            print(f"[CloudSync] Hata: {e}")

        return jsonify({
            'status': 'success',
            'filename': summary_name,
            'file_count': len(file_names),
            'order_count': len(merged_orders),
            'orders': merged_orders
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Dosyalar işlenirken hata: {str(e)}'}), 500
    finally:
        for p in saved_paths:
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass

@app.route('/api/arsiv/record', methods=['POST'])
@app.route('/api/record', methods=['POST'])
def record_barcode():
    data = request.get_json() or {}
    barkod_seri_no = data.get('barkod_seri_no', '').strip()

    if not barkod_seri_no:
        return jsonify({'status': 'error', 'message': 'Barkod / Seri No boş olamaz'}), 400

    kargo_barkodu = data.get('kargo_barkodu', '').strip()
    siparis_no = data.get('siparis_no', '').strip()
    musteri_adi = data.get('musteri_adi', '').strip()
    urun_adi = data.get('urun_adi', '').strip()
    pazaryeri = data.get('pazaryeri', 'Bilinmiyor').strip()
    okutma_yontemi = data.get('okutma_yontemi', 'El Terminali')
    notlar = data.get('notlar', '').strip()

    try:
        update_order_progress_cloud(kargo_barkodu, barkod_seri_no)
    except Exception:
        pass

    record_data, is_dup, dup_info = add_barcode_record(
        kargo_barkodu=kargo_barkodu,
        siparis_no=siparis_no,
        musteri_adi=musteri_adi,
        urun_adi=urun_adi,
        barkod_seri_no=barkod_seri_no,
        pazaryeri=pazaryeri,
        okutma_yontemi=okutma_yontemi,
        notlar=notlar
    )

    stats = get_stats()

    return jsonify({
        'status': 'success',
        'record': record_data,
        'is_duplicate': is_dup,
        'duplicate_info': dup_info,
        'stats': {
            'toplam_kayit': stats['toplam_kayit'],
            'bugun_kayit': stats['bugun_kayit']
        }
    })

@app.route('/api/arsiv/check-duplicate', methods=['GET'])
@app.route('/api/check-duplicate', methods=['GET'])
def check_dup():
    barcode = request.args.get('barcode', '').strip()
    is_dup, dup_info = check_duplicate(barcode)
    return jsonify({
        'is_duplicate': is_dup,
        'duplicate_info': dup_info
    })

@app.route('/api/arsiv/search', methods=['GET'])
@app.route('/api/search', methods=['GET'])
def search():
    query = request.args.get('q', '').strip()
    start_date = request.args.get('start_date', '').strip()
    end_date = request.args.get('end_date', '').strip()

    records = search_records(query=query, start_date=start_date, end_date=end_date, limit=200)
    return jsonify({
        'status': 'success',
        'count': len(records),
        'records': records
    })

@app.route('/api/arsiv/stats', methods=['GET'])
@app.route('/api/stats', methods=['GET'])
def api_stats():
    return jsonify(get_stats())

@app.route('/api/arsiv/export-excel', methods=['GET'])
@app.route('/api/export-excel', methods=['GET'])
def export_excel():
    query = request.args.get('q', '').strip()
    start_date = request.args.get('start_date', '').strip()
    end_date = request.args.get('end_date', '').strip()

    records = search_records(query=query, start_date=start_date, end_date=end_date, limit=5000)
    wb = export_records_to_excel(records)

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)

    filename = f"Barkod_SeriNo_Kayitlari_{get_stats()['bugun_tarih']}.xlsx"
    return send_file(
        out,
        as_attachment=True,
        download_name=filename,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

@app.route('/api/arsiv/proof/<int:record_id>', methods=['GET'])
@app.route('/api/proof/<int:record_id>', methods=['GET'])
def get_proof(record_id):
    record = get_record_by_id(record_id)
    if not record:
        return jsonify({'status': 'error', 'message': 'Kayıt bulunamadı'}), 404
    return jsonify({'status': 'success', 'record': record})



@app.route('/api/arsiv/delete-record/<int:record_id>', methods=['POST', 'DELETE'])
@app.route('/api/delete-record/<int:record_id>', methods=['POST', 'DELETE'])
def delete_record_route(record_id):
    success, msg = delete_record_by_id(record_id)
    if not success:
        return jsonify({'status': 'error', 'message': msg}), 400
    stats = get_stats()
    return jsonify({
        'status': 'success',
        'message': 'Kayıt başarıyla silindi',
        'stats': {
            'toplam_kayit': stats['toplam_kayit'],
            'bugun_kayit': stats['bugun_kayit']
        }
    })

@app.route('/api/arsiv/delete-record-by-barcode', methods=['POST'])
@app.route('/api/delete-record-by-barcode', methods=['POST'])
@app.route('/api/arsiv/remove-barcode', methods=['POST'])
@app.route('/api/remove-barcode', methods=['POST'])
def remove_barcode_route():
    data = request.get_json() or {}
    barkod_seri_no = data.get('barkod_seri_no', '').strip()
    kargo_barkodu = data.get('kargo_barkodu', '').strip()
    siparis_no = data.get('siparis_no', '').strip()

    if not barkod_seri_no:
        return jsonify({'status': 'error', 'message': 'Barkod / Seri No boş olamaz'}), 400

    try:
        remove_serial_from_cloud(kargo_barkodu, barkod_seri_no)
    except Exception:
        pass

    success, msg = delete_record_by_barcode(barkod_seri_no, kargo_barkodu=kargo_barkodu, siparis_no=siparis_no)
    stats = get_stats()
    return jsonify({
        'status': 'success',
        'message': msg,
        'stats': {
            'toplam_kayit': stats['toplam_kayit'],
            'bugun_kayit': stats['bugun_kayit']
        }
    })

@app.route('/api/arsiv/update-record/<int:record_id>', methods=['POST', 'PUT'])
@app.route('/api/update-record/<int:record_id>', methods=['POST', 'PUT'])
def update_record_route(record_id):
    data = request.get_json() or {}
    success, msg = update_record_by_id(record_id, data)
    if not success:
        return jsonify({'status': 'error', 'message': msg}), 400
    rec = get_record_by_id(record_id)
    return jsonify({
        'status': 'success',
        'message': 'Kayıt güncellendi',
        'record': rec
    })

@app.route('/api/arsiv/update-barcode', methods=['POST'])
@app.route('/api/update-barcode', methods=['POST'])
def update_barcode_route():
    data = request.get_json() or {}
    old_sn = data.get('old_barkod_seri_no', '').strip()
    new_sn = data.get('new_barkod_seri_no', '').strip()
    kargo_barkodu = data.get('kargo_barkodu', '').strip()
    siparis_no = data.get('siparis_no', '').strip()

    if not old_sn or not new_sn:
        return jsonify({'status': 'error', 'message': 'Eski ve yeni barkod belirtilmelidir'}), 400

    try:
        update_serial_in_cloud(kargo_barkodu, old_sn, new_sn)
    except Exception:
        pass

    success, msg = update_record_by_barcode(old_sn, new_sn, kargo_barkodu=kargo_barkodu, siparis_no=siparis_no)
    return jsonify({'status': 'success', 'message': msg})

@app.route('/api/arsiv/get-current-orders', methods=['GET'])
@app.route('/api/get-current-orders', methods=['GET'])
def get_current_orders():
    data = get_orders_from_cloud() or get_active_orders_file()
    if data and data.get('orders'):
        return jsonify({
            'status': 'success',
            'filename': data.get('filename', 'Aktif Siparisler'),
            'updated_at': data.get('updated_at', ''),
            'order_count': len(data.get('orders', [])),
            'orders': data.get('orders', [])
        })
    return jsonify({'status': 'empty', 'message': 'Kayitli aktif siparis bulunmuyor', 'orders': []})

@app.route('/api/arsiv/clear-current-orders', methods=['POST'])
@app.route('/api/clear-current-orders', methods=['POST'])
def clear_current_orders():
    clear_active_orders_file()
    try:
        clear_orders_from_cloud()
    except Exception:
        pass
    return jsonify({'status': 'success', 'message': 'Aktif siparis listesi temizlendi'})

def open_browser():
    webbrowser.open(f'http://127.0.0.1:{PORT}')


@app.route('/api/arsiv/sync-cloud', methods=['POST'])
@app.route('/api/sync-cloud', methods=['POST'])
def sync_cloud():
    """Tüm cihazlarda arşiv kayıtlarını ve aktif siparişleri anlık olarak GitHub bulutla eşitler."""
    try:
        res = sync_db_with_cloud_archive()
        cloud_orders = get_orders_from_cloud(force_refresh=True)
        stats = get_stats()
        return jsonify({
            'status': 'success',
            'message': 'Bulut arşiv senkronizasyonu tamamlandı',
            'sync_result': res,
            'active_orders': cloud_orders,
            'stats': stats
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Bulut senkronizasyon hatası: {str(e)}'}), 500

if __name__ == '__main__':
    threading.Timer(1.2, open_browser).start()
    print(f"\n=======================================================")
    print(f" [OK] BARKOD & SERI NO ARSIVLEME PANELI AKTIF")
    print(f" Adres: http://127.0.0.1:{PORT}")
    print(f"=======================================================\n")
    app.run(host='127.0.0.1', port=PORT, debug=True)
