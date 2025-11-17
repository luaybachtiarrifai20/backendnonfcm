# Notifikasi Pengumuman - Dokumentasi

## Overview
Fitur notifikasi yang akan mengirimkan notifikasi push ke wali murid, guru, dan/atau siswa ketika admin membuat pengumuman baru.

## Fitur Utama

### 1. Target Role yang Fleksibel
Pengumuman dapat ditargetkan ke:
- **Wali Murid** saja
- **Guru** saja
- **Siswa** saja
- **All** (semua role)

### 2. Filter Kelas
- **Tanpa Kelas**: Notifikasi terkirim ke semua users sesuai role di sekolah
- **Dengan Kelas Spesifik**: Notifikasi hanya ke users yang terkait dengan kelas tersebut
  - Wali: yang anaknya di kelas tersebut
  - Guru: yang mengajar di kelas tersebut
  - Siswa: yang berada di kelas tersebut

### 3. Priority Level
- **🚨 Urgent**: PENGUMUMAN PENTING
- **⚠️ Penting**: Pengumuman Penting
- **📢 Biasa**: Pengumuman

## Implementasi Backend

### 1. Helper Functions (index.js, line ~6001-6195)

#### `sendPengumumanNotification(pengumumanData, authHeader)`
Fungsi utama untuk mengirim notifikasi pengumuman.

**Parameter:**
- `pengumumanData`: Object berisi data pengumuman
  - `pengumuman_id`: ID pengumuman
  - `judul`: Judul pengumuman
  - `konten`: Konten pengumuman
  - `kelas_id`: ID kelas (optional)
  - `kelas_nama`: Nama kelas (optional)
  - `role_target`: Target role (wali/guru/siswa/all)
  - `prioritas`: Level prioritas (urgent/penting/biasa)
  - `pembuat_nama`: Nama pembuat pengumuman
  - `sekolah_id`: ID sekolah

**Proses:**
1. Query target users berdasarkan `role_target` dan `kelas_id`
   - Jika `role_target = 'wali'`: Ambil semua wali murid
   - Jika `role_target = 'guru'`: Ambil semua guru
   - Jika `role_target = 'siswa'`: Ambil semua siswa (yang punya user account)
   - Jika `role_target = 'all'`: Ambil semua role
   
2. Filter berdasarkan kelas (jika ada):
   - Wali: Filter yang anaknya di kelas tersebut
   - Guru: Filter yang mengajar di kelas tersebut (dari tabel jadwal)
   - Siswa: Filter yang berada di kelas tersebut

3. Loop untuk setiap target user:
   - Ambil FCM tokens yang aktif
   - Kirim notifikasi push
   - Simpan ke tabel notifications

4. Return statistics: success count, failed count, total targets

#### `getPengumumanTitle(prioritas)`
Menghasilkan title notifikasi berdasarkan prioritas:
- `urgent` → 🚨 PENGUMUMAN PENTING
- `penting` → ⚠️ Pengumuman Penting
- `biasa` → 📢 Pengumuman

#### `getPengumumanBody(judul, kelasNama)`
Menghasilkan body notifikasi:
- Dengan kelas: `{judul} - Kelas {kelasNama}`
- Tanpa kelas: `{judul}`

### 2. Integrasi ke Endpoint POST /api/pengumuman (line ~10647-10699)

Setelah pengumuman berhasil dibuat:
1. Send response ke client
2. Query data lengkap pengumuman (join dengan kelas dan users)
3. Siapkan data notifikasi
4. Panggil `sendPengumumanNotification()` secara async
5. Log hasil pengiriman

**Contoh Log:**
```
Pengumuman berhasil ditambahkan: {id}
📢 Mengirim notifikasi pengumuman: {...}
📢 Target pengumuman: 15 users (all)
✅ Pengumuman terkirim ke wali: Ibu Sarah
✅ Pengumuman terkirim ke guru: Pak Budi
📊 Pengumuman: 14 berhasil, 1 gagal dari 15 target
✅ Pengumuman berhasil dikirim ke 14 dari 15 target users
```

