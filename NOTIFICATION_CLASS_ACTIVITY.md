# Notifikasi Aktivitas Kelas - Dokumentasi

## Overview
Fitur notifikasi yang akan mengirimkan notifikasi push ke wali murid ketika guru menambahkan aktivitas kelas baru (tugas, PR, ujian, materi, dll).

## Implementasi Backend

### 1. Helper Functions (index.js, line ~5825-5959)

#### `sendClassActivityNotification(activityData, authHeader)`
Fungsi utama untuk mengirim notifikasi aktivitas kelas ke wali murid.

**Parameter:**
- `activityData`: Object berisi data aktivitas kelas
  - `kegiatan_id`: ID kegiatan
  - `kelas_id`: ID kelas
  - `judul`: Judul aktivitas
  - `deskripsi`: Deskripsi aktivitas
  - `jenis`: Jenis aktivitas (tugas, pr, ujian, materi, pengumuman, kegiatan)
  - `target`: Target siswa (umum/khusus)
  - `mata_pelajaran`: Nama mata pelajaran
  - `guru_nama`: Nama guru
  - `tanggal`: Tanggal aktivitas
  - `siswa_target`: Array ID siswa (untuk target khusus)

**Proses:**
1. Mendapatkan daftar siswa berdasarkan target (umum = semua siswa di kelas, khusus = siswa tertentu)
2. Loop untuk setiap siswa:
   - Mendapatkan data wali murid dari siswa
   - Mengambil FCM tokens wali yang aktif
   - Mengirim notifikasi push
   - Menyimpan ke tabel notifications
3. Return success dengan jumlah notifikasi yang terkirim

#### `getActivityTitle(jenis)`
Menghasilkan title notifikasi berdasarkan jenis aktivitas:
- `tugas` → 📝 Tugas Baru
- `pr` → 📚 PR Baru
- `ujian` → 📋 Ujian
- `materi` → 📖 Materi Baru
- `pengumuman` → 📢 Pengumuman
- `kegiatan` → 🎯 Kegiatan Baru

#### `getActivityBody(jenis, judul, mataPelajaran, siswaNama)`
Menghasilkan body notifikasi dengan format:
```
{siswaNama} mendapat {jenisText} "{judul}" untuk mata pelajaran {mataPelajaran}
```

### 2. Integrasi ke Endpoint POST /api/kegiatan (line ~10841-10879)

Setelah kegiatan berhasil dibuat dan di-commit:
1. Query data lengkap kegiatan (join dengan mata_pelajaran dan users)
2. Siapkan data notifikasi
3. Panggil `sendClassActivityNotification()` secara async (tidak mengganggu response)
4. Error notifikasi tidak akan mempengaruhi pembuatan kegiatan

**Contoh Log:**
```
Kegiatan berhasil ditambahkan: {id}
Mengirim notifikasi aktivitas kelas: {...}
Notifikasi aktivitas kelas berhasil dikirim ke wali: {nama_wali} untuk siswa: {nama_siswa}
```

## Implementasi Flutter

### 1. FCM Service Update (fcm_service.dart, line ~233-240)

Handler untuk notifikasi tap ditambahkan:
```dart
else if (type == 'class_activity') {
  // Navigate to class activity screen
  if (kDebugMode) {
    print('Navigate to class activity for kegiatan: ${data['kegiatan_id']}');
    print('Student: ${data['siswa_nama']}, Subject: ${data['mata_pelajaran']}');
  }
}
```

### 2. Notification Data Structure

Data yang dikirim ke FCM:
```json
{
  "type": "class_activity",
  "kegiatan_id": "uuid",
  "siswa_id": "uuid",
  "siswa_nama": "Nama Siswa",
  "kelas_id": "uuid",
  "judul": "Judul Aktivitas",
  "deskripsi": "Deskripsi",
  "jenis": "tugas|pr|ujian|materi|pengumuman|kegiatan",
  "target": "umum|khusus",
  "mata_pelajaran": "Nama Mapel",
  "guru_nama": "Nama Guru",
  "tanggal": "2025-11-12",
  "timestamp": "2025-11-12T06:00:00.000Z"
}
```

## Cara Testing

### 1. Setup
```bash
# Pastikan backend berjalan
cd /Users/macbook/development/projects/non-FCM/backendfromnonfcm
node index.js

# Pastikan Flutter app terhubung ke backend
cd /Users/macbook/development/projects/non-FCM/manajemennonfcm
flutter run
```

