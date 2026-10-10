import os
import io
import webbrowser
import threading
import secrets
from flask import Flask, render_template, request, jsonify, send_file
from core_db import init_db, add_barcode_record, check_duplicate, search_records, get_stats, get_record_by_id, export_records_to_excel
from core_parser import parse_order_file

app = Flask(__name__)
app.config['SECRET_KEY'] = 'barkod-arsiv-secret-2026-key'

PORT = 5004

# DB Başlat
init_db()

TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'temp_uploads')
os.makedirs(TEMP_DIR, exist_ok=True)

@app.route('/')
def index():
    stats = get_stats()
    return render_template('index.html', stats=stats)

@app.route('/api/upload-orders', methods=['POST'])
def upload_orders():
    """Pazaryeri Excel sipariş listesini yükler ve parse eder."""
    if 'file' not in request.files:
        return jsonify({'status': 'error', 'message': 'Dosya seçilmedi'}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({'status': 'error', 'message': 'Dosya adı geçersiz'}), 400

    unique_name = f"{secrets.token_hex(4)}_{file.filename}"
    temp_path = os.path.join(TEMP_DIR, unique_name)
    file.save(temp_path)

    try:
        orders = parse_order_file(temp_path)
        return jsonify({
            'status': 'success',
            'filename': file.filename,
            'order_count': len(orders),
            'orders': orders
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Dosya işlenirken hata: {str(e)}'}), 500
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

@app.route('/api/record', methods=['POST'])
def record_barcode():
    """
    Barkod / Seri no kaydeder.
    Girdi: { siparis_no, musteri_adi, urun_adi, barkod_seri_no, pazaryeri, okutma_yontemi, notlar }
    """
    data = request.get_json() or {}
    barkod_seri_no = data.get('barkod_seri_no', '').strip()

    if not barkod_seri_no:
        return jsonify({'status': 'error', 'message': 'Barkod / Seri No boş olamaz'}), 400

    siparis_no = data.get('siparis_no', '').strip()
    musteri_adi = data.get('musteri_adi', '').strip()
    urun_adi = data.get('urun_adi', '').strip()
    pazaryeri = data.get('pazaryeri', 'Bilinmiyor').strip()
    okutma_yontemi = data.get('okutma_yontemi', 'El Terminali')
    notlar = data.get('notlar', '').strip()

    record_data, is_dup, dup_info = add_barcode_record(
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

@app.route('/api/check-duplicate', methods=['GET'])
def check_dup():
    barcode = request.args.get('barcode', '').strip()
    is_dup, dup_info = check_duplicate(barcode)
    return jsonify({
        'is_duplicate': is_dup,
        'duplicate_info': dup_info
    })

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

@app.route('/api/stats', methods=['GET'])
def api_stats():
    return jsonify(get_stats())

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

@app.route('/api/proof/<int:record_id>', methods=['GET'])
def get_proof(record_id):
    record = get_record_by_id(record_id)
    if not record:
        return jsonify({'status': 'error', 'message': 'Kayıt bulunamadı'}), 404
    return jsonify({'status': 'success', 'record': record})

def open_browser():
    webbrowser.open(f'http://127.0.0.1:{PORT}')

if __name__ == '__main__':
    threading.Timer(1.2, open_browser).start()
    print(f"\n=======================================================")
    print(f" [OK] BARKOD & SERI NO ARSIVLEME PANELI AKTIF")
    print(f" Adres: http://127.0.0.1:{PORT}")
    print(f"=======================================================\n")
    app.run(host='127.0.0.1', port=PORT, debug=True)