## Implementasi Flutter

### 1. FCM Service Update (fcm_service.dart, line ~284-292)

Handler untuk notifikasi tap ditambahkan:
```dart
else if (type == 'pengumuman') {
  // Navigate to announcement screen
  if (kDebugMode) {
    print('Navigate to pengumuman: ${data['pengumuman_id']}');
    print('Title: ${data['judul']}, Priority: ${data['prioritas']}');
    print('Target: ${data['role_target']}, Class: ${data['kelas_nama']}');
  }
}
```

### 2. Notification Data Structure

Data yang dikirim ke FCM:
```json
{
  "type": "pengumuman",
  "pengumuman_id": "uuid",
  "judul": "Judul Pengumuman",
  "konten": "Konten pengumuman (truncated 200 chars)",
  "kelas_id": "uuid atau empty",
  "kelas_nama": "Nama Kelas atau empty",
  "role_target": "wali|guru|siswa|all",
  "prioritas": "urgent|penting|biasa",
  "pembuat_nama": "Nama Admin",
  "timestamp": "2025-11-13T09:00:00.000Z"
}
```

## Contoh Penggunaan

### Skenario 1: Pengumuman untuk Semua Wali Murid di Sekolah

**Input:**
```json
{
  "judul": "Rapat Orang Tua Murid",
  "konten": "Akan diadakan rapat orang tua murid pada tanggal 20 November 2025",
  "role_target": "wali",
  "prioritas": "penting",
  "kelas_id": null
}
```

**Hasil:**
- Semua wali murid di sekolah menerima notifikasi
- Title: ⚠️ Pengumuman Penting
- Body: Rapat Orang Tua Murid

### Skenario 2: Pengumuman Urgent untuk Kelas Tertentu (Semua Role)

**Input:**
```json
{
  "judul": "Libur Kelas 7A",
  "konten": "Kelas 7A libur hari ini karena guru berhalangan",
  "role_target": "all",
  "prioritas": "urgent",
  "kelas_id": "kelas-7a-id"
}
```

**Hasil:**
- Wali murid yang anaknya di kelas 7A menerima notifikasi
- Guru yang mengajar di kelas 7A menerima notifikasi
- Siswa di kelas 7A (yang punya account) menerima notifikasi
- Title: 🚨 PENGUMUMAN PENTING
- Body: Libur Kelas 7A - Kelas 7A

### Skenario 3: Pengumuman Biasa untuk Semua Guru

**Input:**
```json
{
  "judul": "Rapat Guru Bulanan",
  "konten": "Rapat koordinasi guru akan dilaksanakan Jumat depan",
  "role_target": "guru",
  "prioritas": "biasa",
  "kelas_id": null
}
```

**Hasil:**
- Semua guru di sekolah menerima notifikasi
- Title: 📢 Pengumuman
- Body: Rapat Guru Bulanan

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

**A. Test Pengumuman untuk Wali Murid:**
1. Login sebagai **Admin** di Flutter app
2. Buka menu **Pengumuman**
3. Tambahkan pengumuman baru:
   - Judul: "Test Notifikasi Wali"
   - Konten: "Ini adalah test pengumuman untuk wali murid"
   - Target: **Wali**
   - Prioritas: **Penting**
   - Kelas: (kosongkan atau pilih kelas tertentu)
   - Submit

4. Cek log backend
5. Login sebagai **Wali Murid** di device lain
6. Seharusnya ada notifikasi push yang muncul

**B. Test Pengumuman untuk Semua Role:**
1. Login sebagai **Admin**
2. Tambahkan pengumuman:
   - Target: **All**
   - Pilih kelas tertentu
3. Cek bahwa wali, guru, dan siswa yang terkait kelas tersebut menerima notifikasi

### 3. Verifikasi Backend