### 2. Test Flow
1. Login sebagai **Guru** di Flutter app
2. Buka menu **Class Activity / Kegiatan Kelas**
3. Tambahkan aktivitas baru:
   - Pilih mata pelajaran
   - Pilih kelas
   - Isi judul (contoh: "Tugas Matematika Bab 5")
   - Pilih jenis (contoh: "Tugas")
   - Pilih target:
     - **Umum**: Notifikasi terkirim ke semua wali murid di kelas
     - **Khusus**: Pilih siswa tertentu, notifikasi hanya ke wali mereka
   - Submit

4. Login sebagai **Wali Murid** di device lain atau logout dan login kembali
5. Cek notifikasi push yang masuk
6. Tap notifikasi untuk melihat detail (akan di-log ke console)

### 3. Verifikasi Backend
```bash
# Check logs backend
# Seharusnya muncul:
Kegiatan berhasil ditambahkan: {kegiatan_id}
Mengirim notifikasi aktivitas kelas: {...}
Notifikasi aktivitas kelas berhasil dikirim ke wali: {nama_wali} untuk siswa: {nama_siswa}
```

### 4. Verifikasi Database
```sql
-- Cek data kegiatan
SELECT * FROM kegiatan_kelas ORDER BY created_at DESC LIMIT 1;

-- Cek notifikasi yang tersimpan
SELECT * FROM notifications WHERE type = 'class_activity' ORDER BY created_at DESC LIMIT 10;

-- Cek FCM tokens wali
SELECT u.nama, u.email, COUNT(f.id) as token_count
FROM users u
LEFT JOIN fcm_tokens f ON u.id = f.user_id AND f.is_active = 1
WHERE u.role = 'wali'
GROUP BY u.id;
```

## Troubleshooting

### Notifikasi tidak terkirim
1. **Cek FCM token wali**
   ```sql
   SELECT * FROM fcm_tokens WHERE user_id = '{wali_user_id}' AND is_active = 1;
   ```
   Pastikan wali memiliki token aktif.

2. **Cek relasi siswa-wali**
   ```sql
   SELECT u.nama as wali_nama, s.nama as siswa_nama
   FROM users u
   JOIN siswa s ON u.siswa_id = s.id
   WHERE u.role = 'wali';
   ```
   Pastikan field `siswa_id` di tabel `users` terisi dengan benar.

3. **Cek log backend**
   - `User wali tidak ditemukan untuk siswa: {nama}` → Relasi siswa-wali tidak ada
   - `Tidak ada token aktif untuk wali: {nama}` → Wali belum login atau token expired

### Error di backend
- Pastikan Firebase Admin SDK terkonfigurasi dengan benar
- Cek `serviceAccountKey.json` sesuai dengan project Firebase yang digunakan Flutter app
- Pastikan tabel `notifications` sudah ada di database

## Database Schema

### Tabel: notifications
```sql
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  data JSON,
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_user_id (user_id),
  INDEX idx_type (type),
  INDEX idx_is_read (is_read),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```

## Future Enhancements

1. **Notification History Screen**
   - Tampilkan riwayat notifikasi di Flutter app
   - Mark as read functionality
   - Filter by type

2. **Notification Preferences**
   - Wali bisa memilih jenis notifikasi yang ingin diterima
   - Silent mode / Do not disturb schedule

3. **Batch Notifications**
   - Digest notification (ringkasan harian/mingguan)
   - Smart grouping untuk multiple notifications

4. **Rich Notifications**
   - Action buttons (lihat detail, tandai selesai)
   - Images/attachments preview
   - Priority levels

## Testing Checklist

- [ ] Guru berhasil menambahkan aktivitas kelas
- [ ] Backend log menunjukkan notifikasi terkirim
- [ ] Wali menerima push notification
- [ ] Title dan body notifikasi sesuai dengan jenis aktivitas
- [ ] Data notifikasi tersimpan di tabel notifications
- [ ] Tap notification menampilkan log yang benar
- [ ] Target khusus hanya mengirim ke wali siswa tertentu
- [ ] Target umum mengirim ke semua wali di kelas
- [ ] Error notifikasi tidak mengganggu pembuatan kegiatan
