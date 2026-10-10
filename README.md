# 🛡️ Barkod & Seri No Arşivleme Paneli

Bu sistem, e-ticaret ve depo çıkışlarında müşteriye giden ürünlerin barkod ve seri numaralarını (SN / IMEI) kayıt altına alarak **kaybolmayı, itirazları ve yanlış ürün iddialarını kesin olarak önlemek** için tasarlanmıştır.

---

## 🚀 Hızlı Başlangıç
1. `baslat.bat` dosyasına çift tıklayarak sistemi başlatabilirsiniz.
2. Web arayüzü otomatik olarak açılır: **http://127.0.0.1:5004**
3. `PROJLERİM/PROJELERI_BASLAT_MENUSU.bat` içerisinden **[4]** seçeneği ile de tek tıkla çalıştırabilirsiniz.

---

## 🔒 Çift Katmanlı Sıfır Kayıp Güvenliği
Barkodların silinmesini veya kaybolmasını engellemek için çift katmanlı mimari kullanılmıştır:
1. **1. Katman (SQLite Veritabanı):** `data/barkod_arsiv.db` içerisine anında atomik işlemle diske yazılır.
2. **2. Katman (Günlük JSON/Excel Yedeği):** `data/arsiv_gunluk/YYYY-MM-DD.json` dosyasına her taramada anında eklenir. Elektrik kesintisi veya sistem kapanmasında bile tek bir satır dahi kaybolmaz.

---

## 🎯 Temel Özellikler
1. **📦 Sipariş Listesiyle Eşleme (Mod A):**
   - Trendyol, Hepsiburada, Amazon, Çiçeksepeti, Pazarama vb. Excel sipariş listesini sürükleyip bırakın.
   - Sipariş seçildiğinde pakete girecek ürünler ekranda listelenir.
   - Seri no okutulduğunda ürün anında doğrulanır, yeşil onay tınısı çalar ve kayıt mühürlenir.
2. **⚡ Hızlı Serbest Kayıt (Mod B):**
   - Excel yüklemeden, anlık gelen paketler için doğrudan Sipariş No / Müşteri Adı yazıp seri no okutarak kaydetme.
3. **🔍 Arama & Kanıt Arşivi:**
   - İade veya itiraz durumunda Seri No, Sipariş No veya Müşteri Adı ile anında geçmiş tarama.
   - **Resmi Kanıt Belgesi:** Tek tıkla yazdırılabilir veya PDF olarak pazaryerine/müşteriye sunulabilir tarih/saat damgalı çıkış belgesi.
   - **Excel Dökümü:** Tüm kayıtları veya filtrelenen sonuçları tek tıkla Excel formatında indirme.
4. **🔊 Sesli ve Görsel İkaz:**
   - Başarılı okutmada iki tonlu yeşil onay sesi.
   - Mükerrer / daha önce kaydedilmiş barkod okutulduğunda sesli ikaz ve uyarı kartı.
5. **📷 Kamera & El Terminali Desteği:**
   - Kablolu/kablosuz USB el terminali (otomatik odaklı hızlı okuma).
   - Cep telefonu veya bilgisayar kamerasıyla canlı tarama.

---

## 📁 Klasör Yapısı
- `app.py`: Flask ana sunucu dosyası (Port: 5004)
- `core_db.py`: SQLite veritabanı, mükerrer kontrolü ve Excel/JSON yedekleme motoru
- `core_parser.py`: Pazaryeri Excel sipariş dosyalarını otomatik sütun algılayıcı motor
- `data/`: Veritabanı ve günlük arşiv klasörleri
- `templates/`: HTML arayüz dosyaları
- `static/`: CSS ve JS dosyaları
- `baslat.bat`: Tek tıkla port temizliği ve başlatıcı