```bash
# Check logs backend
# Seharusnya muncul:
Pengumuman berhasil ditambahkan: {pengumuman_id}
📢 Mengirim notifikasi pengumuman: {...}
📢 Target pengumuman: {N} users ({role_target})
✅ Pengumuman terkirim ke {role}: {nama}
📊 Pengumuman: {success} berhasil, {fail} gagal dari {total} target
```

### 4. Verifikasi Database

```sql
-- Cek pengumuman terbaru
SELECT * FROM pengumuman ORDER BY created_at DESC LIMIT 1;

-- Cek notifikasi yang tersimpan
SELECT 
  n.title,
  n.body,
  u.nama as penerima,
  u.role,
  n.created_at
FROM notifications n
JOIN users u ON n.user_id = u.id
WHERE n.type = 'pengumuman'
ORDER BY n.created_at DESC
LIMIT 20;

-- Summary: Berapa notifikasi terkirim per role
SELECT 
  u.role,
  COUNT(*) as total_notifications
FROM notifications n
JOIN users u ON n.user_id = u.id
WHERE n.type = 'pengumuman'
  AND DATE(n.created_at) = CURDATE()
GROUP BY u.role;
```

## Troubleshooting

### Notifikasi tidak terkirim
1. **Cek target users**
   ```sql
   -- Untuk role wali
   SELECT COUNT(*) FROM users WHERE role = 'wali' AND sekolah_id = 'YOUR_SEKOLAH_ID';
   
   -- Wali dengan FCM token aktif
   SELECT COUNT(DISTINCT u.id) 
   FROM users u
   JOIN fcm_tokens f ON u.id = f.user_id AND f.is_active = 1
   WHERE u.role = 'wali' AND u.sekolah_id = 'YOUR_SEKOLAH_ID';
   ```

2. **Cek relasi kelas**
   - Pastikan `kelas_id` valid
   - Pastikan ada siswa/guru di kelas tersebut

3. **Cek log backend**
   - `Tidak ada target user untuk pengumuman` → role_target atau kelas tidak ada data
   - `Tidak ada token aktif untuk {role}: {nama}` → User belum login atau token expired

### Error di backend
- Pastikan tabel `notifications` sudah dibuat
- Pastikan tabel `jadwal` ada untuk filter guru berdasarkan kelas
- Cek FCM token valid (tidak ada SenderId mismatch)

## Query Debugging

```sql
-- 1. Cek wali murid berdasarkan kelas
SELECT 
  u.id, u.nama, u.email,
  s.nama as anak_nama, s.kelas_id,
  k.nama as kelas_nama
FROM users u
JOIN siswa s ON u.siswa_id = s.id
JOIN kelas k ON s.kelas_id = k.id
WHERE u.role = 'wali' 
  AND s.kelas_id = 'YOUR_KELAS_ID';

-- 2. Cek guru yang mengajar di kelas tertentu
SELECT DISTINCT
  u.id, u.nama, u.email,
  k.nama as kelas_nama
FROM users u
JOIN jadwal j ON u.id = j.guru_id
JOIN kelas k ON j.kelas_id = k.id
WHERE u.role = 'guru'
  AND j.kelas_id = 'YOUR_KELAS_ID';

-- 3. Cek siswa di kelas tertentu (yang punya user account)
SELECT 
  u.id, u.nama, u.email,
  s.nama as siswa_nama,
  k.nama as kelas_nama
FROM users u
JOIN siswa s ON u.siswa_id = s.id
JOIN kelas k ON s.kelas_id = k.id
WHERE u.role = 'siswa'
  AND s.kelas_id = 'YOUR_KELAS_ID';

-- 4. Test query untuk semua role tanpa filter kelas
SELECT 
  u.role,
  COUNT(*) as total_users,
  COUNT(DISTINCT f.user_id) as users_with_token
FROM users u
LEFT JOIN fcm_tokens f ON u.id = f.user_id AND f.is_active = 1
WHERE u.sekolah_id = 'YOUR_SEKOLAH_ID'
  AND u.role IN ('wali', 'guru', 'siswa')
GROUP BY u.role;
```

## Testing Matrix

| # | Kondisi | Expected Result | Status |
|---|---------|----------------|--------|
| 1 | Pengumuman target wali, tanpa kelas | Semua wali di sekolah dapat notifikasi | ⬜ |
| 2 | Pengumuman target wali, dengan kelas | Hanya wali yang anaknya di kelas tersebut | ⬜ |
| 3 | Pengumuman target guru, tanpa kelas | Semua guru di sekolah dapat notifikasi | ⬜ |
| 4 | Pengumuman target guru, dengan kelas | Hanya guru yang mengajar di kelas tersebut | ⬜ |
| 5 | Pengumuman target all, dengan kelas | Wali+guru+siswa yang terkait kelas | ⬜ |
| 6 | Pengumuman prioritas urgent | Title: 🚨 PENGUMUMAN PENTING | ⬜ |
| 7 | Pengumuman prioritas penting | Title: ⚠️ Pengumuman Penting | ⬜ |
| 8 | Pengumuman prioritas biasa | Title: 📢 Pengumuman | ⬜ |
| 9 | Tap notifikasi di HP | Log muncul dengan detail lengkap | ⬜ |
| 10 | Cek database notifications | Data tersimpan dengan benar | ⬜ |

## Monitoring

**Query untuk monitoring:**

```sql
-- Statistik pengumuman hari ini
SELECT 
  COUNT(DISTINCT n.id) as total_pengumuman_notifications,
  COUNT(DISTINCT n.user_id) as unique_recipients,
  u.role,
  COUNT(*) as notifications_per_role
FROM notifications n
JOIN users u ON n.user_id = u.id
WHERE n.type = 'pengumuman'
  AND DATE(n.created_at) = CURDATE()
GROUP BY u.role;

-- Pengumuman dengan notifikasi terbanyak
SELECT 
  p.judul,
  p.role_target,
  k.nama as kelas_nama,
  COUNT(n.id) as total_sent,
  p.created_at
FROM pengumuman p
LEFT JOIN kelas k ON p.kelas_id = k.id
LEFT JOIN notifications n ON JSON_EXTRACT(n.data, '$.pengumuman_id') = p.id
WHERE DATE(p.created_at) = CURDATE()
GROUP BY p.id
ORDER BY total_sent DESC;
```

## Catatan Penting

⚠️ **Backend HARUS direstart** setelah perubahan kode  
⚠️ **Tabel notifications HARUS ada** di database  
⚠️ **Users HARUS login** untuk generate FCM token  
⚠️ **Tabel jadwal** diperlukan untuk filter guru berdasarkan kelas  

## Future Enhancements

1. **Scheduling**: Kirim pengumuman di waktu tertentu
2. **Rich Content**: Support gambar, attachment
3. **Read Confirmation**: Track siapa yang sudah baca
4. **Reply/Comment**: User bisa reply pengumuman
5. **Push to Specific Users**: Select individual users
6. **Template**: Template pengumuman yang sering digunakan
7. **Analytics**: Dashboard untuk melihat reach dan engagement
8. **Multiple Languages**: Support multi-bahasa

## Example Code

### Membuat Pengumuman dari Admin (Flutter)

```dart
final response = await http.post(
  Uri.parse('$baseUrl/pengumuman'),
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer $token',
  },
  body: json.encode({
    'judul': 'Rapat Orang Tua',
    'konten': 'Akan diadakan rapat orang tua murid...',
    'role_target': 'wali',
    'prioritas': 'penting',
    'kelas_id': kelasId, // optional
  }),
);

if (response.statusCode == 200) {
  print('Pengumuman berhasil dibuat dan notifikasi dikirim!');
}
```

### Menampilkan Notifikasi Pengumuman

```dart
// Di screen pengumuman, refresh ketika notifikasi diterima
FCMService().onNotificationReceived = (data) {
  if (data['type'] == 'pengumuman') {
    // Refresh list pengumuman
    _loadPengumuman();
    
    // Show local notification
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Pengumuman baru: ${data['judul']}')),
    );
  }
};
```
