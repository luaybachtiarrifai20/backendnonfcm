// Get filter options for kegiatan (guru, kelas, tanggal)
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const XLSX = require("xlsx");
const fs = require("fs");
const cron = require("node-cron");
require("dotenv").config();
const app = express();
app.use(express.json());
app.use(cors());

// Helper function untuk menonaktifkan token yang tidak valid
const deactivateToken = async (token) => {
  try {
    const connection = await getConnection();
    await connection.execute(
      "UPDATE fcm_tokens SET is_active = FALSE WHERE token = ?",
      [token]
    );
    await connection.end();
    console.log("Token dinonaktifkan:", token);
  } catch (error) {
    console.error("Error menonaktifkan token:", error);
  }
};

// Konfigurasi database langsung (ganti dengan nilai yang sesuai)
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306, // default value jika tidak ada
  timezone: "+07:00", // Set timezone to Asia/Jakarta (WIB)
};

const JWT_SECRET = "secret_key_yang_aman_dan_unik";

// Tambahkan di bagian atas file setelah import lainnya
const admin = require("firebase-admin");

// Inisialisasi Firebase Admin
const serviceAccount = require("./serviceAccountKey.json"); // Sesuaikan path

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://managemen-sekolah-f352d-default-rtdb.asia-southeast1.firebasedatabase.app/", // Updated to match Flutter app Firebase project
});

// Helper function untuk mengirim notifikasi
const sendNotification = async (token, title, body, data = {}) => {
  try {
    const message = {
      token: token,
      notification: {
        title: title,
        body: body,
      },
      data: data,
      android: {
        priority: "high",
      },
      apns: {
        payload: {
          aps: {
            contentAvailable: true,
            badge: 1,
            sound: "default",
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log("Notifikasi berhasil dikirim:", response);
    return { success: true, response };
  } catch (error) {
    console.error("Error mengirim notifikasi:", error);

    // Jika token tidak valid, nonaktifkan token
    if (error.code === "messaging/registration-token-not-registered") {
      await deactivateToken(token);
    }

    return { success: false, error: error.message };
  }
};

// Helper function untuk mengirim notifikasi ke multiple devices
const sendNotificationToMultiple = async (tokens, title, body, data = {}) => {
  try {
    // Convert all data values to strings for FCM
    const fcmData = {};
    Object.keys(data).forEach((key) => {
      fcmData[key] = String(data[key]);
    });

    const message = {
      tokens: tokens,
      notification: {
        title: title,
        body: body,
      },
      data: fcmData,
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // Log detailed results
    console.log(
      `📊 FCM Multicast Result: Success=${response.successCount}, Failed=${response.failureCount}`
    );

    // Log errors if any
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const error = resp.error;
          console.error(`❌ Token ${idx + 1}/${tokens.length} failed:`);
          console.error(`   Error Code: ${error.code}`);
          console.error(`   Error Message: ${error.message}`);

          // Specific handling for common errors
          if (
            error.code === "messaging/invalid-registration-token" ||
            error.code === "messaging/registration-token-not-registered"
          ) {
            console.error(
              `   ⚠️  Token sudah tidak valid, harus dihapus dari database`
            );
            console.error(`   Token: ${tokens[idx].substring(0, 20)}...`);
          } else if (error.code === "messaging/mismatched-credential") {
            console.error(
              `   ⚠️  SenderId mismatch - Token dari Firebase project berbeda`
            );
            console.error(`   Token: ${tokens[idx].substring(0, 20)}...`);
          }
        }
      });
    }

    return { success: response.successCount > 0, response };
  } catch (error) {
    console.error("❌ Error mengirim notifikasi multicast:", error.message);
    console.error("Stack:", error.stack);
    return { success: false, error: error.message };
  }
};

// ==================== PAGINATION & FILTER HELPERS ====================

/**
 * Build SQL WHERE clauses from filters
 * @param {Object} filters - Filter object from request
 * @param {String} tableAlias - Table alias (e.g., 's', 'g', 'k')
 * @returns {Object} { whereClause, params }
 */
function buildFilterQuery(filters, tableAlias = "") {
  const conditions = [];
  const params = [];
  const prefix = tableAlias ? `${tableAlias}.` : "";

  // Filter: Kelas ID
  if (filters.kelas_id) {
    conditions.push(`${prefix}kelas_id = ?`);
    params.push(filters.kelas_id);
  }

  // Filter: Grade Level (kelas)
  if (filters.grade_level) {
    conditions.push(`k.grade_level = ?`);
    params.push(filters.grade_level);
  }

  // Filter: Jenis Kelamin
  if (filters.jenis_kelamin) {
    conditions.push(`${prefix}jenis_kelamin = ?`);
    params.push(filters.jenis_kelamin);
  }

  // Filter: Mata Pelajaran ID
  if (filters.mata_pelajaran_id) {
    conditions.push(`${prefix}mata_pelajaran_id = ?`);
    params.push(filters.mata_pelajaran_id);
  }

  // Filter: Semester
  if (filters.semester) {
    conditions.push(`${prefix}semester = ?`);
    params.push(filters.semester);
  }

  // Filter: Tahun Ajaran
  if (filters.tahun_ajaran) {
    conditions.push(`${prefix}tahun_ajaran = ?`);
    params.push(filters.tahun_ajaran);
  }

  // Filter: Jam Mengajar (range)
  if (filters.jam_mulai && filters.jam_selesai) {
    conditions.push(`${prefix}jam_mulai >= ? AND ${prefix}jam_selesai <= ?`);
    params.push(filters.jam_mulai, filters.jam_selesai);
  }

  // Filter: Hari
  if (filters.hari) {
    conditions.push(`${prefix}hari = ?`);
    params.push(filters.hari);
  }

  // Filter: Status (aktif/tidak_aktif)
  if (filters.status) {
    conditions.push(`${prefix}status = ?`);
    params.push(filters.status);
  }

  // Filter: Search by name (untuk siswa, guru, kelas, etc.)
  if (filters.search && filters.search.trim()) {
    conditions.push(`${prefix}nama LIKE ?`);
    params.push(`%${filters.search.trim()}%`);
  }

  const whereClause =
    conditions.length > 0 ? "AND " + conditions.join(" AND ") : "";

  return { whereClause, params };
}

/**
 * Build pagination SQL and calculate metadata
 * @param {Number} page - Current page (1-indexed)
 * @param {Number} limit - Items per page
 * @returns {Object} { limitClause, offset }
 */
function buildPaginationQuery(page = 1, limit = 20) {
  const currentPage = Math.max(1, parseInt(page) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(limit) || 20)); // Max 100 per page
  const offset = (currentPage - 1) * perPage;

  return {
    limitClause: `LIMIT ${perPage} OFFSET ${offset}`,
    offset,
    perPage,
    currentPage,
  };
}

/**
 * Calculate pagination metadata
 * @param {Number} totalItems - Total count from database
 * @param {Number} currentPage - Current page
 * @param {Number} perPage - Items per page
 * @returns {Object} Pagination metadata
 */
function calculatePaginationMeta(totalItems, currentPage, perPage) {
  const totalPages = Math.ceil(totalItems / perPage);
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;

  return {
    total_items: totalItems,
    total_pages: totalPages,
    current_page: currentPage,
    per_page: perPage,
    has_next_page: hasNextPage,
    has_prev_page: hasPrevPage,
    next_page: hasNextPage ? currentPage + 1 : null,
    prev_page: hasPrevPage ? currentPage - 1 : null,
  };
}

// ==================== END PAGINATION & FILTER HELPERS ====================

// Middleware untuk koneksi database dengan error handling
async function getConnection() {
  try {
    console.log("Mencoba menghubungkan ke database...");
    const connection = await mysql.createConnection(dbConfig);
    console.log("Berhasil terhubung ke database MySQL");
    return connection;
  } catch (error) {
    console.error("ERROR KONEKSI DATABASE:", error.message);
    console.error("Kode error:", error.code);
    console.error("Detail error:", error);
    throw error;
  }
}

// Middleware untuk verifikasi token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Token tidak tersedia" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error("ERROR VERIFIKASI TOKEN:", err.message);
      return res.status(403).json({ error: "Token tidak valid" });
    }
    req.user = user;
    next();
  });
};

const authenticateTokenAndSchool = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Token tidak tersedia" });
    }

    // Verify token
    const user = await new Promise((resolve, reject) => {
      jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) reject(err);
        else resolve(decoded);
      });
    });

    // Cek status sekolah user melalui user_schools
    const connection = await getConnection();

    const [userSchools] = await connection.execute(
      `SELECT 
        u.*,
        us.id as user_school_id,
        us.sekolah_id,
        us.is_active as users_school_active,
        s.nama_sekolah, 
        s.status as sekolah_status,
        s.alamat as sekolah_alamat,
        s.telepon as sekolah_telepon,
        s.email as sekolah_email
       FROM users u 
       JOIN users_schools us ON u.id = us.user_id
       JOIN sekolah s ON us.sekolah_id = s.id 
       WHERE u.id = ? AND us.sekolah_id = ? AND us.is_active = TRUE`,
      [user.id, user.sekolah_id]
    );

    if (userSchools.length === 0) {
      await connection.end();
      return res.status(403).json({
        error: "Akun tidak terdaftar di sekolah ini atau akses dinonaktifkan",
      });
    }

    const selectedSchool = userSchools[0];

    if (selectedSchool.sekolah_status !== "aktif") {
      await connection.end();
      return res.status(403).json({
        error: "Sekolah tidak aktif. Silakan hubungi administrator.",
      });
    }

    // Cek apakah role di token valid untuk user_school ini
    const [validRoles] = await connection.execute(
      `SELECT role FROM users_roles 
       WHERE user_school_id = ? AND role = ? AND is_active = TRUE`,
      [selectedSchool.user_school_id, user.role]
    );

    if (validRoles.length === 0) {
      await connection.end();
      return res.status(403).json({
        error: "Role tidak valid untuk sekolah ini",
      });
    }

    await connection.end();

    // Tambahkan data lengkap ke request
    req.user = {
      id: selectedSchool.id,
      email: selectedSchool.email,
      role: user.role,
      nama: selectedSchool.nama,
      // Data sekolah
      sekolah_id: selectedSchool.sekolah_id,
      nama_sekolah: selectedSchool.nama_sekolah,
      sekolah_status: selectedSchool.sekolah_status,
      sekolah_alamat: selectedSchool.sekolah_alamat,
      sekolah_telepon: selectedSchool.sekolah_telepon,
      sekolah_email: selectedSchool.sekolah_email,
      // Data user_schools
      user_school_id: selectedSchool.user_school_id,
      users_school_active: selectedSchool.users_school_active,
      // Data tambahan user
      kelas_id: selectedSchool.kelas_id,
      nip: selectedSchool.nip,
      is_wali_kelas: selectedSchool.is_wali_kelas,
      siswa_id: selectedSchool.siswa_id,
      created_at: selectedSchool.created_at,
    };

    req.sekolah_id = selectedSchool.sekolah_id;
    next();
  } catch (error) {
    console.error("ERROR AUTHENTICATE TOKEN AND SCHOOL:", error.message);

    if (error.name === "JsonWebTokenError") {
      return res.status(403).json({ error: "Token tidak valid" });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(403).json({ error: "Token telah kadaluarsa" });
    }

    return res.status(500).json({ error: "Gagal memverifikasi token" });
  }
};

// Konfigurasi storage untuk multer - PERBAIKI INI
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "uploads/rpp");
    // Pastikan folder ada
    const fs = require("fs");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log("Created upload directory:", uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Format: timestamp-namaFile-asli
    const timestamp = Date.now();
    const originalName = file.originalname;
    // Bersihkan nama file dari karakter khusus
    const cleanName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const fileName = `${timestamp}-${cleanName}`;
    console.log("Generated filename:", fileName);
    cb(null, fileName);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: function (req, file, cb) {
    console.log("File filter checking:", file.mimetype, file.originalname);

    // Hanya izinkan file Word dan PDF
    const allowedTypes = [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/pdf",
    ];

    const allowedExtensions = [".pdf", ".doc", ".docx", "jpeg", "png", "jpg"];
    const fileExtension = path.extname(file.originalname).toLowerCase();

    if (
      allowedTypes.includes(file.mimetype) ||
      allowedExtensions.includes(fileExtension)
    ) {
      cb(null, true);
    } else {
      console.log("File type rejected:", file.mimetype, fileExtension);
      cb(
        new Error("Hanya file Word (.doc, .docx) dan PDF yang diizinkan"),
        false
      );
    }
  },
});

// Error handling untuk multer
const uploadMiddleware = (req, res, next) => {
  upload.single("file")(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      // A Multer error occurred when uploading.
      console.error("Multer Error:", err);
      return res.status(400).json({
        error: `Upload error: ${err.message}`,
      });
    } else if (err) {
      // An unknown error occurred.
      console.error("Unknown Upload Error:", err);
      return res.status(500).json({
        error: `Upload failed: ${err.message}`,
      });
    }
    // Everything went fine.
    next();
  });
};

// Konfigurasi multer untuk memory storage (tidak menyimpan file)
const excelUpload = multer({
  storage: multer.memoryStorage(), // Simpan di memory saja
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.spreadsheet",
    ];

    const allowedExtensions = [".xls", ".xlsx", ".ods"];
    const fileExtension = path.extname(file.originalname).toLowerCase();

    if (
      allowedTypes.includes(file.mimetype) ||
      allowedExtensions.includes(fileExtension)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Hanya file Excel (.xls, .xlsx) yang diizinkan"), false);
    }
  },
});

// Middleware untuk upload Excel (memory storage)
const excelUploadMiddleware = (req, res, next) => {
  excelUpload.single("file")(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      console.error("Multer Error:", err);
      return res.status(400).json({
        error: `Upload error: ${err.message}`,
      });
    } else if (err) {
      console.error("Unknown Upload Error:", err);
      return res.status(500).json({
        error: `Upload failed: ${err.message}`,
      });
    }
    next();
  });
};

// Konfigurasi storage untuk bukti pembayaran
const buktiStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "uploads/bukti-pembayaran");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const originalName = file.originalname;
    const cleanName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const fileName = `${timestamp}-${cleanName}`;
    cb(null, fileName);
  },
});

const buktiUpload = multer({
  storage: buktiStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "application/pdf",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Hanya file JPEG, PNG, JPG, dan PDF yang diizinkan"), false);
    }
  },
});

const buktiUploadMiddleware = (req, res, next) => {
  buktiUpload.single("bukti_bayar")(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        error: `Upload error: ${err.message}`,
      });
    } else if (err) {
      return res.status(500).json({
        error: `Upload failed: ${err.message}`,
      });
    }
    next();
  });
};

// Middleware untuk logging request
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Routes

// Login untuk multi-sekolah dengan user_schools
app.post("/api/login", async (req, res) => {
  try {
    console.log("Login attempt:", req.body.email);
    const { email, password, sekolah_id, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email dan password diperlukan" });
    }

    const connection = await getConnection();

    // Cari user berdasarkan email
    const [users] = await connection.execute(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (users.length === 0) {
      await connection.end();
      console.log("Login gagal: Email tidak ditemukan");
      return res.status(401).json({ error: "Email atau password salah" });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      await connection.end();
      console.log("Login gagal: Password salah");
      return res.status(401).json({ error: "Email atau password salah" });
    }

    // Cek sekolah yang bisa diakses user melalui user_schools
    const [userSchools] = await connection.execute(
      `SELECT 
        us.*,
        s.nama_sekolah,
        s.status as sekolah_status,
        s.alamat as sekolah_alamat,
        s.telepon as sekolah_telepon,
        s.email as sekolah_email
      FROM users_schools us
      JOIN sekolah s ON us.sekolah_id = s.id
      WHERE us.user_id = ? AND us.is_active = TRUE`,
      [user.id]
    );

    if (userSchools.length === 0) {
      await connection.end();
      return res.status(403).json({
        error: "Akun tidak memiliki akses ke sekolah manapun",
      });
    }

    // Filter hanya sekolah yang aktif
    const activeSchools = userSchools.filter(
      (us) => us.sekolah_status === "aktif"
    );

    if (activeSchools.length === 0) {
      await connection.end();
      return res.status(403).json({
        error: "Tidak ada sekolah aktif yang dapat diakses",
      });
    }

    let selectedSchool = activeSchools[0];

    // Jika sekolah_id diberikan, cari yang sesuai
    if (sekolah_id) {
      const requestedSchool = activeSchools.find(
        (us) => us.sekolah_id === sekolah_id
      );
      if (!requestedSchool) {
        await connection.end();
        return res.status(403).json({
          error: "Tidak memiliki akses ke sekolah yang diminta",
        });
      }
      selectedSchool = requestedSchool;
    }

    // PERBAIKAN: Cek role yang tersedia untuk sekolah yang dipilih
    const [userRoles] = await connection.execute(
      `SELECT ur.role 
      FROM users_roles ur
      JOIN users_schools us ON ur.user_school_id = us.id
      WHERE us.user_id = ? AND us.sekolah_id = ? AND ur.is_active = TRUE`,
      [user.id, selectedSchool.sekolah_id]
    );

    const availableRoles = userRoles.map((ur) => ur.role);

    // Jika user punya multiple sekolah dan tidak memilih, kembalikan daftar sekolah
    if (activeSchools.length > 1 && !sekolah_id) {
      await connection.end();

      const sekolahList = activeSchools.map((us) => ({
        sekolah_id: us.sekolah_id,
        nama_sekolah: us.nama_sekolah,
        alamat: us.sekolah_alamat,
        telepon: us.sekolah_telepon,
      }));

      return res.status(200).json({
        message: "Pilih sekolah untuk login",
        pilih_sekolah: true,
        sekolah_list: sekolahList,
        user: {
          id: user.id,
          nama: user.nama,
          email: user.email,
        },
      });
    }

    // PERBAIKAN: Jika sudah memilih sekolah tapi punya multiple role dan belum pilih role
    if (availableRoles.length > 1 && !role) {
      await connection.end();

      return res.status(200).json({
        message: "Pilih role untuk login",
        pilih_role: true,
        role_list: availableRoles,
        user: {
          id: user.id,
          nama: user.nama,
          email: user.email,
        },
        sekolah: {
          id: selectedSchool.sekolah_id,
          nama_sekolah: selectedSchool.nama_sekolah,
          alamat: selectedSchool.sekolah_alamat,
          telepon: selectedSchool.sekolah_telepon,
        },
      });
    }

    // Tentukan role yang akan digunakan
    let selectedRole = role || availableRoles[0];

    // Validasi role yang dipilih
    if (role && !availableRoles.includes(role)) {
      await connection.end();
      return res.status(403).json({
        error: "Role tidak valid untuk sekolah ini",
      });
    }

    // Generate token dengan sekolah_id dan role
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: selectedRole,
        sekolah_id: selectedSchool.sekolah_id,
        nama: user.nama,
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    await connection.end();

    console.log(
      "Login berhasil:",
      user.email,
      "sekolah:",
      selectedSchool.nama_sekolah,
      "role:",
      selectedRole
    );

    res.json({
      token,
      user: {
        id: user.id,
        nama: user.nama,
        email: user.email,
        role: selectedRole,
        kelas_id: user.kelas_id,
        sekolah_id: selectedSchool.sekolah_id,
        nama_sekolah: selectedSchool.nama_sekolah,
        sekolah_alamat: selectedSchool.sekolah_alamat,
        sekolah_telepon: selectedSchool.sekolah_telepon,
        sekolah_email: selectedSchool.sekolah_email,
        accessible_schools_count: activeSchools.length,
      },
    });
  } catch (error) {
    console.error("ERROR LOGIN:", error.message);
    res.status(500).json({ error: "Terjadi kesalahan server saat login" });
  }
});

// Endpoint untuk menyimpan FCM token
app.post("/api/fcm/token", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { token, device_type = "web" } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token diperlukan" });
    }

    const connection = await getConnection();

    // Cek apakah token sudah ada untuk user ini
    const [existing] = await connection.execute(
      "SELECT id FROM fcm_tokens WHERE user_id = ? AND token = ?",
      [req.user.id, token]
    );

    if (existing.length > 0) {
      // Token sudah ada, hanya update timestamp dan pastikan aktif
      await connection.execute(
        "UPDATE fcm_tokens SET is_active = TRUE, device_type = ?, updated_at = NOW() WHERE user_id = ? AND token = ?",
        [device_type, req.user.id, token]
      );
      console.log(
        `✅ FCM token diperbarui untuk user: ${req.user.nama || req.user.email}`
      );
    } else {
      // Token baru untuk user ini

      // PENTING: Hapus token lama untuk device_type yang sama
      // Ini memastikan 1 user hanya punya 1 token per device_type
      const [oldTokens] = await connection.execute(
        "SELECT id, token FROM fcm_tokens WHERE user_id = ? AND device_type = ?",
        [req.user.id, device_type]
      );

      if (oldTokens.length > 0) {
        console.log(
          `🗑️  Menghapus ${oldTokens.length} token lama untuk user: ${
            req.user.nama || req.user.email
          }`
        );
        await connection.execute(
          "DELETE FROM fcm_tokens WHERE user_id = ? AND device_type = ?",
          [req.user.id, device_type]
        );
      }

      // Insert token baru
      const id = crypto.randomUUID();
      await connection.execute(
        "INSERT INTO fcm_tokens (id, user_id, token, device_type) VALUES (?, ?, ?, ?)",
        [id, req.user.id, token, device_type]
      );
      console.log(
        `✅ FCM token baru disimpan untuk user: ${
          req.user.nama || req.user.email
        } (${device_type})`
      );
    }

    await connection.end();

    res.json({ message: "Token berhasil disimpan" });
  } catch (error) {
    console.error("ERROR SAVE FCM TOKEN:", error.message);
    res.status(500).json({ error: "Gagal menyimpan token" });
  }
});

// Endpoint untuk menghapus FCM token (saat logout)
app.delete("/api/fcm/token", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token diperlukan" });
    }

    const connection = await getConnection();
    await connection.execute(
      "UPDATE fcm_tokens SET is_active = FALSE WHERE user_id = ? AND token = ?",
      [req.user.id, token]
    );
    await connection.end();

    res.json({ message: "Token berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE FCM TOKEN:", error.message);
    res.status(500).json({ error: "Gagal menghapus token" });
  }
});

// Endpoint untuk mendapatkan tokens by user_id
const getUserFCMTokens = async (userId) => {
  try {
    const connection = await getConnection();
    const [tokens] = await connection.execute(
      "SELECT token FROM fcm_tokens WHERE user_id = ? AND is_active = TRUE",
      [userId]
    );
    await connection.end();
    return tokens.map((t) => t.token);
  } catch (error) {
    console.error("ERROR GET USER FCM TOKENS:", error.message);
    return [];
  }
};

// Endpoint untuk mendapatkan tokens by role (untuk broadcast)
const getFCMTokensByRole = async (role, sekolah_id = null) => {
  try {
    const connection = await getConnection();

    let query = `
      SELECT DISTINCT ft.token 
      FROM fcm_tokens ft
      JOIN users u ON ft.user_id = u.id
      WHERE ft.is_active = TRUE AND u.role = ?
    `;
    let params = [role];

    if (sekolah_id) {
      query += " AND u.sekolah_id = ?";
      params.push(sekolah_id);
    }

    const [tokens] = await connection.execute(query, params);
    await connection.end();
    return tokens.map((t) => t.token);
  } catch (error) {
    console.error("ERROR GET FCM TOKENS BY ROLE:", error.message);
    return [];
  }
};

// Endpoint untuk mengirim notifikasi pengumuman
app.post(
  "/api/notifications/pengumuman",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { title, body, target_users, data = {} } = req.body;

      if (!title || !body) {
        return res.status(400).json({ error: "Title dan body diperlukan" });
      }

      let tokens = [];

      if (target_users && Array.isArray(target_users)) {
        // Kirim ke user tertentu
        for (const userId of target_users) {
          const userTokens = await getUserFCMTokens(userId);
          tokens = tokens.concat(userTokens);
        }
      } else {
        // Kirim ke semua user di sekolah
        const connection = await getConnection();
        const [users] = await connection.execute(
          "SELECT id FROM users WHERE sekolah_id = ?",
          [req.sekolah_id]
        );
        await connection.end();

        for (const user of users) {
          const userTokens = await getUserFCMTokens(user.id);
          tokens = tokens.concat(userTokens);
        }
      }

      // Hapus duplikat
      tokens = [...new Set(tokens)];

      if (tokens.length === 0) {
        return res
          .status(400)
          .json({ error: "Tidak ada token aktif yang ditemukan" });
      }

      // Tambahkan data tambahan
      const notificationData = {
        type: "pengumuman",
        sekolah_id: req.sekolah_id,
        timestamp: new Date().toISOString(),
        ...data,
      };

      const result = await sendNotificationToMultiple(
        tokens,
        title,
        body,
        notificationData
      );

      // Simpan ke history notifications
      if (target_users && Array.isArray(target_users)) {
        const connection = await getConnection();
        for (const userId of target_users) {
          const notifId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO notifications (id, user_id, title, body, type, data) VALUES (?, ?, ?, ?, 'pengumuman', ?)",
            [notifId, userId, title, body, JSON.stringify(notificationData)]
          );
        }
        await connection.end();
      }

      res.json({
        message: "Notifikasi pengumuman berhasil dikirim",
        sent_count: tokens.length,
        result: result,
      });
    } catch (error) {
      console.error("ERROR SEND PENGUMUMAN NOTIFICATION:", error.message);
      res.status(500).json({ error: "Gagal mengirim notifikasi pengumuman" });
    }
  }
);

// Endpoint untuk notifikasi tagihan
app.post(
  "/api/notifications/tagihan",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const {
        siswa_id,
        title,
        body,
        jumlah_tagihan,
        jatuh_tempo,
        data = {},
      } = req.body;

      if (!siswa_id || !title || !body) {
        return res
          .status(400)
          .json({ error: "Siswa ID, title, dan body diperlukan" });
      }

      // Dapatkan user_id wali dari siswa
      const connection = await getConnection();
      const [wali] = await connection.execute(
        "SELECT u.id as user_id FROM users u WHERE u.siswa_id = ? AND u.role = 'wali'",
        [siswa_id]
      );

      if (wali.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "User wali tidak ditemukan untuk siswa ini" });
      }

      const waliUserId = wali[0].user_id;
      const tokens = await getUserFCMTokens(waliUserId);

      if (tokens.length === 0) {
        await connection.end();
        return res
          .status(400)
          .json({ error: "Tidak ada token aktif untuk wali" });
      }

      // Data notifikasi tagihan
      const notificationData = {
        type: "tagihan",
        siswa_id: siswa_id,
        jumlah_tagihan: jumlah_tagihan?.toString() || "0",
        jatuh_tempo: jatuh_tempo || "",
        sekolah_id: req.sekolah_id,
        timestamp: new Date().toISOString(),
        ...data,
      };

      const result = await sendNotificationToMultiple(
        tokens,
        title,
        body,
        notificationData
      );

      // Simpan ke history
      const notifId = crypto.randomUUID();
      await connection.execute(
        "INSERT INTO notifications (id, user_id, title, body, type, data) VALUES (?, ?, ?, ?, 'tagihan', ?)",
        [notifId, waliUserId, title, body, JSON.stringify(notificationData)]
      );

      await connection.end();

      res.json({
        message: "Notifikasi tagihan berhasil dikirim",
        sent_count: tokens.length,
        result: result,
      });
    } catch (error) {
      console.error("ERROR SEND TAGIHAN NOTIFICATION:", error.message);
      res.status(500).json({ error: "Gagal mengirim notifikasi tagihan" });
    }
  }
);

// Endpoint untuk notifikasi absensi
app.post(
  "/api/notifications/absensi",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const {
        siswa_id,
        status_absensi,
        mata_pelajaran,
        tanggal,
        data = {},
      } = req.body;

      if (!siswa_id || !status_absensi) {
        return res
          .status(400)
          .json({ error: "Siswa ID dan status absensi diperlukan" });
      }

      // Dapatkan user_id wali
      const connection = await getConnection();
      const [wali] = await connection.execute(
        "SELECT u.id as user_id FROM users u WHERE u.siswa_id = ? AND u.role = 'wali'",
        [siswa_id]
      );

      if (wali.length === 0) {
        await connection.end();
        return res.status(404).json({ error: "User wali tidak ditemukan" });
      }

      const waliUserId = wali[0].user_id;
      const tokens = await getUserFCMTokens(waliUserId);

      if (tokens.length === 0) {
        await connection.end();
        return res
          .status(400)
          .json({ error: "Tidak ada token aktif untuk wali" });
      }

      const title = "Notifikasi Absensi";
      const body = `Anak Anda ${status_absensi} pada pelajaran ${
        mata_pelajaran || ""
      } tanggal ${tanggal || new Date().toLocaleDateString("id-ID")}`;

      const notificationData = {
        type: "absensi",
        siswa_id: siswa_id,
        status_absensi: status_absensi,
        mata_pelajaran: mata_pelajaran || "",
        tanggal: tanggal || new Date().toISOString().split("T")[0],
        sekolah_id: req.sekolah_id,
        timestamp: new Date().toISOString(),
        ...data,
      };

      const result = await sendNotificationToMultiple(
        tokens,
        title,
        body,
        notificationData
      );

      // Simpan ke history
      const notifId = crypto.randomUUID();
      await connection.execute(
        "INSERT INTO notifications (id, user_id, title, body, type, data) VALUES (?, ?, ?, ?, 'absensi', ?)",
        [notifId, waliUserId, title, body, JSON.stringify(notificationData)]
      );

      await connection.end();

      res.json({
        message: "Notifikasi absensi berhasil dikirim",
        sent_count: tokens.length,
        result: result,
      });
    } catch (error) {
      console.error("ERROR SEND ABSENSI NOTIFICATION:", error.message);
      res.status(500).json({ error: "Gagal mengirim notifikasi absensi" });
    }
  }
);

// Endpoint untuk notifikasi aktivitas kelas
app.post(
  "/api/notifications/aktivitas-kelas",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { kelas_id, title, body, jenis_aktivitas, data = {} } = req.body;

      if (!kelas_id || !title || !body) {
        return res
          .status(400)
          .json({ error: "Kelas ID, title, dan body diperlukan" });
      }

      // Dapatkan semua siswa di kelas
      const connection = await getConnection();
      const [siswaList] = await connection.execute(
        "SELECT id FROM siswa WHERE kelas_id = ?",
        [kelas_id]
      );

      if (siswaList.length === 0) {
        await connection.end();
        return res.status(404).json({ error: "Tidak ada siswa di kelas ini" });
      }

      let tokens = [];

      // Dapatkan tokens dari semua wali siswa
      for (const siswa of siswaList) {
        const [wali] = await connection.execute(
          "SELECT u.id as user_id FROM users u WHERE u.siswa_id = ? AND u.role = 'wali'",
          [siswa.id]
        );

        if (wali.length > 0) {
          const userTokens = await getUserFCMTokens(wali[0].user_id);
          tokens = tokens.concat(userTokens);
        }
      }

      // Hapus duplikat
      tokens = [...new Set(tokens)];

      if (tokens.length === 0) {
        await connection.end();
        return res
          .status(400)
          .json({ error: "Tidak ada token aktif yang ditemukan" });
      }

      const notificationData = {
        type: "aktivitas_kelas",
        kelas_id: kelas_id,
        jenis_aktivitas: jenis_aktivitas || "",
        sekolah_id: req.sekolah_id,
        timestamp: new Date().toISOString(),
        ...data,
      };

      const result = await sendNotificationToMultiple(
        tokens,
        title,
        body,
        notificationData
      );

      // Simpan ke history untuk semua wali
      for (const siswa of siswaList) {
        const [wali] = await connection.execute(
          "SELECT u.id as user_id FROM users u WHERE u.siswa_id = ? AND u.role = 'wali'",
          [siswa.id]
        );

        if (wali.length > 0) {
          const notifId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO notifications (id, user_id, title, body, type, data) VALUES (?, ?, ?, ?, 'aktivitas_kelas', ?)",
            [
              notifId,
              wali[0].user_id,
              title,
              body,
              JSON.stringify(notificationData),
            ]
          );
        }
      }

      await connection.end();

      res.json({
        message: "Notifikasi aktivitas kelas berhasil dikirim",
        sent_count: tokens.length,
        result: result,
      });
    } catch (error) {
      console.error("ERROR SEND AKTIVITAS KELAS NOTIFICATION:", error.message);
      res
        .status(500)
        .json({ error: "Gagal mengirim notifikasi aktivitas kelas" });
    }
  }
);

// Endpoint untuk mendapatkan history notifications user
app.get("/api/notifications", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { page = 1, limit = 20, unread_only = false } = req.query;
    const offset = (page - 1) * limit;

    const connection = await getConnection();

    let query = "SELECT * FROM notifications WHERE user_id = ?";
    let countQuery =
      "SELECT COUNT(*) as total FROM notifications WHERE user_id = ?";
    let params = [req.user.id];

    if (unread_only === "true") {
      query += " AND is_read = FALSE";
      countQuery += " AND is_read = FALSE";
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

    const [notifications] = await connection.execute(query, params);
    const [countResult] = await connection.execute(countQuery, [req.user.id]);

    await connection.end();

    res.json({
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        total_pages: Math.ceil(countResult[0].total / limit),
      },
    });
  } catch (error) {
    console.error("ERROR GET NOTIFICATIONS:", error.message);
    res.status(500).json({ error: "Gagal mengambil data notifikasi" });
  }
});

// Endpoint untuk menandai notifikasi sebagai sudah dibaca
app.put(
  "/api/notifications/:id/read",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;

      const connection = await getConnection();
      await connection.execute(
        "UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?",
        [id, req.user.id]
      );
      await connection.end();

      res.json({ message: "Notifikasi ditandai sebagai sudah dibaca" });
    } catch (error) {
      console.error("ERROR MARK NOTIFICATION READ:", error.message);
      res.status(500).json({ error: "Gagal menandai notifikasi" });
    }
  }
);

// Endpoint untuk menandai semua notifikasi sebagai sudah dibaca
app.put(
  "/api/notifications/read-all",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const connection = await getConnection();
      await connection.execute(
        "UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE",
        [req.user.id]
      );
      await connection.end();

      res.json({ message: "Semua notifikasi ditandai sebagai sudah dibaca" });
    } catch (error) {
      console.error("ERROR MARK ALL NOTIFICATIONS READ:", error.message);
      res.status(500).json({ error: "Gagal menandai notifikasi" });
    }
  }
);

// Endpoint untuk testing notifikasi
app.post(
  "/api/notifications/test",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const {
        title = "Test Notification",
        body = "This is a test notification",
      } = req.body;

      // Kirim ke diri sendiri
      const tokens = await getUserFCMTokens(req.user.id);

      if (tokens.length === 0) {
        return res
          .status(400)
          .json({ error: "Tidak ada token aktif untuk user ini" });
      }

      const result = await sendNotificationToMultiple(tokens, title, body, {
        type: "test",
        sekolah_id: req.sekolah_id,
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: "Notifikasi test berhasil dikirim",
        tokens_sent: tokens.length,
        result: result,
      });
    } catch (error) {
      console.error("ERROR TEST NOTIFICATION:", error.message);
      res.status(500).json({ error: "Gagal mengirim notifikasi test" });
    }
  }
);

// Get available roles untuk user di sekolah tertentu
app.get("/api/user/roles", authenticateTokenAndSchool, async (req, res) => {
  try {
    const connection = await getConnection();

    const [userRoles] = await connection.execute(
      `SELECT ur.role 
        FROM users_roles ur
        JOIN users_schools us ON ur.user_school_id = us.id
        WHERE us.user_id = ? AND us.sekolah_id = ? AND ur.is_active = TRUE`,
      [req.user.id, req.user.sekolah_id]
    );

    await connection.end();

    const roles = userRoles.map((ur) => ur.role);

    res.json({
      available_roles: roles,
      current_role: req.user.role,
    });
  } catch (error) {
    console.error("ERROR GET USER ROLES:", error.message);
    res.status(500).json({ error: "Gagal mengambil data roles user" });
  }
});

// Switch role
app.post("/api/switch-role", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ error: "Role diperlukan" });
    }

    const connection = await getConnection();

    // Cek apakah role tersedia untuk user
    const [userRoles] = await connection.execute(
      `SELECT ur.role 
        FROM users_roles ur
        JOIN users_schools us ON ur.user_school_id = us.id
        WHERE us.user_id = ? AND us.sekolah_id = ? AND ur.role = ? AND ur.is_active = TRUE`,
      [req.user.id, req.user.sekolah_id, role]
    );

    if (userRoles.length === 0) {
      await connection.end();
      return res.status(403).json({
        error: "Tidak memiliki akses ke role ini",
      });
    }

    // Get user data
    const [users] = await connection.execute(
      "SELECT * FROM users WHERE id = ?",
      [req.user.id]
    );

    await connection.end();

    const user = users[0];

    // Generate token baru dengan role yang dipilih
    const newToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: role,
        sekolah_id: req.user.sekolah_id,
        nama: user.nama,
        user_school_id: req.user.user_school_id,
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      message: "Berhasil pindah role",
      token: newToken,
      role: role,
    });
  } catch (error) {
    console.error("ERROR SWITCH ROLE:", error.message);
    res.status(500).json({ error: "Gagal pindah role" });
  }
});

// Get semua sekolah yang bisa diakses user
app.get("/api/user/schools", authenticateTokenAndSchool, async (req, res) => {
  try {
    const connection = await getConnection();

    const [userSchools] = await connection.execute(
      `SELECT 
          us.*,
          s.nama_sekolah,
          s.status as sekolah_status,
          s.alamat,
          s.telepon,
          s.email
        FROM users_schools us
        JOIN sekolah s ON us.sekolah_id = s.id
        WHERE us.user_id = ?
        ORDER BY us.is_active DESC, s.nama_sekolah`,
      [req.user.id]
    );

    await connection.end();

    res.json(userSchools);
  } catch (error) {
    console.error("ERROR GET USER SCHOOLS:", error.message);
    res.status(500).json({ error: "Gagal mengambil data sekolah user" });
  }
});

// Pindah sekolah (untuk user dengan multiple akses)
app.post("/api/switch-school", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { sekolah_id } = req.body;

    if (!sekolah_id) {
      return res.status(400).json({ error: "Sekolah ID diperlukan" });
    }

    const connection = await getConnection();

    // Cek apakah user punya akses ke sekolah yang diminta
    const [userSchools] = await connection.execute(
      `SELECT us.*, s.status as sekolah_status 
        FROM users_schools us
        JOIN sekolah s ON us.sekolah_id = s.id 
        WHERE us.user_id = ? AND us.sekolah_id = ? AND us.is_active = TRUE`,
      [req.user.id, sekolah_id]
    );

    if (userSchools.length === 0) {
      await connection.end();
      return res.status(403).json({
        error: "Tidak memiliki akses ke sekolah ini",
      });
    }

    const userSchool = userSchools[0];

    if (userSchool.sekolah_status !== "aktif") {
      await connection.end();
      return res.status(403).json({ error: "Sekolah tidak aktif" });
    }

    // Get user data
    const [users] = await connection.execute(
      "SELECT * FROM users WHERE id = ?",
      [req.user.id]
    );

    await connection.end();

    const user = users[0];

    // Generate token baru untuk sekolah yang dipilih
    const newToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        sekolah_id: sekolah_id,
        nama: user.nama,
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      message: "Berhasil pindah sekolah",
      token: newToken,
      sekolah_id: sekolah_id,
    });
  } catch (error) {
    console.error("ERROR SWITCH SCHOOL:", error.message);
    res.status(500).json({ error: "Gagal pindah sekolah" });
  }
});

// Endpoint untuk mengelola sekolah (hanya untuk super admin)
app.get("/api/sekolah", authenticateToken, async (req, res) => {
  try {
    // Cek apakah user adalah super admin
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    console.log("Mengambil data semua sekolah");
    const connection = await getConnection();
    const [sekolah] = await connection.execute("SELECT * FROM sekolah");
    await connection.end();

    res.json(sekolah);
  } catch (error) {
    console.error("ERROR GET SEKOLAH:", error.message);
    res.status(500).json({ error: "Gagal mengambil data sekolah" });
  }
});

app.post("/api/sekolah", authenticateToken, async (req, res) => {
  try {
    // Cek apakah user adalah super admin
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    console.log("Menambah sekolah baru:", req.body);
    const { nama_sekolah, alamat, telepon, email, status } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO sekolah (id, nama_sekolah, alamat, telepon, email, status) VALUES (?, ?, ?, ?, ?, ?)",
      [id, nama_sekolah, alamat, telepon, email, status || "aktif"]
    );

    // Buat user admin otomatis
    const adminId = crypto.randomUUID();
    const password = "password123";
    const hashedPassword = await bcrypt.hash(password, 10);
    const adminEmail = `admin.${id}@sekolah.sch.id`;

    await connection.execute(
      'INSERT INTO users (id, nama, email, password, role, sekolah_id) VALUES (?, ?, ?, ?, "admin", ?)',
      [adminId, `Admin ${nama_sekolah}`, adminEmail, hashedPassword, id]
    );

    await connection.end();

    console.log("Sekolah berhasil ditambahkan:", id);
    res.json({
      message: "Sekolah berhasil ditambahkan",
      id,
      admin_account: {
        email: adminEmail,
        password: "password123",
      },
    });
  } catch (error) {
    console.error("ERROR POST SEKOLAH:", error.message);
    res.status(500).json({ error: "Gagal menambah sekolah" });
  }
});

app.put("/api/sekolah/:id/status", authenticateToken, async (req, res) => {
  try {
    // Cek apakah user adalah super admin
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    const { id } = req.params;
    const { status } = req.body;

    if (!["aktif", "tidak_aktif"].includes(status)) {
      return res.status(400).json({ error: "Status tidak valid" });
    }

    const connection = await getConnection();
    await connection.execute(
      "UPDATE sekolah SET status = ?, updated_at = NOW() WHERE id = ?",
      [status, id]
    );
    await connection.end();

    console.log("Status sekolah berhasil diupdate:", id);
    res.json({ message: "Status sekolah berhasil diupdate" });
  } catch (error) {
    console.error("ERROR UPDATE STATUS SEKOLAH:", error.message);
    res.status(500).json({ error: "Gagal mengupdate status sekolah" });
  }
});

// Endpoint untuk mendapatkan grade levels dari school_configs
app.get(
  "/api/school-configs/grade-levels",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Mengambil data grade levels dari school_configs");

      const connection = await getConnection();

      // Ambil data dari tabel school_configs
      const [configs] = await connection.execute(
        "SELECT value FROM school_configs WHERE config_key = 'grade_levels'"
      );

      await connection.end();

      if (configs.length === 0) {
        // Jika tidak ada konfigurasi, kembalikan default
        console.log(
          "Konfigurasi grade_levels tidak ditemukan, menggunakan default"
        );
        return res.json([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      }

      try {
        const gradeLevels = JSON.parse(configs[0].value);
        console.log("Grade levels ditemukan:", gradeLevels);
        res.json(gradeLevels);
      } catch (parseError) {
        console.error("ERROR PARSING GRADE LEVELS:", parseError.message);
        res.json([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      }
    } catch (error) {
      console.error("ERROR GET GRADE LEVELS:", error.message);
      res.status(500).json({ error: "Gagal mengambil data grade levels" });
    }
  }
);
// Kelola Kelas
// Kelola Kelas (WITH PAGINATION & FILTER)
app.get("/api/kelas", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { page, limit, grade_level, search, wali_kelas_id } = req.query;

    console.log("Mengambil data kelas dengan filter:", {
      grade_level,
      search,
      wali_kelas_id,
    });
    console.log("Pagination:", { page, limit });

    const connection = await getConnection();

    // Build filter conditions
    const conditions = ["k.sekolah_id = ?"];
    const params = [req.sekolah_id];

    if (grade_level) {
      conditions.push("k.grade_level = ?");
      params.push(grade_level);
    }
    if (wali_kelas_id) {
      conditions.push("k.wali_kelas_id = ?");
      params.push(wali_kelas_id);
    }
    if (search) {
      conditions.push("k.nama LIKE ?");
      params.push(`%${search}%`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Build pagination
    const { limitClause, currentPage, perPage } = buildPaginationQuery(
      page,
      limit
    );

    // Count total items
    const countQuery = `
      SELECT COUNT(*) as total
      FROM kelas k 
      ${whereClause}
    `;
    const [countResult] = await connection.execute(countQuery, params);
    const totalItems = countResult[0].total;

    // Get paginated data
    const dataQuery = `
      SELECT 
        k.*, 
        u.nama as wali_kelas_nama,
        (SELECT COUNT(*) FROM siswa s WHERE s.kelas_id = k.id) as jumlah_siswa
      FROM kelas k 
      LEFT JOIN users u ON k.wali_kelas_id = u.id
      ${whereClause}
      ORDER BY k.grade_level ASC, k.nama ASC
      ${limitClause}
    `;
    const [kelas] = await connection.execute(dataQuery, params);

    await connection.end();

    // Calculate pagination metadata
    const pagination = calculatePaginationMeta(
      totalItems,
      currentPage,
      perPage
    );

    console.log(`✅ Data kelas: ${kelas.length} items (Total: ${totalItems})`);

    res.json({
      success: true,
      data: kelas,
      pagination,
    });
  } catch (error) {
    console.error("ERROR GET KELAS:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kelas" });
  }
});

// Get Filter Options for Kelas
app.get(
  "/api/kelas/filter-options",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Mengambil filter options untuk kelas");
      const connection = await getConnection();

      // Get available grade levels
      const [gradeLevels] = await connection.execute(
        `SELECT DISTINCT grade_level 
       FROM kelas 
       WHERE sekolah_id = ? 
       ORDER BY grade_level ASC`,
        [req.sekolah_id]
      );

      // Get available wali kelas
      const [waliKelas] = await connection.execute(
        `SELECT DISTINCT u.id, u.nama
       FROM users u
       INNER JOIN kelas k ON u.id = k.wali_kelas_id
       WHERE k.sekolah_id = ?
       ORDER BY u.nama ASC`,
        [req.sekolah_id]
      );

      await connection.end();

      res.json({
        success: true,
        data: {
          grade_levels: gradeLevels.map((g) => g.grade_level).filter(Boolean),
          wali_kelas: waliKelas,
        },
      });

      console.log("✅ Filter options berhasil diambil");
    } catch (error) {
      console.error("ERROR GET FILTER OPTIONS:", error.message);
      res.status(500).json({ error: "Gagal mengambil filter options" });
    }
  }
);

app.post("/api/export-classes", async (req, res) => {
  try {
    const { classes } = req.body;

    if (!classes || !Array.isArray(classes)) {
      return res.status(400).json({
        success: false,
        message: "Data kelas tidak valid",
      });
    }

    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for Excel
    const excelData = [
      // Header row
      ["Nama Kelas*", "Grade Level*", "Wali Kelas", "Jumlah Siswa", "Status"],
      // Data rows
      ...classes.map((classItem) => [
        classItem.nama || "",
        classItem.grade_level?.toString() || "",
        classItem.wali_kelas_nama || "-",
        classItem.jumlah_siswa?.toString() || "0",
        "Active",
      ]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Add style to header row (basic styling)
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    for (let i = 0; i < 5; i++) {
      worksheet["!cols"][i] = { width: 15 };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data Kelas");

    // Generate filename
    const filename = `Data_Kelas_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading file:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh file",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Export classes error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengexport data: ${error.message}`,
    });
  }
});

// Download template Excel untuk kelas
app.get("/api/download-class-template", async (req, res) => {
  try {
    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare template data
    const templateData = [
      // Header row
      ["Nama Kelas", "Grade Level", "Wali Kelas"],
      // Example data
      ["7A", "10", "Budi Santoso"],
      ["7B", "10", "Siti Rahayu"],
      ["7B", "11", "Ahmad Wijaya"],
      // Empty row
      [],
      // Notes
      ["* Wajib diisi"],
      ["Grade Level: 1-12 (SD-SMA)"],
      ["Wali Kelas: Nama guru yang terdaftar"],
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);

    // Set column widths
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    for (let i = 0; i < 3; i++) {
      worksheet["!cols"][i] = { width: 20 };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template Kelas");

    // Generate filename
    const filename = "Template_Import_Kelas.xlsx";
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading template:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh template",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Class template download error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengunduh template: ${error.message}`,
    });
  }
});

// Download template CSV untuk kelas
app.get("/api/download-class-template-csv", async (req, res) => {
  try {
    const csvContent = `Nama Kelas*,Grade Level*,Wali Kelas
X IPA 1,10,Budi Santoso
X IPA 2,10,Siti Rahayu
XI IPA 1,11,Ahmad Wijaya

*Wajib diisi
Grade Level: 1-12 (SD-SMA)
Wali Kelas: Nama guru yang terdaftar`;

    // Generate filename
    const filename = "Template_Import_Kelas.csv";
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write CSV file
    fs.writeFileSync(filePath, csvContent, "utf8");

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading CSV template:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh template CSV",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("CSV template download error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengunduh template CSV: ${error.message}`,
    });
  }
});

// Validasi data kelas sebelum import
app.post("/api/validate-classes", async (req, res) => {
  try {
    const { classes } = req.body;

    if (!classes || !Array.isArray(classes)) {
      return res.status(400).json({
        success: false,
        message: "Data kelas tidak valid",
      });
    }

    const validatedData = [];
    const errors = [];

    for (let i = 0; i < classes.length; i++) {
      const classItem = classes[i];
      const validatedClass = {};
      let hasError = false;

      // Validasi field required
      if (!classItem.nama || classItem.nama.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: Nama kelas tidak boleh kosong`);
        hasError = true;
      } else {
        validatedClass.nama = classItem.nama;
      }

      if (
        classItem.grade_level === null ||
        classItem.grade_level === undefined
      ) {
        errors.push(`Baris ${i + 1}: Grade level tidak boleh kosong`);
        hasError = true;
      } else {
        const gradeLevel = parseInt(classItem.grade_level);
        if (isNaN(gradeLevel) || gradeLevel < 1 || gradeLevel > 12) {
          errors.push(`Baris ${i + 1}: Grade level harus antara 1-12`);
          hasError = true;
        } else {
          validatedClass.grade_level = gradeLevel;
        }
      }

      // Field optional
      validatedClass.wali_kelas_nama = classItem.wali_kelas_nama || "";
      validatedClass.jumlah_siswa = classItem.jumlah_siswa || 0;

      if (!hasError) {
        validatedData.push(validatedClass);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validasi data gagal",
        errors: errors,
        validatedData: validatedData,
      });
    }

    res.json({
      success: true,
      message: "Validasi data berhasil",
      validatedData: validatedData,
    });
  } catch (error) {
    console.error("Class validation error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal validasi data: ${error.message}`,
    });
  }
});

// Di index.js - Update endpoint POST kelas
app.post("/api/kelas", authenticateTokenAndSchool, async (req, res) => {
  try {
    console.log("Menambah kelas baru:", req.body);
    const { nama, wali_kelas_id, grade_level } = req.body;

    // Validasi field wajib
    if (!nama) {
      return res.status(400).json({ error: "Nama kelas harus diisi" });
    }

    const id = crypto.randomUUID();

    // Konversi undefined ke null untuk MySQL
    const cleanWaliKelasId = wali_kelas_id !== undefined ? wali_kelas_id : null;
    const cleanGradeLevel = grade_level !== undefined ? grade_level : null;

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO kelas (id, nama, wali_kelas_id, grade_level, sekolah_id) VALUES (?, ?, ?, ?, ?)",
      [id, nama, cleanWaliKelasId, cleanGradeLevel, req.sekolah_id]
    );
    await connection.end();

    console.log("Kelas berhasil ditambahkan:", id);
    res.json({ message: "Kelas berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST KELAS:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah kelas" });
  }
});

app.put("/api/kelas/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update kelas:", id, req.body);
    const { nama, wali_kelas_id, grade_level } = req.body;

    // Validasi field wajib
    if (!nama) {
      return res.status(400).json({ error: "Nama kelas harus diisi" });
    }

    // Konversi undefined ke null untuk MySQL
    const cleanWaliKelasId = wali_kelas_id !== undefined ? wali_kelas_id : null;
    const cleanGradeLevel = grade_level !== undefined ? grade_level : null;

    const connection = await getConnection();

    // Cek apakah kelas termasuk dalam sekolah yang sama
    const [existingClass] = await connection.execute(
      "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id]
    );

    if (existingClass.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
    }

    await connection.execute(
      "UPDATE kelas SET nama = ?, wali_kelas_id = ?, grade_level = ? WHERE id = ? AND sekolah_id = ?",
      [nama, cleanWaliKelasId, cleanGradeLevel, id, req.sekolah_id]
    );
    await connection.end();

    console.log("Kelas berhasil diupdate:", id);
    res.json({ message: "Kelas berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT KELAS:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate kelas" });
  }
});

// Delete Kelas
app.delete("/api/kelas/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete kelas:", id);

    const connection = await getConnection();

    // Cek apakah kelas termasuk dalam sekolah yang sama
    const [existingClass] = await connection.execute(
      "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id]
    );

    if (existingClass.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
    }

    // Cek jika kelas memiliki siswa
    const [siswa] = await connection.execute(
      "SELECT id FROM siswa WHERE kelas_id = ?",
      [id]
    );

    if (siswa.length > 0) {
      await connection.end();
      return res.status(400).json({
        error: "Kelas tidak dapat dihapus karena masih memiliki siswa",
      });
    }

    await connection.execute(
      "DELETE FROM kelas WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id] // Tambahkan sekolah_id di WHERE
    );
    await connection.end();

    console.log("Kelas berhasil dihapus:", id);
    res.json({ message: "Kelas berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE KELAS:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus kelas" });
  }
});

// Endpoint untuk download template kelas
app.get("/api/kelas/template", authenticateTokenAndSchool, async (req, res) => {
  try {
    const XLSX = require("xlsx");

    // Data contoh untuk template kelas
    const templateData = [
      {
        nama: "X IPA 1",
        grade_level: "10",
        wali_kelas_nama: "Budi Santoso",
      },
      {
        nama: "X IPA 2",
        grade_level: "10",
        wali_kelas_nama: "Siti Rahayu",
      },
      {
        nama: "XI IPA 1",
        grade_level: "11",
        wali_kelas_nama: "Ahmad Wijaya",
      },
    ];

    // Buat workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(templateData);

    // Tambahkan worksheet ke workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template Kelas");

    // Set header
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="template_import_kelas.xlsx"'
    );

    // Tulis ke response
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.send(buffer);
  } catch (error) {
    console.error("ERROR DOWNLOAD TEMPLATE KELAS:", error.message);
    res.status(500).json({ error: "Gagal mendownload template kelas" });
  }
});

// Get Kelas by ID
app.get("/api/kelas/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data kelas by ID:", id);

    const connection = await getConnection();
    const [kelas] = await connection.execute(
      `SELECT k.*, u.nama as wali_kelas_nama 
       FROM kelas k 
       LEFT JOIN users u ON k.wali_kelas_id = u.id 
       WHERE k.id = ? AND k.sekolah_id = ?`, // Tambahkan sekolah_id di WHERE
      [id, req.sekolah_id]
    );
    await connection.end();

    if (kelas.length === 0) {
      return res.status(404).json({ error: "Kelas tidak ditemukan" });
    }

    console.log("Berhasil mengambil data kelas:", id);
    res.json(kelas[0]);
  } catch (error) {
    console.error("ERROR GET KELAS BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kelas" });
  }
});

// Kelola Guru
// Kelola Guru (WITH PAGINATION & FILTER)
app.get("/api/guru", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { page, limit, search, kelas_id, jenis_kelamin } = req.query;

    console.log("Mengambil data guru dengan filter:", {
      search,
      kelas_id,
      jenis_kelamin,
    });
    console.log("Pagination:", { page, limit });

    const connection = await getConnection();

    // Build filter conditions for new guru table structure
    const conditions = ["g.sekolah_id = ?"];
    const params = [req.sekolah_id];

    if (search) {
      conditions.push("(g.nama LIKE ? OR u.email LIKE ? OR g.nip LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (kelas_id) {
      // Check if teacher teaches this class via guru_kelas junction table
      conditions.push(
        "EXISTS (SELECT 1 FROM guru_kelas gk WHERE gk.guru_id = g.id AND gk.kelas_id = ?)"
      );
      params.push(kelas_id);
    }
    if (jenis_kelamin) {
      conditions.push("g.jenis_kelamin = ?");
      params.push(jenis_kelamin);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Build pagination
    const { limitClause, currentPage, perPage } = buildPaginationQuery(
      page,
      limit
    );

    // Count total items
    const countQuery = `
      SELECT COUNT(*) as total
      FROM guru g
      INNER JOIN users u ON g.user_id = u.id
      ${whereClause}
    `;
    const [countResult] = await connection.execute(countQuery, params);
    const totalItems = countResult[0].total;

    // Get paginated data with aggregated subjects and classes
    const dataQuery = `
      SELECT 
        g.id,
        g.user_id,
        g.nama,
        g.nip,
        g.jenis_kelamin,
        g.wali_kelas_id,
        g.status_kepegawaian,
        g.sekolah_id,
        g.created_at,
        g.updated_at,
        u.email,
        wk.nama as wali_kelas_nama,
        GROUP_CONCAT(DISTINCT mp.id) as mata_pelajaran_ids,
        GROUP_CONCAT(DISTINCT mp.nama) as mata_pelajaran_names,
        GROUP_CONCAT(DISTINCT k.id) as kelas_ids,
        GROUP_CONCAT(DISTINCT k.nama) as kelas_names,
        CASE WHEN g.wali_kelas_id IS NOT NULL THEN 1 ELSE 0 END as is_wali_kelas
      FROM guru g
      INNER JOIN users u ON g.user_id = u.id
      LEFT JOIN kelas wk ON g.wali_kelas_id = wk.id
      LEFT JOIN guru_mata_pelajaran gmp ON g.id = gmp.guru_id
      LEFT JOIN mata_pelajaran mp ON gmp.mata_pelajaran_id = mp.id
      LEFT JOIN guru_kelas gk ON g.id = gk.guru_id
      LEFT JOIN kelas k ON gk.kelas_id = k.id
      ${whereClause}
      GROUP BY g.id, g.user_id, g.nama, g.nip, g.jenis_kelamin, g.wali_kelas_id, 
               g.status_kepegawaian, g.sekolah_id, g.created_at, g.updated_at,
               u.email, wk.nama
      ORDER BY g.nama ASC
      ${limitClause}
    `;
    const [guru] = await connection.execute(dataQuery, params);

    await connection.end();

    // Calculate pagination metadata
    const pagination = calculatePaginationMeta(
      totalItems,
      currentPage,
      perPage
    );

    console.log(`✅ Data guru: ${guru.length} items (Total: ${totalItems})`);

    res.json({
      success: true,
      data: guru,
      pagination,
    });
  } catch (error) {
    console.error("ERROR GET GURU:", error.message);
    res.status(500).json({ error: "Gagal mengambil data guru" });
  }
});

// Get Filter Options for Guru
app.get(
  "/api/guru/filter-options",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Mengambil filter options untuk guru");
      const connection = await getConnection();

      // Get available kelas
      const [kelas] = await connection.execute(
        `SELECT id, nama, grade_level 
       FROM kelas 
       WHERE sekolah_id = ? 
       ORDER BY grade_level ASC, nama ASC`,
        [req.sekolah_id]
      );

      // Gender options (static)
      const genderOptions = [
        { value: "L", label: "Laki-laki" },
        { value: "P", label: "Perempuan" },
      ];

      await connection.end();

      res.json({
        success: true,
        data: {
          kelas: kelas,
          gender_options: genderOptions,
        },
      });

      console.log("✅ Filter options berhasil diambil");
    } catch (error) {
      console.error("ERROR GET FILTER OPTIONS:", error.message);
      res.status(500).json({ error: "Gagal mengambil filter options" });
    }
  }
);

// Delete Guru
app.delete("/api/guru/:id", authenticateTokenAndSchool, async (req, res) => {
  let connection;
  try {
    const { id } = req.params; // This is guru.id
    console.log("Delete guru:", id);

    connection = await getConnection();

    // Check if guru exists and belongs to the same school
    const [existingGuru] = await connection.execute(
      "SELECT g.id, g.user_id, g.wali_kelas_id FROM guru g WHERE g.id = ? AND g.sekolah_id = ?",
      [id, req.sekolah_id]
    );

    if (existingGuru.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
    }

    const userId = existingGuru[0].user_id;
    const waliKelasId = existingGuru[0].wali_kelas_id;

    // Check if guru is assigned as homeroom teacher
    if (waliKelasId) {
      await connection.end();
      return res.status(400).json({
        error: "Guru tidak dapat dihapus karena masih menjadi wali kelas",
      });
    }

    // Delete guru record (CASCADE will delete from guru_mata_pelajaran and guru_kelas)
    await connection.execute(
      "DELETE FROM guru WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id]
    );

    // Delete user record (if you want to also delete the user account)
    // Optional: you might want to keep the user account but just remove guru role
    await connection.execute("DELETE FROM users WHERE id = ?", [userId]);

    await connection.end();

    console.log("✅ Guru berhasil dihapus:", id);
    res.json({
      success: true,
      message: "Guru berhasil dihapus",
    });
  } catch (error) {
    if (connection) await connection.end();

    console.error("ERROR DELETE GURU:", error.message);
    res.status(500).json({ error: "Gagal menghapus guru: " + error.message });
  }
});

// Export Teachers to Excel
app.post("/api/export-teachers", authenticateTokenAndSchool, async (req, res) => {
  let connection;
  try {
    const { teachers } = req.body;

    if (!teachers || !Array.isArray(teachers)) {
      return res.status(400).json({
        success: false,
        message: "Data guru tidak valid",
      });
    }

    console.log(`Processing ${teachers.length} teachers for export...`);

    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Fetch complete data for teachers if needed
    connection = await getConnection();

    const enrichedTeachers = await Promise.all(
      teachers.map(async (teacher, index) => {
        // If teacher already has complete data, use it
        let subjectNames = teacher.mata_pelajaran_names || "";
        let classNames = teacher.kelas_names || "";

        // If data is missing, fetch from database
        if ((!subjectNames || !classNames) && teacher.id) {
          try {
            const [teacherData] = await connection.execute(
              `SELECT 
                GROUP_CONCAT(DISTINCT mp.nama) as mata_pelajaran_names,
                GROUP_CONCAT(DISTINCT k.nama) as kelas_names
               FROM guru g
               LEFT JOIN guru_mata_pelajaran gmp ON g.id = gmp.guru_id
               LEFT JOIN mata_pelajaran mp ON gmp.mata_pelajaran_id = mp.id
               LEFT JOIN guru_kelas gk ON g.id = gk.guru_id
               LEFT JOIN kelas k ON gk.kelas_id = k.id
               WHERE g.id = ?
               GROUP BY g.id`,
              [teacher.id]
            );

            if (teacherData && teacherData.length > 0) {
              subjectNames = teacherData[0].mata_pelajaran_names || "";
              classNames = teacherData[0].kelas_names || "";
            }
          } catch (err) {
            console.error(`Error fetching data for teacher ${teacher.id}:`, err);
          }
        }

        return {
          ...teacher,
          mata_pelajaran_names: subjectNames,
          kelas_names: classNames,
        };
      })
    );

    await connection.end();

    // Prepare data for Excel
    const excelData = [
      // Header row
      [
        "Nama*",
        "Email*",
        "NIP",
        "Jenis Kelamin*",
        "Mata Pelajaran",
        "Kelas",
        "Wali Kelas",
        "Status Kepegawaian",
      ],
      // Data rows
      ...enrichedTeachers.map((teacher) => [
        teacher.nama || "",
        teacher.email || "",
        teacher.nip || "",
        teacher.jenis_kelamin === "L"
          ? "Laki-laki"
          : teacher.jenis_kelamin === "P"
          ? "Perempuan"
          : "",
        teacher.mata_pelajaran_names || "",
        teacher.kelas_names || "",
        teacher.wali_kelas_nama || "",
        teacher.status_kepegawaian || "",
      ]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    worksheet["!cols"] = [
      { width: 25 }, // Nama
      { width: 30 }, // Email
      { width: 18 }, // NIP
      { width: 15 }, // Jenis Kelamin
      { width: 30 }, // Mata Pelajaran
      { width: 25 }, // Kelas
      { width: 15 }, // Wali Kelas
      { width: 20 }, // Status Kepegawaian
    ];

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data Guru");

    // Generate filename
    const filename = `Data_Guru_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading file:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh file",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    if (connection) await connection.end();
    console.error("Export teachers error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengexport data: ${error.message}`,
    });
  }
});

// Download Template Excel untuk Guru
app.get("/api/download-teacher-template", async (req, res) => {
  try {
    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare template data
    const templateData = [
      // Header row
      [
        "Nama*",
        "Email*",
        "NIP",
        "Jenis Kelamin*",
        "Mata Pelajaran",
        "Kelas",
        "Wali Kelas",
        "Status Kepegawaian",
      ],
      // Example data
      [
        "Budi Santoso",
        "budi@school.com",
        "198501012010011001",
        "Laki-laki",
        "Matematika,IPA",
        "7A,7B",
        "7A",
        "tetap",
      ],
      [
        "Siti Aminah",
        "siti@school.com",
        "198705022011012002",
        "Perempuan",
        "Bahasa Indonesia",
        "8A,8B,8C",
        "",
        "tetap",
      ],
      [
        "Ahmad Hidayat",
        "ahmad@school.com",
        "",
        "Laki-laki",
        "Bahasa Inggris,PKN",
        "9A",
        "",
        "tidak_tetap",
      ],
      // Empty row
      [],
      // Notes
      ["* Wajib diisi"],
      ["Jenis Kelamin: Laki-laki atau Perempuan"],
      ["Mata Pelajaran: Pisahkan dengan koma jika multiple (contoh: Matematika,IPA)"],
      ["Kelas: Pisahkan dengan koma jika multiple (contoh: 7A,7B,8A)"],
      ["Wali Kelas: Isi nama kelas jika guru menjadi wali kelas (contoh: 7A)"],
      [
        "Status Kepegawaian: tetap atau tidak_tetap (kosongkan jika tidak ada)",
      ],
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);

    // Set column widths
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    worksheet["!cols"] = [
      { width: 25 }, // Nama
      { width: 30 }, // Email
      { width: 18 }, // NIP
      { width: 15 }, // Jenis Kelamin
      { width: 30 }, // Mata Pelajaran
      { width: 25 }, // Kelas
      { width: 15 }, // Wali Kelas
      { width: 20 }, // Status Kepegawaian
    ];

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template Guru");

    // Generate filename
    const filename = "Template_Import_Guru.xlsx";
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading template:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh template",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Download template error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengunduh template: ${error.message}`,
    });
  }
});

// Import Guru dari Excel
app.post(
  "/api/import-teachers",
  authenticateTokenAndSchool,
  excelUploadMiddleware,
  async (req, res) => {
    let connection;
    try {
      console.log("Import guru dari Excel (memory storage)");
      console.log("User's sekolah_id:", req.sekolah_id);

      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received in memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer.length,
      });

      // Read Excel file from buffer
      const importedTeachers = await readExcelTeachersFromBufferNew(
        req.file.buffer
      );

      if (importedTeachers.length === 0) {
        return res.status(400).json({
          error: "Tidak ada data guru yang valid ditemukan dalam file",
        });
      }

      console.log(`Found ${importedTeachers.length} teachers to import`);

      // Get reference data (subjects and classes from this school)
      connection = await getConnection();
      
      const [subjectList] = await connection.execute(
        "SELECT id, nama FROM mata_pelajaran WHERE sekolah_id = ?",
        [req.sekolah_id]
      );
      
      const [classList] = await connection.execute(
        "SELECT id, nama FROM kelas WHERE sekolah_id = ?",
        [req.sekolah_id]
      );
      
      await connection.end();

      // Process import with sekolah_id
      const result = await processTeacherImportNew(
        importedTeachers,
        subjectList,
        classList,
        req.sekolah_id
      );

      console.log("Import completed:", result);
      res.json({
        message: "Import selesai",
        ...result,
      });
    } catch (error) {
      if (connection) {
        await connection.end();
      }

      console.error("ERROR IMPORT GURU:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengimport guru: " + error.message,
      });
    }
  }
);

// Helper function: Read Excel teachers from buffer
async function readExcelTeachersFromBufferNew(buffer) {
  const XLSX = require("xlsx");

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const data = XLSX.utils.sheet_to_json(worksheet);

  console.log("Raw Excel data from buffer:", data);

  const teachers = [];

  data.forEach((row, index) => {
    try {
      const teacherData = mapExcelRowToTeacherNew(row, index + 2);
      if (teacherData) {
        teachers.push(teacherData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${teachers.length} teachers from Excel buffer`);
  return teachers;
}

// Helper function: Map Excel row to teacher object
// Helper function: Map Excel row to teacher object (NEW LOGIC - supports multiple classes/subjects)
function mapExcelRowToTeacherNew(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  // Map columns
  const nama = normalizedRow["nama"] || normalizedRow["nama*"] || "";
  const email = normalizedRow["email"] || normalizedRow["email*"] || "";
  const nip = normalizedRow["nip"] || "";
  
  let jenisKelamin = (normalizedRow["jenis kelamin"] || normalizedRow["jenis kelamin*"] || "").toString().trim();
  
  // Normalize gender values
  if (jenisKelamin.toLowerCase() === "laki-laki" || jenisKelamin.toLowerCase() === "l") {
    jenisKelamin = "L";
  } else if (jenisKelamin.toLowerCase() === "perempuan" || jenisKelamin.toLowerCase() === "p") {
    jenisKelamin = "P";
  }

  const mataPelajaranNames = normalizedRow["mata pelajaran"] || "";
  const kelasNames = normalizedRow["kelas"] || "";
  const waliKelasNama = normalizedRow["wali kelas"] || "";
  
  let statusKepegawaian = (normalizedRow["status kepegawaian"] || "").toString().trim().toLowerCase();
  
  // Normalize employment status
  if (statusKepegawaian && !["tetap", "tidak_tetap"].includes(statusKepegawaian)) {
    statusKepegawaian = ""; // Invalid value, set to empty
  }

  // Validate required fields
  if (!nama || !email || !jenisKelamin) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      nama,
      email,
      jenisKelamin,
    });
    return null;
  }

  const teacher = {
    nama: nama.toString().trim(),
    email: email.toString().trim(),
    nip: nip ? nip.toString().trim() : null,
    jenis_kelamin: jenisKelamin,
    mata_pelajaran_names: mataPelajaranNames.toString().trim(),
    kelas_names: kelasNames.toString().trim(),
    wali_kelas_nama: waliKelasNama ? waliKelasNama.toString().trim() : null,
    status_kepegawaian: statusKepegawaian || null,
    row_number: rowNumber,
  };

  console.log(`Mapped teacher data for row ${rowNumber}:`, teacher);
  return teacher;
}

// Helper function: Process teacher import
async function processTeacherImportNew(
  importedTeachers,
  subjectList,
  classList,
  sekolahId
) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const teacherData of importedTeachers) {
      try {
        // Validate required fields
        if (!teacherData.nama || !teacherData.email || !teacherData.jenis_kelamin) {
          results.failed++;
          results.errors.push(
            `Baris ${teacherData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        // Check for duplicate email (within same school)
        const [existingEmail] = await connection.execute(
          "SELECT u.id FROM users u INNER JOIN users_schools us ON u.id = us.user_id WHERE u.email = ? AND us.sekolah_id = ?",
          [teacherData.email, sekolahId]
        );

        if (existingEmail.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${teacherData.row_number}: Email '${teacherData.email}' sudah terdaftar di sekolah ini`
          );
          continue;
        }

        // Start transaction for this teacher
        await connection.beginTransaction();

        try {
          const userId = crypto.randomUUID();
          const guruId = crypto.randomUUID();
          const password = "password123";
          const hashedPassword = await bcrypt.hash(password, 10);
          const createdAt = new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " ");

          // 1. Create user
          await connection.execute(
            'INSERT INTO users (id, nama, email, password, role, sekolah_id, created_at, updated_at) VALUES (?, ?, ?, ?, "guru", ?, ?, ?)',
            [userId, teacherData.nama, teacherData.email, hashedPassword, sekolahId, createdAt, createdAt]
          );

          // 2. Create user_schools
          const userSchoolId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO users_schools (id, user_id, sekolah_id, is_active, created_at) VALUES (?, ?, ?, TRUE, ?)",
            [userSchoolId, userId, sekolahId, createdAt]
          );

          // 3. Create users_roles
          await connection.execute(
            "INSERT INTO users_roles (user_school_id, role, is_active, created_at) VALUES (?, ?, TRUE, ?)",
            [userSchoolId, "guru", createdAt]
          );

          // 4. Find wali_kelas_id if provided
          let waliKelasId = null;
          if (teacherData.wali_kelas_nama) {
            const kelasItem = classList.find(
              (cls) => cls.nama.toLowerCase() === teacherData.wali_kelas_nama.toLowerCase()
            );
            if (kelasItem) {
              waliKelasId = kelasItem.id;
            } else {
              console.log(`Warning: Wali kelas '${teacherData.wali_kelas_nama}' not found for row ${teacherData.row_number}`);
            }
          }

          // 5. Create guru record
          await connection.execute(
            "INSERT INTO guru (id, user_id, nama, nip, jenis_kelamin, wali_kelas_id, status_kepegawaian, sekolah_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              guruId,
              userId,
              teacherData.nama,
              teacherData.nip,
              teacherData.jenis_kelamin,
              waliKelasId,
              teacherData.status_kepegawaian,
              sekolahId,
              createdAt,
              createdAt,
            ]
          );

          // 6. Add subject assignments
          if (teacherData.mata_pelajaran_names) {
            const subjectNames = teacherData.mata_pelajaran_names
              .split(",")
              .map((name) => name.trim())
              .filter((name) => name !== "");

            for (const subjectName of subjectNames) {
              const subjectItem = subjectList.find(
                (sub) => sub.nama.toLowerCase() === subjectName.toLowerCase()
              );

              if (subjectItem) {
                const relationId = crypto.randomUUID();
                await connection.execute(
                  "INSERT INTO guru_mata_pelajaran (id, guru_id, mata_pelajaran_id, sekolah_id, created_at) VALUES (?, ?, ?, ?, ?)",
                  [relationId, guruId, subjectItem.id, sekolahId, createdAt]
                );
              } else {
                console.log(`Warning: Subject '${subjectName}' not found for row ${teacherData.row_number}`);
              }
            }
          }

          // 7. Add class assignments
          if (teacherData.kelas_names) {
            const kelasNames = teacherData.kelas_names
              .split(",")
              .map((name) => name.trim())
              .filter((name) => name !== "");

            let allClassesFound = true;
            const missingClasses = [];

            for (const kelasName of kelasNames) {
              // Debug logging
              console.log(`Searching for class: '${kelasName}' (length: ${kelasName.length})`);
              
              // Log available classes for debugging (only first 5 to avoid spam)
              if (teacherData.row_number === 2) { 
                 console.log("Import Sekolah ID:", sekolahId);
                 console.log("Available classes in DB:", classList.map(c => `'${c.nama}'`).join(", "));
                 
                 // Deep debug for "7A" mismatch
                 if (kelasName === '7A') {
                    console.log(`DEBUG '7A' MISMATCH:`);
                    console.log(`Input '7A' codes: ${kelasName.split('').map(c => c.charCodeAt(0)).join(',')}`);
                    
                    const dbClass = classList.find(c => c.nama.includes('7A'));
                    if (dbClass) {
                        console.log(`DB '${dbClass.nama}' codes: ${dbClass.nama.split('').map(c => c.charCodeAt(0)).join(',')}`);
                        console.log(`Strict match: ${dbClass.nama === kelasName}`);
                        console.log(`LowerCase match: ${dbClass.nama.toLowerCase() === kelasName.toLowerCase()}`);
                    } else {
                        console.log("No class containing '7A' found in DB list for this school");
                    }
                 }
              }

              const kelasItem = classList.find(
                (cls) => cls.nama.toLowerCase() === kelasName.toLowerCase()
              );

              if (kelasItem) {
                const relationId = crypto.randomUUID();
                await connection.execute(
                  "INSERT INTO guru_kelas (id, guru_id, kelas_id, sekolah_id, created_at) VALUES (?, ?, ?, ?, ?)",
                  [relationId, guruId, kelasItem.id, sekolahId, createdAt]
                );
              } else {
                allClassesFound = false;
                missingClasses.push(kelasName);
                console.log(`Warning: Class '${kelasName}' not found for row ${teacherData.row_number}`);
              }
            }

            // If any classes not found, rollback and fail this row
            if (!allClassesFound) {
              await connection.rollback();
              results.failed++;
              results.errors.push(
                `Baris ${teacherData.row_number}: Kelas '${missingClasses.join(", ")}' tidak ditemukan`
              );
              continue;
            }
          }

          await connection.commit();
          results.success++;
          console.log(`✅ Successfully imported teacher: ${teacherData.email}`);
        } catch (transactionError) {
          await connection.rollback();
          throw transactionError;
        }
      } catch (teacherError) {
        results.failed++;
        results.errors.push(
          `Baris ${teacherData.row_number}: ${teacherError.message}`
        );
        console.error(
          `Error importing teacher ${teacherData.email}:`,
          teacherError.message
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}


// Kelola Siswa (WITH PAGINATION & FILTER)
app.get("/api/siswa", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { page, limit, ...filters } = req.query;

    console.log("Mengambil data siswa dengan filter:", filters);
    console.log("Pagination:", { page, limit });

    const connection = await getConnection();

    // Build filter query
    const { whereClause, params: filterParams } = buildFilterQuery(
      filters,
      "s"
    );

    // Build pagination
    const { limitClause, currentPage, perPage } = buildPaginationQuery(
      page,
      limit
    );

    // Count total items
    const countQuery = `
      SELECT COUNT(*) as total
      FROM siswa s 
      LEFT JOIN kelas k ON s.kelas_id = k.id
      WHERE s.sekolah_id = ?
      ${whereClause}
    `;
    const [countResult] = await connection.execute(countQuery, [
      req.sekolah_id,
      ...filterParams,
    ]);
    const totalItems = countResult[0].total;

    // Get paginated data
    const dataQuery = `
      SELECT 
        s.*,
        k.nama as kelas_nama,
        k.grade_level as grade_level
      FROM siswa s 
      LEFT JOIN kelas k ON s.kelas_id = k.id
      WHERE s.sekolah_id = ?
      ${whereClause}
      ORDER BY s.created_at DESC
      ${limitClause}
    `;
    const [siswa] = await connection.execute(dataQuery, [
      req.sekolah_id,
      ...filterParams,
    ]);

    await connection.end();

    // Calculate pagination metadata
    const pagination = calculatePaginationMeta(
      totalItems,
      currentPage,
      perPage
    );

    console.log(`✅ Data siswa: ${siswa.length} items (Total: ${totalItems})`);

    res.json({
      success: true,
      data: siswa,
      pagination,
    });
  } catch (error) {
    console.error("ERROR GET SISWA:", error.message);
    res.status(500).json({ error: "Gagal mengambil data siswa" });
  }
});

// Get Filter Options for Siswa
app.get(
  "/api/siswa/filter-options",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Mengambil filter options untuk siswa");
      const connection = await getConnection();

      // Get available grade levels
      const [gradeLevels] = await connection.execute(
        `SELECT DISTINCT k.grade_level 
       FROM kelas k 
       WHERE k.sekolah_id = ? 
       ORDER BY k.grade_level ASC`,
        [req.sekolah_id]
      );

      // Get available classes
      const [kelas] = await connection.execute(
        `SELECT k.id, k.nama, k.grade_level
       FROM kelas k
       WHERE k.sekolah_id = ?
       ORDER BY k.grade_level ASC, k.nama ASC`,
        [req.sekolah_id]
      );

      // Gender options (static)
      const genderOptions = [
        { value: "L", label: "Laki-laki" },
        { value: "P", label: "Perempuan" },
      ];

      // Status options (static)
      const statusOptions = [
        { value: "active", label: "Aktif" },
        { value: "inactive", label: "Tidak Aktif" },
      ];

      await connection.end();

      res.json({
        success: true,
        data: {
          grade_levels: gradeLevels.map((g) => g.grade_level).filter(Boolean),
          kelas: kelas,
          gender_options: genderOptions,
          status_options: statusOptions,
        },
      });

      console.log("✅ Filter options berhasil diambil");
    } catch (error) {
      console.error("ERROR GET FILTER OPTIONS:", error.message);
      res.status(500).json({ error: "Gagal mengambil filter options" });
    }
  }
);

// Get Siswa by Kelas ID
app.get(
  "/api/siswa/kelas/:kelasId",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { kelasId } = req.params;
      console.log("Mengambil data siswa by kelas ID:", kelasId);

      const connection = await getConnection();

      // Cek apakah kelas termasuk dalam sekolah yang sama
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelasId, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }

      const [siswa] = await connection.execute(
        `SELECT s.*, k.nama as kelas_nama 
         FROM siswa s 
         LEFT JOIN kelas k ON s.kelas_id = k.id 
         WHERE s.kelas_id = ? AND s.sekolah_id = ? 
         ORDER BY s.nama`,
        [kelasId, req.sekolah_id] // Tambahkan sekolah_id
      );
      await connection.end();

      console.log(
        "Berhasil mengambil data siswa untuk kelas:",
        kelasId,
        "jumlah:",
        siswa.length
      );
      res.json(siswa);
    } catch (error) {
      console.error("ERROR GET SISWA BY KELAS:", error.message);
      res.status(500).json({ error: "Gagal mengambil data siswa" });
    }
  }
);



// Import kelas dari Excel
app.post(
  "/api/kelas/import",
  authenticateTokenAndSchool,
  excelUploadMiddleware,
  async (req, res) => {
    let connection;
    try {
      console.log("Import kelas dari Excel (memory storage)");

      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received in memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer.length,
      });

      // Baca file Excel langsung dari buffer
      const importedClasses = await readExcelClassesFromBuffer(req.file.buffer);

      if (importedClasses.length === 0) {
        return res.status(400).json({
          error: "Tidak ada data kelas yang valid ditemukan dalam file",
        });
      }

      console.log(`Found ${importedClasses.length} classes to import`);

      // Ambil data guru untuk mapping wali kelas
      connection = await getConnection();
      const [teacherList] = await connection.execute(
        "SELECT id, nama FROM users WHERE role = 'guru'"
      );
      await connection.end();

      // Proses import
      const result = await processClassImport(
        importedClasses,
        teacherList,
        req.sekolah_id
      );

      console.log("Import completed:", result);
      res.json({
        message: "Import selesai",
        ...result,
      });
    } catch (error) {
      if (connection) {
        await connection.end();
      }

      console.error("ERROR IMPORT KELAS:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengimport kelas: " + error.message,
      });
    }
  }
);

// Fungsi untuk membaca Excel kelas dari buffer
async function readExcelClassesFromBuffer(buffer) {
  // Baca workbook langsung dari buffer
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Konversi ke JSON
  const data = XLSX.utils.sheet_to_json(worksheet);

  console.log("Raw Excel data from buffer:", data);

  const classes = [];

  data.forEach((row, index) => {
    try {
      // Mapping kolom dengan berbagai kemungkinan nama
      const classData = mapExcelRowToClass(row, index + 2);
      if (classData) {
        classes.push(classData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${classes.length} classes from Excel buffer`);
  return classes;
}

// Fungsi mapping row untuk kelas
function mapExcelRowToClass(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  // Mapping berbagai kemungkinan nama kolom
  const nama =
    normalizedRow["nama"] ||
    normalizedRow["name"] ||
    normalizedRow["nama kelas"] ||
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    "";

  const gradeLevel =
    normalizedRow["grade_level"] ||
    normalizedRow["grade level"] ||
    normalizedRow["tingkat"] ||
    normalizedRow["level"] ||
    normalizedRow["tingkat kelas"] ||
    "";

  const waliKelasNama =
    normalizedRow["wali_kelas_nama"] ||
    normalizedRow["wali kelas"] ||
    normalizedRow["nama wali kelas"] ||
    normalizedRow["homeroom teacher"] ||
    normalizedRow["wali"] ||
    "";

  // Jika data required tidak ada, skip
  if (!nama || !gradeLevel) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      nama,
      gradeLevel,
    });
    return null;
  }

  // Validasi grade level
  const cleanGradeLevel = parseInt(gradeLevel);
  if (isNaN(cleanGradeLevel) || cleanGradeLevel < 1 || cleanGradeLevel > 12) {
    console.log(`Skipping row ${rowNumber}: Invalid grade level`, gradeLevel);
    return null;
  }

  const classData = {
    nama: nama.toString().trim(),
    grade_level: cleanGradeLevel,
    wali_kelas_nama: waliKelasNama.toString().trim(),
    row_number: rowNumber,
  };

  console.log(`Mapped class data for row ${rowNumber}:`, classData);
  return classData;
}

// Fungsi processClassImport
async function processClassImport(importedClasses, teacherList, schoolId) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const classData of importedClasses) {
      try {
        // Validasi data required
        if (!classData.nama || !classData.grade_level) {
          results.failed++;
          results.errors.push(
            `Baris ${classData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        // Cek nama kelas duplikat
        const [existingClass] = await connection.execute(
          "SELECT id FROM kelas WHERE nama = ?",
          [classData.nama]
        );

        if (existingClass.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${classData.row_number}: Kelas '${classData.nama}' sudah terdaftar`
          );
          continue;
        }

        // Cari wali_kelas_id berdasarkan nama guru (jika ada)
        let waliKelasId = null;
        if (classData.wali_kelas_nama) {
          const teacherItem = teacherList.find(
            (teacher) =>
              teacher.nama.toLowerCase() ===
              classData.wali_kelas_nama.toLowerCase()
          );

          if (!teacherItem) {
            results.failed++;
            results.errors.push(
              `Baris ${classData.row_number}: Guru '${classData.wali_kelas_nama}' tidak ditemukan`
            );
            continue;
          }
          waliKelasId = teacherItem.id;
        }

        // Mulai transaction untuk kelas ini
        await connection.beginTransaction();

        try {
          const classId = crypto.randomUUID();

          // Insert kelas
          await connection.execute(
            "INSERT INTO kelas (id, nama, grade_level, wali_kelas_id, sekolah_id) VALUES (?, ?, ?, ?, ?)",
            [
              classId,
              classData.nama,
              classData.grade_level,
              waliKelasId,
              schoolId,
            ]
          );

          // Commit transaction
          await connection.commit();
          results.success++;
        } catch (transactionError) {
          // Rollback jika ada error
          await connection.rollback();
          throw transactionError;
        }
      } catch (classError) {
        results.failed++;
        results.errors.push(
          `Baris ${classData.row_number}: ${classError.message}`
        );
        console.error(
          `Error importing class ${classData.nama}:`,
          classError.message
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Debug endpoint untuk melihat data Excel kelas
app.post(
  "/api/debug/excel-kelas",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("Debug Excel file from memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });

      // Baca file Excel langsung dari buffer
      const XLSX = require("xlsx");
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Dapatkan semua data
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      res.json({
        sheet_name: sheetName,
        headers: rawData[0] || [],
        raw_data: rawData,
        json_data: jsonData,
        total_rows: rawData.length,
        file_info: {
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (error) {
      console.error("DEBUG EXCEL KELAS ERROR:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

// Import siswa dari Excel - TANPA SIMPAN FILE
app.post(
  "/api/siswa/import",
  authenticateTokenAndSchool,
  excelUploadMiddleware,
  async (req, res) => {
    let connection;
    try {
      console.log("Import siswa dari Excel (memory storage)");

      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received in memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer.length,
      });

      // Baca file Excel langsung dari buffer
      const importedStudents = await readExcelFromBuffer(req.file.buffer);

      if (importedStudents.length === 0) {
        return res.status(400).json({
          error: "Tidak ada data siswa yang valid ditemukan dalam file",
        });
      }

      console.log(`Found ${importedStudents.length} students to import`);

      // Ambil data kelas untuk mapping
      connection = await getConnection();
      const [classList] = await connection.execute(
        "SELECT id, nama FROM kelas"
      );
      await connection.end();

      // Proses import (pass sekolah_id dari token + authenticateTokenAndSchool)
      const result = await processStudentImport(
        importedStudents,
        classList,
        req.sekolah_id
      );

      console.log("Import completed:", result);
      res.json({
        message: "Import selesai",
        ...result,
      });
    } catch (error) {
      if (connection) {
        await connection.end();
      }

      console.error("ERROR IMPORT SISWA:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengimport siswa: " + error.message,
      });
    }
  }
);

// Fungsi untuk membaca Excel dari buffer (tanpa simpan file)
async function readExcelFromBuffer(buffer) {
  // Baca workbook langsung dari buffer
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Konversi ke JSON
  const data = XLSX.utils.sheet_to_json(worksheet);

  console.log("Raw Excel data from buffer:", data);

  const students = [];

  data.forEach((row, index) => {
    try {
      // Mapping kolom dengan berbagai kemungkinan nama
      const studentData = mapExcelRowToStudent(row, index + 2);
      if (studentData) {
        students.push(studentData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${students.length} students from Excel buffer`);
  return students;
}

// Fungsi mapping row (sama seperti sebelumnya)
function mapExcelRowToStudent(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  // Mapping berbagai kemungkinan nama kolom
  const nis =
    normalizedRow["nis"] ||
    normalizedRow["nomor induk siswa"] ||
    normalizedRow["no induk siswa"] ||
    normalizedRow["nomor induk"] ||
    "";

  const nama =
    normalizedRow["nama"] ||
    normalizedRow["name"] ||
    normalizedRow["nama siswa"] ||
    normalizedRow["nama lengkap"] ||
    "";

  const kelasNama =
    normalizedRow["kelas_nama"] ||
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    normalizedRow["nama kelas"] ||
    "";

  // Jika data required tidak ada, skip
  if (!nis || !nama || !kelasNama) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      nis,
      nama,
      kelasNama,
    });
    return null;
  }

  // Mapping jenis kelamin
  let jenisKelamin = "L"; // default
  const genderValue =
    normalizedRow["jenis_kelamin"] ||
    normalizedRow["jenis kelamin"] ||
    normalizedRow["gender"] ||
    normalizedRow["kelamin"] ||
    "";

  if (genderValue) {
    const normalizedGender = genderValue.toString().toLowerCase().trim();
    if (
      normalizedGender.includes("perempuan") ||
      normalizedGender === "p" ||
      normalizedGender === "female"
    ) {
      jenisKelamin = "P";
    } else if (
      normalizedGender.includes("laki") ||
      normalizedGender === "l" ||
      normalizedGender === "male"
    ) {
      jenisKelamin = "L";
    }
  }

  // Format tanggal lahir
  let tanggalLahir = "";
  const dobValue =
    normalizedRow["tanggal_lahir"] ||
    normalizedRow["tanggal lahir"] ||
    normalizedRow["tgl lahir"] ||
    normalizedRow["date of birth"] ||
    normalizedRow["dob"] ||
    "";

  if (dobValue) {
    tanggalLahir = formatDateFromExcel(dobValue);
  }

  // Mapping lainnya
  const alamat =
    normalizedRow["alamat"] ||
    normalizedRow["address"] ||
    normalizedRow["alamat lengkap"] ||
    "";

  const namaWali =
    normalizedRow["nama_wali"] ||
    normalizedRow["nama wali"] ||
    normalizedRow["wali"] ||
    normalizedRow["parent name"] ||
    "";

  const noTelepon =
    normalizedRow["no_telepon"] ||
    normalizedRow["no telepon"] ||
    normalizedRow["telepon"] ||
    normalizedRow["phone"] ||
    normalizedRow["nomor telepon"] ||
    "";

  const emailWali =
    normalizedRow["email_wali"] ||
    normalizedRow["email wali"] ||
    normalizedRow["email"] ||
    normalizedRow["parent email"] ||
    "";

  const student = {
    nis: nis.toString().trim(),
    nama: nama.toString().trim(),
    kelas_nama: kelasNama.toString().trim(),
    alamat: alamat.toString().trim(),
    tanggal_lahir: tanggalLahir,
    jenis_kelamin: jenisKelamin,
    nama_wali: namaWali.toString().trim(),
    no_telepon: noTelepon.toString().trim(),
    email_wali: emailWali.toString().trim(),
    row_number: rowNumber,
  };

  console.log(`Mapped student data for row ${rowNumber}:`, student);
  return student;
}

// Fungsi processStudentImport (tetap sama seperti sebelumnya)
async function processStudentImport(importedStudents, classList, schoolId) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const studentData of importedStudents) {
      try {
        // Validasi data required
        if (!studentData.nis || !studentData.nama || !studentData.kelas_nama) {
          results.failed++;
          results.errors.push(
            `Baris ${studentData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        // Cari kelas_id berdasarkan nama kelas
        const classItem = classList.find(
          (cls) =>
            cls.nama.toLowerCase() === studentData.kelas_nama.toLowerCase()
        );

        if (!classItem) {
          results.failed++;
          results.errors.push(
            `Baris ${studentData.row_number}: Kelas '${studentData.kelas_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cek NIS duplikat untuk sekolah ini
        const [existingNIS] = await connection.execute(
          "SELECT id FROM siswa WHERE nis = ? AND sekolah_id = ?",
          [studentData.nis, schoolId]
        );

        if (existingNIS.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${studentData.row_number}: NIS '${studentData.nis}' sudah terdaftar`
          );
          continue;
        }

        // Mulai transaction untuk siswa ini
        await connection.beginTransaction();

        try {
          const studentId = crypto.randomUUID();
          const createdAt = new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " ");
          const updatedAt = createdAt;

          // Insert siswa (include sekolah_id and email_wali)
          await connection.execute(
            "INSERT INTO siswa (id, nis, nama, kelas_id, alamat, tanggal_lahir, jenis_kelamin, nama_wali, email_wali, no_telepon, sekolah_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              studentId,
              studentData.nis,
              studentData.nama,
              classItem.id,
              studentData.alamat,
              studentData.tanggal_lahir,
              studentData.jenis_kelamin,
              studentData.nama_wali,
              studentData.email_wali,
              studentData.no_telepon,
              schoolId,
              createdAt,
              updatedAt,
            ]
          );

          // Buat user wali jika email disediakan
          if (studentData.email_wali && studentData.nama_wali) {
            // Cek apakah email sudah terdaftar
            const [existingUsers] = await connection.execute(
              "SELECT id FROM users WHERE email = ?",
              [studentData.email_wali]
            );

            if (existingUsers.length === 0) {
              const waliId = crypto.randomUUID();
              const password = "password123";
              const hashedPassword = await bcrypt.hash(password, 10);

              await connection.execute(
                'INSERT INTO users (id, nama, email, password, role, siswa_id, sekolah_id) VALUES (?, ?, ?, ?, "wali", ?, ?)',
                [
                  waliId,
                  studentData.nama_wali,
                  studentData.email_wali,
                  hashedPassword,
                  studentId,
                  schoolId,
                ]
              );

              // create users_schools and users_roles for imported wali
              try {
                const userSchoolId = crypto.randomUUID();
                await connection.execute(
                  "INSERT INTO users_schools (id, user_id, sekolah_id, is_active, created_at) VALUES (?, ?, ?, TRUE, ?)",
                  [userSchoolId, waliId, schoolId, createdAt]
                );

                await connection.execute(
                  "INSERT INTO users_roles (user_school_id, role, is_active, created_at) VALUES (?, ?, TRUE, ?)",
                  [userSchoolId, "wali", createdAt]
                );
              } catch (e) {
                console.error(
                  "Failed to create users_schools/users_roles for imported wali:",
                  e.message
                );
                throw e;
              }
            }
          }

          // Commit transaction
          await connection.commit();
          results.success++;
        } catch (transactionError) {
          // Rollback jika ada error
          await connection.rollback();
          throw transactionError;
        }
      } catch (studentError) {
        results.failed++;
        results.errors.push(
          `Baris ${studentData.row_number}: ${studentError.message}`
        );
        console.error(
          `Error importing student ${studentData.nis}:`,
          studentError.message
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Debug endpoint untuk melihat data Excel (memory storage)
app.post(
  "/api/debug/excel",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("Debug Excel file from memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });

      // Baca file Excel langsung dari buffer
      const XLSX = require("xlsx");
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Dapatkan semua data
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      res.json({
        sheet_name: sheetName,
        headers: rawData[0] || [],
        raw_data: rawData,
        json_data: jsonData,
        total_rows: rawData.length,
        file_info: {
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (error) {
      console.error("DEBUG EXCEL ERROR:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

// Helper function untuk parse berbagai format tanggal
function tryParseDate(dateString, format) {
  try {
    const parts = dateString.split(/[/\-\.]/);
    if (parts.length !== 3) return null;

    let day, month, year;

    switch (format) {
      case "DD/MM/YYYY":
      case "DD-MM-YYYY":
        day = parseInt(parts[0]);
        month = parseInt(parts[1]) - 1;
        year = parseInt(parts[2]);
        break;
      case "MM/DD/YYYY":
      case "MM-DD-YYYY":
        month = parseInt(parts[0]) - 1;
        day = parseInt(parts[1]);
        year = parseInt(parts[2]);
        break;
      case "YYYY/MM/DD":
      case "YYYY-MM-DD":
        year = parseInt(parts[0]);
        month = parseInt(parts[1]) - 1;
        day = parseInt(parts[2]);
        break;
      default:
        return null;
    }

    // Validasi tahun
    if (year < 100) {
      year += 2000; // Handle 2-digit year
    }

    const date = new Date(year, month, day);
    if (
      !isNaN(date.getTime()) &&
      date.getDate() === day &&
      date.getMonth() === month &&
      date.getFullYear() === year
    ) {
      return date;
    }
  } catch (error) {
    console.error("Error parsing date:", error);
  }

  return null;
}
// Fungsi improved untuk format tanggal dari Excel
function formatDateFromExcel(dateValue) {
  if (!dateValue) return "";

  console.log("Original date value:", dateValue, "Type:", typeof dateValue);

  try {
    // Jika sudah dalam format string ISO
    if (typeof dateValue === "string") {
      // Coba parse berbagai format
      const dateFormats = [
        "YYYY-MM-DD",
        "DD/MM/YYYY",
        "MM/DD/YYYY",
        "YYYY/MM/DD",
        "DD-MM-YYYY",
        "MM-DD-YYYY",
      ];

      for (const format of dateFormats) {
        const parsed = tryParseDate(dateValue, format);
        if (parsed) {
          return parsed.toISOString().split("T")[0];
        }
      }

      // Jika mengandung timestamp, ambil hanya tanggalnya
      if (dateValue.includes(" ")) {
        const datePart = dateValue.split(" ")[0];
        const parsed = new Date(datePart);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().split("T")[0];
        }
      }
    }

    // Jika dari Excel (number)
    if (typeof dateValue === "number") {
      const excelEpoch = new Date(1899, 11, 30); // Excel epoch
      const date = new Date(
        excelEpoch.getTime() + (dateValue - 1) * 24 * 60 * 60 * 1000
      );
      if (!isNaN(date.getTime())) {
        return date.toISOString().split("T")[0];
      }
    }

    // Jika Date object
    if (dateValue instanceof Date) {
      if (!isNaN(dateValue.getTime())) {
        return dateValue.toISOString().split("T")[0];
      }
    }

    // Coba parse sebagai date langsung
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
  } catch (error) {
    console.error("Error formatting date:", error);
  }

  return ""; // Return empty string jika tidak bisa diparse
}

// Fungsi untuk mapping berbagai format kolom Excel
function mapExcelRowToStudent(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  // Mapping berbagai kemungkinan nama kolom
  const nis =
    normalizedRow["nis"] ||
    normalizedRow["nomor induk siswa"] ||
    normalizedRow["no induk siswa"] ||
    normalizedRow["nomor induk"] ||
    "";

  const nama =
    normalizedRow["nama"] ||
    normalizedRow["name"] ||
    normalizedRow["nama siswa"] ||
    normalizedRow["nama lengkap"] ||
    "";

  const kelasNama =
    normalizedRow["kelas_nama"] ||
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    normalizedRow["nama kelas"] ||
    "";

  // Jika data required tidak ada, skip
  if (!nis || !nama || !kelasNama) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      nis,
      nama,
      kelasNama,
    });
    return null;
  }

  // Mapping jenis kelamin
  let jenisKelamin = "L"; // default
  const genderValue =
    normalizedRow["jenis_kelamin"] ||
    normalizedRow["jenis kelamin"] ||
    normalizedRow["gender"] ||
    normalizedRow["kelamin"] ||
    "";

  if (genderValue) {
    const normalizedGender = genderValue.toString().toLowerCase().trim();
    if (
      normalizedGender.includes("perempuan") ||
      normalizedGender === "p" ||
      normalizedGender === "female"
    ) {
      jenisKelamin = "P";
    } else if (
      normalizedGender.includes("laki") ||
      normalizedGender === "l" ||
      normalizedGender === "male"
    ) {
      jenisKelamin = "L";
    }
  }

  // Format tanggal lahir
  let tanggalLahir = "";
  const dobValue =
    normalizedRow["tanggal_lahir"] ||
    normalizedRow["tanggal lahir"] ||
    normalizedRow["tgl lahir"] ||
    normalizedRow["date of birth"] ||
    normalizedRow["dob"] ||
    "";

  if (dobValue) {
    tanggalLahir = formatDateFromExcel(dobValue);
  }

  // Mapping lainnya
  const alamat =
    normalizedRow["alamat"] ||
    normalizedRow["address"] ||
    normalizedRow["alamat lengkap"] ||
    "";

  const namaWali =
    normalizedRow["nama_wali"] ||
    normalizedRow["nama wali"] ||
    normalizedRow["wali"] ||
    normalizedRow["parent name"] ||
    "";

  const noTelepon =
    normalizedRow["no_telepon"] ||
    normalizedRow["no telepon"] ||
    normalizedRow["telepon"] ||
    normalizedRow["phone"] ||
    normalizedRow["nomor telepon"] ||
    "";

  const emailWali =
    normalizedRow["email_wali"] ||
    normalizedRow["email wali"] ||
    normalizedRow["email"] ||
    normalizedRow["parent email"] ||
    "";

  const student = {
    nis: nis.toString().trim(),
    nama: nama.toString().trim(),
    kelas_nama: kelasNama.toString().trim(),
    alamat: alamat.toString().trim(),
    tanggal_lahir: tanggalLahir,
    jenis_kelamin: jenisKelamin,
    nama_wali: namaWali.toString().trim(),
    no_telepon: noTelepon.toString().trim(),
    email_wali: emailWali.toString().trim(),
    row_number: rowNumber,
  };

  console.log(`Mapped student data for row ${rowNumber}:`, student);
  return student;
}

// (processStudentImport implemented earlier in this file and used above)

// Download template Excel
app.get("/api/siswa/template", authenticateToken, async (req, res) => {
  try {
    const XLSX = require("xlsx");

    // Data contoh untuk template
    const templateData = [
      {
        nis: "2024001",
        nama: "John Doe",
        kelas_nama: "X IPA 1",
        alamat: "Jl. Contoh No. 123",
        tanggal_lahir: "2008-05-15",
        jenis_kelamin: "L",
        nama_wali: "Robert Doe",
        no_telepon: "081234567890",
        email_wali: "robert@example.com",
      },
      {
        nis: "2024002",
        nama: "Jane Smith",
        kelas_nama: "X IPA 2",
        alamat: "Jl. Sample No. 456",
        tanggal_lahir: "2008-08-20",
        jenis_kelamin: "P",
        nama_wali: "Alice Smith",
        no_telepon: "081298765432",
        email_wali: "alice@example.com",
      },
    ];

    // Buat workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(templateData);

    // Tambahkan worksheet ke workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template Siswa");

    // Set header
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="template_import_siswa.xlsx"'
    );

    // Tulis ke response
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.send(buffer);
  } catch (error) {
    console.error("ERROR DOWNLOAD TEMPLATE:", error.message);
    res.status(500).json({ error: "Gagal mendownload template" });
  }
});

// Modifikasi endpoint POST siswa dengan transaction yang benar
app.post("/api/siswa", authenticateTokenAndSchool, async (req, res) => {
  let connection;
  try {
    console.log("Menambah siswa baru:", req.body);
    const {
      nis,
      nama,
      kelas_id,
      alamat,
      tanggal_lahir,
      jenis_kelamin,
      nama_wali,
      no_telepon,
      email_wali,
    } = req.body;

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    const updatedAt = createdAt;

    connection = await getConnection();

    // Cek apakah kelas termasuk dalam sekolah yang sama
    if (kelas_id) {
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelas_id, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(400)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }
    }

    // Mulai transaction
    await connection.beginTransaction();

    try {
      // 1. Insert siswa dengan sekolah_id
      await connection.execute(
        "INSERT INTO siswa (id, nis, nama, kelas_id, alamat, tanggal_lahir, jenis_kelamin, nama_wali, email_wali, no_telepon, sekolah_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          nis,
          nama,
          kelas_id,
          alamat,
          tanggal_lahir,
          jenis_kelamin,
          nama_wali,
          email_wali,
          no_telepon,
          req.sekolah_id, // Tambahkan sekolah_id
          createdAt,
          updatedAt,
        ]
      );

      console.log("Siswa berhasil dimasukkan ke database dengan ID:", id);

      // 2. Buat user wali jika email_wali disediakan
      if (email_wali && nama_wali) {
        console.log("Membuat user wali dengan email:", email_wali);

        // Cek apakah email sudah terdaftar
        const [existingUsers] = await connection.execute(
          "SELECT id FROM users WHERE email = ?",
          [email_wali]
        );

        if (existingUsers.length > 0) {
          await connection.rollback();
          return res.status(400).json({
            error: `Email wali '${email_wali}' sudah terdaftar`,
          });
        }

        const waliId = crypto.randomUUID();
        const password = "password123";
        const hashedPassword = await bcrypt.hash(password, 10);

        await connection.execute(
          'INSERT INTO users (id, nama, email, password, role, siswa_id, sekolah_id) VALUES (?, ?, ?, ?, "wali", ?, ?)',
          [waliId, nama_wali, email_wali, hashedPassword, id, req.sekolah_id] // Tambahkan sekolah_id
        );

        console.log("User wali berhasil dibuat dengan ID:", waliId);
        // 3. Insert user into users_schools so the wali has access to the sekolah
        try {
          // users_schools.id is varchar(36) in this schema — provide UUID
          const userSchoolId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO users_schools (id, user_id, sekolah_id, is_active, created_at) VALUES (?, ?, ?, TRUE, ?)",
            [userSchoolId, waliId, req.sekolah_id, createdAt]
          );

          console.log("users_schools entry created with id:", userSchoolId);

          // 4. Insert default role for the user in users_roles (role = 'wali')
          // users_roles.id is AUTO_INCREMENT int; do NOT provide id, use user_school_id (varchar)
          const [userRoleResult] = await connection.execute(
            "INSERT INTO users_roles (user_school_id, role, is_active, created_at) VALUES (?, ?, TRUE, ?)",
            [userSchoolId, "wali", createdAt]
          );

          console.log(
            "users_roles entry created, insertId:",
            userRoleResult.insertId || null
          );
        } catch (e) {
          console.error(
            "Failed to create users_schools/users_roles for wali:",
            e.message
          );
          // Rollback so that siswa and user are not partially created without proper school/role linkage
          await connection.rollback();
          return res.status(500).json({
            error: "Gagal membuat akses sekolah/role untuk wali: " + e.message,
          });
        }
      }

      // Commit transaction
      await connection.commit();
      console.log("Transaction committed successfully");

      res.json({
        message: "Siswa berhasil ditambahkan",
        id,
        info: email_wali
          ? "User wali berhasil dibuat dengan password: password123"
          : "User wali tidak dibuat (email tidak disediakan)",
      });
    } catch (transactionError) {
      // Rollback jika ada error dalam transaction
      await connection.rollback();
      console.error("Transaction error:", transactionError.message);
      throw transactionError;
    }
  } catch (error) {
    console.error("ERROR POST SISWA:", error.message);
    console.error("SQL Error code:", error.code);
    console.error("Error stack:", error.stack);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "NIS sudah terdaftar" });
    }

    res.status(500).json({
      error: "Gagal menambah siswa: " + error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  } finally {
    // Pastikan koneksi ditutup
    if (connection) {
      await connection.end();
    }
  }
});

// Modifikasi endpoint PUT siswa
app.put("/api/siswa/:id", authenticateTokenAndSchool, async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    console.log("Update siswa:", id, req.body);
    const {
      nis,
      nama,
      kelas_id,
      alamat,
      tanggal_lahir,
      jenis_kelamin,
      nama_wali,
      no_telepon,
      email_wali,
    } = req.body;
    const updatedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

    connection = await getConnection();

    // Cek apakah siswa termasuk dalam sekolah yang sama
    const [existingSiswa] = await connection.execute(
      "SELECT id FROM siswa WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id]
    );

    if (existingSiswa.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Siswa tidak ditemukan atau tidak memiliki akses" });
    }

    // Cek apakah kelas termasuk dalam sekolah yang sama
    if (kelas_id) {
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelas_id, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(400)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }
    }

    // Mulai transaction
    await connection.beginTransaction();

    try {
      // Update siswa (including email_wali)
      await connection.execute(
        "UPDATE siswa SET nis = ?, nama = ?, kelas_id = ?, alamat = ?, tanggal_lahir = ?, jenis_kelamin = ?, nama_wali = ?, email_wali = ?, no_telepon = ?, updated_at = ? WHERE id = ? AND sekolah_id = ?",
        [
          nis,
          nama,
          kelas_id,
          alamat,
          tanggal_lahir,
          jenis_kelamin,
          nama_wali,
          email_wali,
          no_telepon,
          updatedAt,
          id,
          req.sekolah_id, // Tambahkan sekolah_id di WHERE
        ]
      );

      // Cek apakah sudah ada user wali untuk siswa ini
      const [existingWali] = await connection.execute(
        "SELECT id, email FROM users WHERE siswa_id = ? AND role = 'wali'",
        [id]
      );

      if (email_wali && nama_wali) {
        if (existingWali.length > 0) {
          // Update user wali yang sudah ada
          if (existingWali[0].email !== email_wali) {
            // Cek jika email baru sudah digunakan
            const [emailCheck] = await connection.execute(
              "SELECT id FROM users WHERE email = ? AND id != ?",
              [email_wali, existingWali[0].id]
            );

            if (emailCheck.length > 0) {
              await connection.rollback();
              await connection.end();
              return res
                .status(400)
                .json({ error: "Email wali sudah digunakan" });
            }
          }

          await connection.execute(
            "UPDATE users SET nama = ?, email = ? WHERE siswa_id = ? AND role = 'wali'",
            [nama_wali, email_wali, id]
          );
        } else {
          // BUAT USER WALI BARU
          const waliId = crypto.randomUUID();
          const password = "password123";
          const hashedPassword = await bcrypt.hash(password, 10);

          // Cek apakah email sudah terdaftar
          const [emailCheck] = await connection.execute(
            "SELECT id FROM users WHERE email = ?",
            [email_wali]
          );

          if (emailCheck.length > 0) {
            await connection.rollback();
            await connection.end();
            return res.status(400).json({
              error: "Email wali sudah digunakan oleh user lain",
            });
          }

          await connection.execute(
            'INSERT INTO users (id, nama, email, password, role, siswa_id, sekolah_id) VALUES (?, ?, ?, ?, "wali", ?, ?)',
            [waliId, nama_wali, email_wali, hashedPassword, id, req.sekolah_id] // Tambahkan sekolah_id
          );

          console.log("User wali baru berhasil dibuat:", waliId);

          // Create users_schools and users_roles for the new wali (same pattern as creation)
          try {
            const userSchoolId = crypto.randomUUID();
            await connection.execute(
              "INSERT INTO users_schools (id, user_id, sekolah_id, is_active, created_at) VALUES (?, ?, ?, TRUE, ?)",
              [userSchoolId, waliId, req.sekolah_id, updatedAt]
            );

            console.log("users_schools entry created with id:", userSchoolId);

            await connection.execute(
              "INSERT INTO users_roles (user_school_id, role, is_active, created_at) VALUES (?, ?, TRUE, ?)",
              [userSchoolId, "wali", updatedAt]
            );
            console.log(
              "users_roles entry created for user_school_id:",
              userSchoolId
            );
          } catch (e) {
            console.error(
              "Failed to create users_schools/users_roles for new wali:",
              e.message
            );
            await connection.rollback();
            await connection.end();
            return res.status(500).json({
              error:
                "Gagal membuat akses sekolah/role untuk wali: " + e.message,
            });
          }
        }
      } else if (existingWali.length > 0) {
        // Hapus user wali jika email_wali dihapus
        await connection.execute(
          "DELETE FROM users WHERE siswa_id = ? AND role = 'wali'",
          [id]
        );
      }

      // Commit transaction
      await connection.commit();
      await connection.end();

      console.log("Siswa berhasil diupdate:", id);
      res.json({
        message: "Siswa berhasil diupdate",
        info:
          email_wali && nama_wali
            ? "User wali berhasil dibuat/diperbarui dengan password: password123"
            : undefined,
      });
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    }
  } catch (error) {
    console.error("ERROR PUT SISWA:", error.message);
    console.error("SQL Error code:", error.code);

    if (connection) {
      await connection.end();
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "NIS sudah terdaftar" });
    }

    res.status(500).json({ error: "Gagal mengupdate siswa: " + error.message });
  }
});

// Modifikasi endpoint DELETE siswa
app.delete("/api/siswa/:id", authenticateTokenAndSchool, async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    console.log("Delete siswa:", id);

    connection = await getConnection();

    // Cek apakah siswa termasuk dalam sekolah yang sama
    const [existingSiswa] = await connection.execute(
      "SELECT id FROM siswa WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id]
    );

    if (existingSiswa.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Siswa tidak ditemukan atau tidak memiliki akses" });
    }

    // Mulai transaction
    await connection.beginTransaction();

    try {
      // Hapus user wali beserta users_roles dan users_schools terkait, lalu hapus siswa
      try {
        // Ambil semua user wali terkait siswa
        const [waliUsers] = await connection.execute(
          "SELECT id FROM users WHERE siswa_id = ? AND role = 'wali'",
          [id]
        );

        for (const w of waliUsers) {
          const waliUserId = w.id;

          // Hapus users_roles yang terkait via users_schools
          await connection.execute(
            "DELETE ur FROM users_roles ur JOIN users_schools us ON ur.user_school_id = us.id WHERE us.user_id = ?",
            [waliUserId]
          );

          // Hapus users_schools
          await connection.execute(
            "DELETE FROM users_schools WHERE user_id = ?",
            [waliUserId]
          );

          // Hapus user
          await connection.execute("DELETE FROM users WHERE id = ?", [
            waliUserId,
          ]);
        }

        // Hapus siswa
        await connection.execute(
          "DELETE FROM siswa WHERE id = ? AND sekolah_id = ?",
          [id, req.sekolah_id] // Tambahkan sekolah_id di WHERE
        );
      } catch (e) {
        console.error(
          "Failed to remove wali related entries on delete siswa:",
          e.message
        );
        await connection.rollback();
        await connection.end();
        return res.status(500).json({
          error: "Gagal menghapus siswa dan user wali terkait: " + e.message,
        });
      }

      // Commit transaction
      await connection.commit();
      await connection.end();

      console.log("Siswa berhasil dihapus:", id);
      res.json({ message: "Siswa berhasil dihapus" });
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    }
  } catch (error) {
    console.error("ERROR DELETE SISWA:", error.message);
    console.error("SQL Error code:", error.code);

    if (connection) {
      await connection.end();
    }

    res.status(500).json({ error: "Gagal menghapus siswa" });
  }
});
// Kelola Siswa - Get Siswa by ID
app.get("/api/siswa/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data siswa by ID:", id);

    const connection = await getConnection();
    const [siswa] = await connection.execute(
      `SELECT s.*, k.nama as kelas_nama 
       FROM siswa s 
       LEFT JOIN kelas k ON s.kelas_id = k.id 
       WHERE s.id = ? AND s.sekolah_id = ?`, // Tambahkan sekolah_id
      [id, req.sekolah_id]
    );
    await connection.end();

    if (siswa.length === 0) {
      return res.status(404).json({ error: "Siswa tidak ditemukan" });
    }

    console.log("Berhasil mengambil data siswa:", id);
    res.json(siswa[0]);
  } catch (error) {
    console.error("ERROR GET SISWA BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data siswa" });
  }
});

// Get Mata Pelajaran (WITH PAGINATION & FILTER)
app.get("/api/mata-pelajaran", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { page, limit, search, status } = req.query;

    console.log("Mengambil data mata pelajaran dengan filter:", {
      search,
      status,
    });
    console.log("Pagination:", { page, limit });

    const connection = await getConnection();

    // Build filter conditions
    const conditions = ["mp.sekolah_id = ?"];
    const params = [req.sekolah_id];

    if (search) {
      conditions.push(
        "(mp.nama LIKE ? OR mp.kode LIKE ? OR mp.deskripsi LIKE ?)"
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      conditions.push("mp.status = ?");
      params.push(status);
    }

    const { subject_ids } = req.query;
    if (subject_ids) {
      const ids = subject_ids.split(",").map((id) => id.trim());
      if (ids.length > 0) {
        conditions.push(`mp.id IN (${ids.map(() => "?").join(",")})`);
        params.push(...ids);
      }
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Build pagination
    const { limitClause, currentPage, perPage } = buildPaginationQuery(
      page,
      limit
    );

    // Count total items
    const countQuery = `
      SELECT COUNT(*) as total
      FROM mata_pelajaran mp
      ${whereClause}
    `;
    const [countResult] = await connection.execute(countQuery, params);
    const totalItems = countResult[0].total;

    // Get paginated data
    const dataQuery = `
      SELECT mp.*,
        (SELECT COUNT(*) FROM guru_mata_pelajaran WHERE mata_pelajaran_id = mp.id) as jumlah_guru
      FROM mata_pelajaran mp
      ${whereClause}
      ORDER BY mp.nama ASC
      ${limitClause}
    `;
    const [mataPelajaran] = await connection.execute(dataQuery, params);

    await connection.end();

    // Calculate pagination metadata
    const pagination = calculatePaginationMeta(
      totalItems,
      currentPage,
      perPage
    );

    console.log(
      `✅ Data mata pelajaran: ${mataPelajaran.length} items (Total: ${totalItems})`
    );

    res.json({
      success: true,
      data: mataPelajaran,
      pagination,
    });
  } catch (error) {
    console.error("ERROR GET MATA PELAJARAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data mata pelajaran" });
  }
});

// Get Filter Options for Mata Pelajaran
app.get(
  "/api/mata-pelajaran/filter-options",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Mengambil filter options untuk mata pelajaran");
      const connection = await getConnection();

      // Status options (static)
      const statusOptions = [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ];

      await connection.end();

      res.json({
        success: true,
        data: {
          status_options: statusOptions,
        },
      });

      console.log("✅ Filter options berhasil diambil");
    } catch (error) {
      console.error("ERROR GET FILTER OPTIONS:", error.message);
      res.status(500).json({ error: "Gagal mengambil filter options" });
    }
  }
);

app.post("/api/export-subjects", async (req, res) => {
  try {
    const { subjects } = req.body;

    if (!subjects || !Array.isArray(subjects)) {
      return res.status(400).json({
        success: false,
        message: "Data mata pelajaran tidak valid",
      });
    }

    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Fetch kelas_names for subjects that don't have it
    const connection = await getConnection();
    
    console.log(`Processing ${subjects.length} subjects for export...`);
    
    const enrichedSubjects = await Promise.all(
      subjects.map(async (subject, index) => {
        let kelasNames = getClassNames(subject);
        
        console.log(`Subject ${index + 1}: ID=${subject.id}, Kode=${subject.kode}, Initial kelas_names="${kelasNames}"`);
        
        // If kelas_names is empty, fetch from mata_pelajaran_kelas table
        if (!kelasNames && subject.id) {
          try {
            console.log(`  Fetching kelas from database for subject ID: ${subject.id}`);
            const [kelasData] = await connection.execute(
              `SELECT GROUP_CONCAT(k.nama ORDER BY k.nama) as kelas_names
               FROM mata_pelajaran_kelas mpk
               JOIN kelas k ON mpk.kelas_id = k.id
               WHERE mpk.mata_pelajaran_id = ?`,
              [subject.id]
            );
            
            if (kelasData && kelasData.length > 0 && kelasData[0].kelas_names) {
              kelasNames = kelasData[0].kelas_names;
              console.log(`  ✅ Found kelas from database: "${kelasNames}"`);
            } else {
              console.log(`  ⚠️ No kelas found in database for subject ID: ${subject.id}`);
            }
          } catch (err) {
            console.error(`  ❌ Error fetching kelas for subject ${subject.id}:`, err.message);
          }
        } else if (kelasNames) {
          console.log(`  ℹ️ Using existing kelas_names: "${kelasNames}"`);
        } else {
          console.log(`  ⚠️ No subject ID provided, cannot fetch kelas from database`);
        }
        
        return {
          ...subject,
          kelas_names: kelasNames
        };
      })
    );
    
    await connection.end();

    // Prepare data for Excel
    const excelData = [
      // Header row
      ["Kode*", "Nama*", "Deskripsi", "Kelas", "Status"],
      // Data rows
      ...enrichedSubjects.map((subject) => [
        subject.kode || "",
        subject.nama || "",
        subject.deskripsi || "",
        subject.kelas_names || "",
        "Active",
      ]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Add style to header row (basic styling)
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    for (let i = 0; i < 5; i++) {
      worksheet["!cols"][i] = { width: 15 };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data Mata Pelajaran");

    // Generate filename
    const filename = `Data_Mata_Pelajaran_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading file:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh file",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Export subjects error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengexport data: ${error.message}`,
    });
  }
});

// Download template Excel untuk mata pelajaran
app.get("/api/download-subject-template", async (req, res) => {
  try {
    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare template data
    const templateData = [
      // Header row
      ["Kode", "Nama", "Deskripsi", "Kelas"],
      // Example data
      ["BI-7", "Bahasa Indonesia", "Bahasa Indonesia untuk kelas 7", "7A"],
      ["BIN-7", "Bahasa Inggris", "Bahasa Inggris untuk kelas 7", "7A"],
      ["MTK-7", "Matematika", "Matematika untuk kelas 7", "7A,7B"],
      ["IPA-7", "Ilmu Pengetahuan Alam", "IPA untuk kelas 7", "7A,7B,7C"],
      // Empty row
      [],
      // Notes
      ["* Wajib diisi"],
      ["Kelas: Pisahkan dengan koma jika multiple"],
      ["Contoh: 7A,7B,8A"],
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);

    // Set column widths
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    for (let i = 0; i < 4; i++) {
      worksheet["!cols"][i] = { width: 20 };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Template Mata Pelajaran"
    );

    // Generate filename
    const filename = "Template_Import_Mata_Pelajaran.xlsx";
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading template:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh template",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Subject template download error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengunduh template: ${error.message}`,
    });
  }
});

app.post("/api/validate-subjects", async (req, res) => {
  try {
    const { subjects } = req.body;

    if (!subjects || !Array.isArray(subjects)) {
      return res.status(400).json({
        success: false,
        message: "Data mata pelajaran tidak valid",
      });
    }

    const validatedData = [];
    const errors = [];

    for (let i = 0; i < subjects.length; i++) {
      const subject = subjects[i];
      const validatedSubject = {};
      let hasError = false;

      // Validasi field required
      if (!subject.kode || subject.kode.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: Kode mata pelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSubject.kode = subject.kode.toString().trim();
      }

      if (!subject.nama || subject.nama.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: Nama mata pelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSubject.nama = subject.nama.toString().trim();
      }

      // Field optional
      validatedSubject.deskripsi = subject.deskripsi || "";
      validatedSubject.kelas = subject.kelas || "";

      if (!hasError) {
        validatedData.push(validatedSubject);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validasi data gagal",
        errors: errors,
        validatedData: validatedData,
      });
    }

    res.json({
      success: true,
      message: "Validasi data berhasil",
      validatedData: validatedData,
    });
  } catch (error) {
    console.error("Subject validation error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal validasi data: ${error.message}`,
    });
  }
});

function getClassNames(subject) {
  if (subject.kelas_names) {
    return subject.kelas_names;
  }

  if (subject.kelas_list && Array.isArray(subject.kelas_list)) {
    return subject.kelas_list.map((kelas) => kelas.nama || "").join(", ");
  }

  return "";
}

// Import mata pelajaran dari Excel
app.post(
  "/api/mata-pelajaran/import",
  authenticateTokenAndSchool,
  excelUploadMiddleware,
  async (req, res) => {
    let connection;
    try {
      console.log("Import mata pelajaran dari Excel (memory storage)");
      console.log("User's sekolah_id:", req.sekolah_id);

      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received in memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer.length,
      });

      // Baca file Excel langsung dari buffer
      const importedSubjects = await readExcelSubjectsFromBuffer(
        req.file.buffer
      );

      if (importedSubjects.length === 0) {
        return res.status(400).json({
          error:
            "Tidak ada data mata pelajaran yang valid ditemukan dalam file",
        });
      }

      console.log(`Found ${importedSubjects.length} subjects to import`);

      // Ambil data kelas untuk mapping (hanya kelas dari sekolah yang sama)
      connection = await getConnection();
      const [classList] = await connection.execute(
        "SELECT id, nama FROM kelas WHERE sekolah_id = ?",
        [req.sekolah_id]
      );
      await connection.end();

      // Proses import dengan sekolah_id dari user yang login
      const result = await processSubjectImport(
        importedSubjects,
        classList,
        req.sekolah_id
      );

      console.log("Import completed:", result);
      res.json({
        message: "Import selesai",
        ...result,
      });
    } catch (error) {
      if (connection) {
        await connection.end();
      }

      console.error("ERROR IMPORT MATA PELAJARAN:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengimport mata pelajaran: " + error.message,
      });
    }
  }
);

// Fungsi untuk membaca Excel mata pelajaran dari buffer
async function readExcelSubjectsFromBuffer(buffer) {
  const XLSX = require("xlsx");

  // Baca workbook langsung dari buffer
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Konversi ke JSON
  const data = XLSX.utils.sheet_to_json(worksheet);

  console.log("Raw Excel data from buffer:", data);

  const subjects = [];

  data.forEach((row, index) => {
    try {
      // Mapping kolom dengan berbagai kemungkinan nama
      const subjectData = mapExcelRowToSubject(row, index + 2);
      if (subjectData) {
        subjects.push(subjectData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${subjects.length} subjects from Excel buffer`);
  return subjects;
}

// Fungsi mapping row untuk mata pelajaran
function mapExcelRowToSubject(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  // Mapping berbagai kemungkinan nama kolom
  const kode =
    normalizedRow["kode"] ||
    normalizedRow["code"] ||
    normalizedRow["kode mata pelajaran"] ||
    normalizedRow["subject code"] ||
    "";

  const nama =
    normalizedRow["nama"] ||
    normalizedRow["name"] ||
    normalizedRow["nama mata pelajaran"] ||
    normalizedRow["subject name"] ||
    normalizedRow["mata pelajaran"] ||
    "";

  // Jika data required tidak ada, skip
  if (!kode || !nama) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      kode,
      nama,
    });
    return null;
  }

  // Mapping lainnya
  const deskripsi =
    normalizedRow["deskripsi"] ||
    normalizedRow["description"] ||
    normalizedRow["deskripsi mata pelajaran"] ||
    normalizedRow["subject description"] ||
    "";

  const kelasNames =
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    normalizedRow["kelas names"] ||
    normalizedRow["classes"] ||
    normalizedRow["nama kelas"] ||
    "";

  const subject = {
    kode: kode.toString().trim(),
    nama: nama.toString().trim(),
    deskripsi: deskripsi.toString().trim(),
    kelas_names: kelasNames.toString().trim(),
    row_number: rowNumber,
  };

  console.log(`Mapped subject data for row ${rowNumber}:`, subject);
  return subject;
}

// Fungsi processSubjectImport
async function processSubjectImport(importedSubjects, classList, sekolahId) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const subjectData of importedSubjects) {
      try {
        // Validasi data required
        if (!subjectData.kode || !subjectData.nama) {
          results.failed++;
          results.errors.push(
            `Baris ${subjectData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        // Cek kode duplikat (hanya dalam sekolah yang sama)
        const [existingKode] = await connection.execute(
          "SELECT id FROM mata_pelajaran WHERE kode = ? AND sekolah_id = ?",
          [subjectData.kode, sekolahId]
        );

        if (existingKode.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${subjectData.row_number}: Kode '${subjectData.kode}' sudah terdaftar di sekolah ini`
          );
          continue;
        }

        // Mulai transaction untuk mata pelajaran ini
        await connection.beginTransaction();

        try {
          const subjectId = crypto.randomUUID();
          const createdAt = new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " ");
          const updatedAt = createdAt;

          // Insert mata pelajaran dengan sekolah_id
          await connection.execute(
            "INSERT INTO mata_pelajaran (id, kode, nama, deskripsi, sekolah_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              subjectId,
              subjectData.kode,
              subjectData.nama,
              subjectData.deskripsi,
              sekolahId,
              createdAt,
              updatedAt,
            ]
          );

          // Tambahkan relasi kelas jika disediakan
          if (subjectData.kelas_names) {
            const kelasItems = subjectData.kelas_names
              .split(",")
              .map((item) => item.trim())
              .filter((item) => item !== "");

            for (const kelasNama of kelasItems) {
              const classItem = classList.find(
                (cls) => cls.nama.toLowerCase() === kelasNama.toLowerCase()
              );

              if (classItem) {
                const relationId = crypto.randomUUID();
                await connection.execute(
                  "INSERT INTO mata_pelajaran_kelas (id, mata_pelajaran_id, kelas_id) VALUES (?, ?, ?)",
                  [relationId, subjectId, classItem.id]
                );
              }
            }
          }

          // Commit transaction
          await connection.commit();
          results.success++;
        } catch (transactionError) {
          // Rollback jika ada error
          await connection.rollback();
          throw transactionError;
        }
      } catch (subjectError) {
        results.failed++;
        results.errors.push(
          `Baris ${subjectData.row_number}: ${subjectError.message}`
        );
        console.error(
          `Error importing subject ${subjectData.kode}:`,
          subjectError.message
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Debug endpoint untuk melihat data Excel mata pelajaran
app.post(
  "/api/debug/excel-mata-pelajaran",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("Debug Excel file from memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });

      // Baca file Excel langsung dari buffer
      const XLSX = require("xlsx");
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Dapatkan semua data
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      res.json({
        sheet_name: sheetName,
        headers: rawData[0] || [],
        raw_data: rawData,
        json_data: jsonData,
        total_rows: rawData.length,
        file_info: {
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (error) {
      console.error("DEBUG EXCEL MATA PELAJARAN ERROR:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get Mata Pelajaran by ID
app.get(
  "/api/mata-pelajaran/:id",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log("Mengambil data mata pelajaran by ID:", id);

      const connection = await getConnection();
      const [mataPelajaran] = await connection.execute(
        "SELECT * FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?", // Tambahkan sekolah_id
        [id, req.sekolah_id]
      );
      await connection.end();

      if (mataPelajaran.length === 0) {
        return res
          .status(404)
          .json({ error: "Mata pelajaran tidak ditemukan" });
      }

      console.log("Berhasil mengambil data mata pelajaran:", id);
      res.json(mataPelajaran[0]);
    } catch (error) {
      console.error("ERROR GET MATA PELAJARAN BY ID:", error.message);
      res.status(500).json({ error: "Gagal mengambil data mata pelajaran" });
    }
  }
);

// Create Mata Pelajaran
app.post(
  "/api/mata-pelajaran",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Menambah mata pelajaran baru:", req.body);
      const { kode, nama, deskripsi } = req.body;
      const id = crypto.randomUUID();

      const connection = await getConnection();
      await connection.execute(
        "INSERT INTO mata_pelajaran (id, kode, nama, deskripsi, sekolah_id) VALUES (?, ?, ?, ?, ?)", // Tambahkan sekolah_id
        [id, kode, nama, deskripsi, req.sekolah_id]
      );
      await connection.end();

      console.log("Mata pelajaran berhasil ditambahkan:", id);
      res.json({ message: "Mata pelajaran berhasil ditambahkan", id });
    } catch (error) {
      console.error("ERROR POST MATA PELAJARAN:", error.message);
      console.error("SQL Error code:", error.code);

      if (error.code === "ER_DUP_ENTRY") {
        return res
          .status(400)
          .json({ error: "Kode mata pelajaran sudah terdaftar" });
      }

      res.status(500).json({ error: "Gagal menambah mata pelajaran" });
    }
  }
);

// Update Mata Pelajaran
app.put(
  "/api/mata-pelajaran/:id",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log("Update mata pelajaran:", id, req.body);
      const { kode, nama, deskripsi } = req.body;

      const connection = await getConnection();

      // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
      const [existingMapel] = await connection.execute(
        "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
        [id, req.sekolah_id]
      );

      if (existingMapel.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
        });
      }

      await connection.execute(
        "UPDATE mata_pelajaran SET kode = ?, nama = ?, deskripsi = ? WHERE id = ? AND sekolah_id = ?", // Tambahkan sekolah_id di WHERE
        [kode, nama, deskripsi, id, req.sekolah_id]
      );
      await connection.end();

      console.log("Mata pelajaran berhasil diupdate:", id);
      res.json({ message: "Mata pelajaran berhasil diupdate" });
    } catch (error) {
      console.error("ERROR PUT MATA PELAJARAN:", error.message);
      console.error("SQL Error code:", error.code);

      if (error.code === "ER_DUP_ENTRY") {
        return res
          .status(400)
          .json({ error: "Kode mata pelajaran sudah terdaftar" });
      }

      res.status(500).json({ error: "Gagal mengupdate mata pelajaran" });
    }
  }
);

// Delete Mata Pelajaran
app.delete(
  "/api/mata-pelajaran/:id",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log("Delete mata pelajaran:", id);

      const connection = await getConnection();

      // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
      const [existingMapel] = await connection.execute(
        "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
        [id, req.sekolah_id]
      );

      if (existingMapel.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
        });
      }

      // Cek apakah mata pelajaran masih digunakan di guru_mata_pelajaran
      const [guruMapel] = await connection.execute(
        "SELECT id FROM guru_mata_pelajaran WHERE mata_pelajaran_id = ?",
        [id]
      );

      if (guruMapel.length > 0) {
        await connection.end();
        return res.status(400).json({
          error:
            "Mata pelajaran tidak dapat dihapus karena masih digunakan oleh guru",
        });
      }

      // Cek apakah mata pelajaran masih digunakan di jadwal_pelajaran
      const [jadwal] = await connection.execute(
        "SELECT id FROM jadwal_mengajar WHERE mata_pelajaran_id = ?",
        [id]
      );

      if (jadwal.length > 0) {
        await connection.end();
        return res.status(400).json({
          error:
            "Mata pelajaran tidak dapat dihapus karena masih digunakan dalam jadwal pelajaran",
        });
      }

      await connection.execute(
        "DELETE FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?", // Tambahkan sekolah_id di WHERE
        [id, req.sekolah_id]
      );
      await connection.end();

      console.log("Mata pelajaran berhasil dihapus:", id);
      res.json({ message: "Mata pelajaran berhasil dihapus" });
    } catch (error) {
      console.error("ERROR DELETE MATA PELAJARAN:", error.message);
      console.error("SQL Error code:", error.code);

      if (error.code === "ER_ROW_IS_REFERENCED_2") {
        return res.status(400).json({
          error: "Mata pelajaran tidak dapat dihapus karena masih digunakan",
        });
      }

      res.status(500).json({ error: "Gagal menghapus mata pelajaran" });
    }
  }
);

// Ganti query di endpoint /api/guru/:id
app.get("/api/guru/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data guru by ID:", id);

    const connection = await getConnection();

    // Query from guru table with proper joins
    const [guru] = await connection.execute(
      `
      SELECT 
        g.id,
        g.user_id,
        g.nama,
        g.nip,
        g.jenis_kelamin,
        g.wali_kelas_id,
        g.status_kepegawaian,
        g.sekolah_id,
        g.created_at,
        g.updated_at,
        u.email,
        wk.nama as wali_kelas_nama,
        GROUP_CONCAT(DISTINCT mp.id) as mata_pelajaran_ids,
        GROUP_CONCAT(DISTINCT mp.nama) as mata_pelajaran_names,
        GROUP_CONCAT(DISTINCT k.id) as kelas_ids,
        GROUP_CONCAT(DISTINCT k.nama) as kelas_names,
        CASE WHEN g.wali_kelas_id IS NOT NULL THEN 1 ELSE 0 END as is_wali_kelas
      FROM guru g
      INNER JOIN users u ON g.user_id = u.id
      LEFT JOIN kelas wk ON g.wali_kelas_id = wk.id
      LEFT JOIN guru_mata_pelajaran gmp ON g.id = gmp.guru_id
      LEFT JOIN mata_pelajaran mp ON gmp.mata_pelajaran_id = mp.id
      LEFT JOIN guru_kelas gk ON g.id = gk.guru_id
      LEFT JOIN kelas k ON gk.kelas_id = k.id
      WHERE g.id = ? AND g.sekolah_id = ?
      GROUP BY g.id, u.email, wk.nama
    `,
      [id, req.sekolah_id]
    );

    await connection.end();

    if (guru.length === 0) {
      return res.status(404).json({ error: "Guru tidak ditemukan" });
    }

    console.log("Berhasil mengambil data guru:", id);
    res.json(guru[0]);
  } catch (error) {
    console.error("ERROR GET GURU BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data guru" });
  }
});

// Endpoint untuk download template guru
app.get("/api/guru/template", authenticateToken, async (req, res) => {
  try {
    const XLSX = require("xlsx");

    // Data contoh untuk template guru
    const templateData = [
      {
        nip: "198001012000121001",
        nama: "Budi Santoso",
        email: "budi.santoso@sekolah.sch.id",
        mata_pelajaran_nama: "Matematika",
        kelas_nama: "X IPA 1",
        no_telepon: "081234567890",
        is_wali_kelas: "Ya",
      },
      {
        nip: "198002022000122002",
        nama: "Siti Rahayu",
        email: "siti.rahayu@sekolah.sch.id",
        mata_pelajaran_nama: "Bahasa Indonesia",
        kelas_nama: "X IPA 2",
        no_telepon: "081298765432",
        is_wali_kelas: "Tidak",
      },
    ];

    // Buat workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(templateData);

    // Tambahkan worksheet ke workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template Guru");

    // Set header
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="template_import_guru.xlsx"'
    );

    // Tulis ke response
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.send(buffer);
  } catch (error) {
    console.error("ERROR DOWNLOAD TEMPLATE GURU:", error.message);
    res.status(500).json({ error: "Gagal mendownload template guru" });
  }
});

// Import guru dari Excel
app.post(
  "/api/guru/import",
  authenticateTokenAndSchool,
  excelUploadMiddleware,
  async (req, res) => {
    let connection;
    try {
      console.log("Import guru dari Excel (memory storage)");

      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received in memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer.length,
      });

      // Baca file Excel langsung dari buffer
      const importedTeachers = await readExcelTeachersFromBuffer(
        req.file.buffer
      );

      if (importedTeachers.length === 0) {
        return res.status(400).json({
          error: "Tidak ada data guru yang valid ditemukan dalam file",
        });
      }

      console.log(`Found ${importedTeachers.length} teachers to import`);
      console.log("Import request sekolah_id:", req.sekolah_id);

      // Ambil data kelas dan mata pelajaran untuk mapping
      connection = await getConnection();
      const [classList] = await connection.execute(
        "SELECT id, nama FROM kelas"
      );
      const [subjectList] = await connection.execute(
        "SELECT id, nama FROM mata_pelajaran"
      );
      await connection.end();

      // Proses import (pass sekolah_id from token)
      const result = await processTeacherImport(
        importedTeachers,
        classList,
        subjectList,
        req.sekolah_id
      );

      console.log("Import completed:", result);
      res.json({
        message: "Import selesai",
        ...result,
      });
    } catch (error) {
      if (connection) {
        await connection.end();
      }

      console.error("ERROR IMPORT GURU:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengimport guru: " + error.message,
      });
    }
  }
);

// Fungsi untuk membaca Excel guru dari buffer
async function readExcelTeachersFromBuffer(buffer) {
  const XLSX = require("xlsx");

  // Baca workbook langsung dari buffer
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Konversi ke JSON
  const data = XLSX.utils.sheet_to_json(worksheet);

  console.log("Raw Excel data from buffer:", data);

  const teachers = [];

  data.forEach((row, index) => {
    try {
      // Mapping kolom dengan berbagai kemungkinan nama
      const teacherData = mapExcelRowToTeacher(row, index + 2);
      if (teacherData) {
        teachers.push(teacherData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${teachers.length} teachers from Excel buffer`);
  return teachers;
}

// Fungsi mapping row untuk guru
function mapExcelRowToTeacher(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  // helper: for more tolerant matching, find a value for a key substring
  function findValueByKeyContains(obj, substr) {
    const lowerSub = substr.toLowerCase();
    for (const k of Object.keys(obj)) {
      if (
        k.includes(lowerSub) &&
        obj[k] !== undefined &&
        obj[k] !== null &&
        obj[k] !== ""
      ) {
        console.log(
          `- Matched column '${k}' for '${substr}' with value:`,
          obj[k]
        );
        return obj[k];
      }
    }
    return undefined;
  }

  // Mapping berbagai kemungkinan nama kolom
  const nip =
    normalizedRow["nip"] ||
    normalizedRow["nomor induk pegawai"] ||
    normalizedRow["no induk pegawai"] ||
    normalizedRow["nomor induk"] ||
    "";

  const nama =
    normalizedRow["nama"] ||
    normalizedRow["name"] ||
    normalizedRow["nama guru"] ||
    normalizedRow["nama lengkap"] ||
    "";

  const email =
    normalizedRow["email"] ||
    normalizedRow["email guru"] ||
    normalizedRow["alamat email"] ||
    "";

  const mataPelajaranNama =
    normalizedRow["mata_pelajaran_nama"] ||
    normalizedRow["mata pelajaran"] ||
    normalizedRow["pelajaran"] ||
    normalizedRow["subject"] ||
    "";

  const kelasNama =
    normalizedRow["kelas_nama"] ||
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    normalizedRow["nama kelas"] ||
    "";

  // Jika data required tidak ada, coba cari kolom alternatif kemudian skip jika tetap tidak ada
  if (!nip) nip = findValueByKeyContains(normalizedRow, "nip") || "";
  if (!nama) nama = findValueByKeyContains(normalizedRow, "nama") || "";
  if (!email) email = findValueByKeyContains(normalizedRow, "email") || "";

  if (!nip || !nama || !email) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      nip,
      nama,
      email,
      normalizedRowSample: Object.keys(normalizedRow).slice(0, 10),
    });
    return null;
  }

  // Mapping is_wali_kelas
  let isWaliKelas = false;
  const waliKelasValue =
    normalizedRow["is_wali_kelas"] ||
    normalizedRow["wali kelas"] ||
    normalizedRow["is_wali"] ||
    normalizedRow["homeroom teacher"] ||
    "";

  if (waliKelasValue) {
    const normalizedWali = waliKelasValue.toString().toLowerCase().trim();
    if (
      normalizedWali.includes("ya") ||
      normalizedWali === "y" ||
      normalizedWali === "yes" ||
      normalizedWali === "true" ||
      normalizedWali === "1"
    ) {
      isWaliKelas = true;
    }
  }

  // Mapping lainnya
  // const noTelepon =
  //   normalizedRow["no_telepon"] ||
  //   normalizedRow["no telepon"] ||
  //   normalizedRow["telepon"] ||
  //   normalizedRow["phone"] ||
  //   normalizedRow["nomor telepon"] ||
  //   normalizedRow["No. Telepon"] ||
  //   "";

  const teacher = {
    nip: nip.toString().trim(),
    nama: nama.toString().trim(),
    email: email.toString().trim(),
    mata_pelajaran_nama: mataPelajaranNama.toString().trim(),
    kelas_nama: kelasNama.toString().trim(),
    // no_telepon: noTelepon.toString().trim(),
    is_wali_kelas: isWaliKelas,
    row_number: rowNumber,
  };

  console.log(`Mapped teacher data for row ${rowNumber}:`, teacher);
  return teacher;
}

// Fungsi processTeacherImport
async function processTeacherImport(
  importedTeachers,
  classList,
  subjectList,
  schoolId
) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    console.log(
      `Starting processTeacherImport for sekolah_id=${schoolId}, totalRows=${importedTeachers.length}`
    );

    for (const teacherData of importedTeachers) {
      try {
        // Validasi data required
        if (!teacherData.nip || !teacherData.nama || !teacherData.email) {
          results.failed++;
          const msg = `Baris ${teacherData.row_number}: Data required tidak lengkap`;
          results.errors.push(msg);
          console.warn("Skipping import - missing required fields:", {
            row: teacherData.row_number,
            nip: teacherData.nip,
            nama: teacherData.nama,
            email: teacherData.email,
            teacherData,
          });
          continue;
        }

        // Cek NIP duplikat
        const [existingNIP] = await connection.execute(
          "SELECT id FROM users WHERE nip = ? AND role = 'guru'",
          [teacherData.nip]
        );

        if (existingNIP.length > 0) {
          results.failed++;
          const msg = `Baris ${teacherData.row_number}: NIP '${teacherData.nip}' sudah terdaftar`;
          results.errors.push(msg);
          console.warn("Duplicate NIP detected, skipping row", {
            row: teacherData.row_number,
            nip: teacherData.nip,
            existing: existingNIP,
            teacherData,
          });
          continue;
        }

        // Cek email duplikat
        const [existingEmail] = await connection.execute(
          "SELECT id FROM users WHERE email = ?",
          [teacherData.email]
        );

        if (existingEmail.length > 0) {
          results.failed++;
          const msg = `Baris ${teacherData.row_number}: Email '${teacherData.email}' sudah terdaftar`;
          results.errors.push(msg);
          console.warn("Duplicate email detected, skipping row", {
            row: teacherData.row_number,
            email: teacherData.email,
            existing: existingEmail,
            teacherData,
          });
          continue;
        }

        // Cari kelas_id berdasarkan nama kelas (jika ada)
        let kelasId = null;
        if (teacherData.kelas_nama) {
          const classItem = classList.find(
            (cls) =>
              cls.nama.toLowerCase() === teacherData.kelas_nama.toLowerCase()
          );

          if (!classItem) {
            results.failed++;
            const msg = `Baris ${teacherData.row_number}: Kelas '${teacherData.kelas_nama}' tidak ditemukan`;
            results.errors.push(msg);
            console.warn("Class not found for teacher, skipping row", {
              row: teacherData.row_number,
              kelas_nama: teacherData.kelas_nama,
              teacherData,
            });
            continue;
          }
          kelasId = classItem.id;
        }

        // Mulai transaction untuk guru ini
        await connection.beginTransaction();

        try {
          const teacherId = crypto.randomUUID();
          const password = "password123";
          const hashedPassword = await bcrypt.hash(password, 10);

          // Insert guru with sekolah context and create access rows
          // Detect if users table has 'no_telepon' column to avoid SQL errors on different schemas
          try {
            const [colCheck] = await connection.execute(
              "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'no_telepon'",
              [dbConfig.database]
            );

            const hasNoTelepon = Array.isArray(colCheck) && colCheck.length > 0;

            const userColumns = [
              "id",
              "nama",
              "email",
              "password",
              "role",
              "nip",
              "kelas_id",
              "is_wali_kelas",
            ];

            const userValues = [
              teacherId,
              teacherData.nama,
              teacherData.email,
              hashedPassword,
              "guru",
              teacherData.nip,
              kelasId,
              teacherData.is_wali_kelas,
            ];

            // if (hasNoTelepon) {
            //   userColumns.push("no_telepon");
            //   userValues.push(teacherData.no_telepon || "");
            // }

            userColumns.push("sekolah_id");
            userValues.push(schoolId);

            const placeholders = userColumns.map(() => "?").join(", ");
            const insertSql = `INSERT INTO users (${userColumns.join(
              ", "
            )}) VALUES (${placeholders})`;

            if (process.env.NODE_ENV !== 'production')
              console.log("User insert SQL:", insertSql, "values:", userValues);

            await connection.execute(insertSql, userValues);
          } catch (insertDetectError) {
            console.error(
              "Error detecting users schema or inserting user:",
              insertDetectError
            );
            throw insertDetectError;
          }

          // create users_schools and users_roles for imported guru
          try {
            const createdAt = new Date()
              .toISOString()
              .slice(0, 19)
              .replace("T", " ");
            const userSchoolId = crypto.randomUUID();
            await connection.execute(
              "INSERT INTO users_schools (id, user_id, sekolah_id, is_active, created_at) VALUES (?, ?, ?, TRUE, ?)",
              [userSchoolId, teacherId, schoolId, createdAt]
            );

            await connection.execute(
              "INSERT INTO users_roles (user_school_id, role, is_active, created_at) VALUES (?, ?, TRUE, ?)",
              [userSchoolId, "guru", createdAt]
            );
            console.log(
              `Inserted users_schools (${userSchoolId}) and users_roles for teacher ${teacherData.email}`
            );
          } catch (e) {
            console.error(
              "Failed to create users_schools/users_roles for imported guru:",
              e && e.message ? e.message : e
            );
            console.error("users_schools/users_roles payload:", {
              teacherEmail: teacherData.email,
              teacherNip: teacherData.nip,
              schoolId: schoolId,
            });
            throw e;
          }

          // Tambahkan mata pelajaran jika disediakan (simpan sekolah_id pada mapping)
          if (teacherData.mata_pelajaran_nama) {
            const mataPelajaranItems = teacherData.mata_pelajaran_nama
              .split(",")
              .map((item) => item.trim());

            for (const mpNama of mataPelajaranItems) {
              const subjectItem = subjectList.find(
                (subj) => subj.nama.toLowerCase() === mpNama.toLowerCase()
              );

              if (subjectItem) {
                const relationId = crypto.randomUUID();
                await connection.execute(
                  "INSERT INTO guru_mata_pelajaran (id, guru_id, mata_pelajaran_id, sekolah_id) VALUES (?, ?, ?, ?)",
                  [relationId, teacherId, subjectItem.id, schoolId]
                );
                try {
                  // safe debug log for Node runtime
                  console.log(
                    `Added subject mapping for teacher ${teacherData.email}: ${subjectItem.nama}`
                  );
                } catch (e) {
                  // ignore
                }
              }
            }
          }

          // Commit transaction
          await connection.commit();
          console.log(
            `Inserted teacher: id=${teacherId}, email=${teacherData.email}, kelas_id=${kelasId}, sekolah_id=${schoolId}`
          );
          results.success++;
        } catch (transactionError) {
          // Rollback jika ada error
          await connection.rollback();
          console.error(
            "Transaction failed for row",
            teacherData.row_number,
            transactionError && transactionError.message
              ? transactionError.message
              : transactionError
          );
          throw transactionError;
        }
      } catch (teacherError) {
        results.failed++;
        results.errors.push(
          `Baris ${teacherData.row_number}: ${teacherError.message}`
        );
        console.error(
          `Error importing teacher ${teacherData.nip}:`,
          teacherError && teacherError.message
            ? teacherError.message
            : teacherError,
          { teacherData }
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Debug endpoint untuk melihat data Excel guru
app.post(
  "/api/debug/excel-guru",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("Debug Excel file from memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });

      // Baca file Excel langsung dari buffer
      const XLSX = require("xlsx");
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Dapatkan semua data
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      res.json({
        sheet_name: sheetName,
        headers: rawData[0] || [],
        raw_data: rawData,
        json_data: jsonData,
        total_rows: rawData.length,
        file_info: {
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (error) {
      console.error("DEBUG EXCEL GURU ERROR:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

app.post("/api/guru", authenticateTokenAndSchool, async (req, res) => {
  let connection;
  try {
    console.log("Menambah guru baru:", req.body);

    const {
      nama,
      email,
      nip,
      jenis_kelamin,
      subject_ids,
      class_ids,
      wali_kelas_id,
      status_kepegawaian,
    } = req.body;

    // Validation
    if (!nama || !email || !jenis_kelamin) {
      return res.status(400).json({
        error: "Nama, email, dan jenis kelamin wajib diisi",
      });
    }

    if (!["L", "P"].includes(jenis_kelamin)) {
      return res.status(400).json({
        error: "Jenis kelamin harus L (Laki-laki) atau P (Perempuan)",
      });
    }

    const userId = crypto.randomUUID();
    const guruId = crypto.randomUUID();
    const password = "password123";

    console.log("Creating user with ID:", userId);
    console.log("Creating guru with ID:", guruId);

    const hashedPassword = await bcrypt.hash(password, 10);
    connection = await getConnection();

    await connection.beginTransaction();

    try {
      const createdAt = new Date()
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");

      // 1. Create user record
      await connection.execute(
        'INSERT INTO users (id, nama, email, password, role, sekolah_id, created_at, updated_at) VALUES (?, ?, ?, ?, "guru", ?, ?, ?)',
        [userId, nama, email, hashedPassword, req.sekolah_id, createdAt, createdAt]
      );

      // 2. Create user_schools record
      const userSchoolId = crypto.randomUUID();
      await connection.execute(
        "INSERT INTO users_schools (id, user_id, sekolah_id, is_active, created_at) VALUES (?, ?, ?, TRUE, ?)",
        [userSchoolId, userId, req.sekolah_id, createdAt]
      );

      // 3. Create users_roles record
      await connection.execute(
        "INSERT INTO users_roles (user_school_id, role, is_active, created_at) VALUES (?, ?, TRUE, ?)",
        [userSchoolId, "guru", createdAt]
      );

      // Normalize empty values to null
      const normalizedNip = nip && nip.trim() !== '' ? nip : null;
      const normalizedWaliKelasId = wali_kelas_id && wali_kelas_id.trim() !== '' ? wali_kelas_id : null;
      const normalizedStatusKepegawaian = status_kepegawaian && status_kepegawaian.trim() !== '' ? status_kepegawaian : null;

      // 4. Create guru record
      await connection.execute(
        "INSERT INTO guru (id, user_id, nama, nip, jenis_kelamin, wali_kelas_id, status_kepegawaian, sekolah_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          guruId,
          userId,
          nama,
          normalizedNip,
          jenis_kelamin,
          normalizedWaliKelasId,
          normalizedStatusKepegawaian,
          req.sekolah_id,
          createdAt,
          createdAt,
        ]
      );

      // 5. Add subject assignments if provided
      if (subject_ids && Array.isArray(subject_ids) && subject_ids.length > 0) {
        for (const subjectId of subject_ids) {
          const relationId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO guru_mata_pelajaran (id, guru_id, mata_pelajaran_id, sekolah_id, created_at) VALUES (?, ?, ?, ?, ?)",
            [relationId, guruId, subjectId, req.sekolah_id, createdAt]
          );
        }
        console.log(`✅ Added ${subject_ids.length} subject assignments`);
      }

      // 6. Add class assignments if provided
      if (class_ids && Array.isArray(class_ids) && class_ids.length > 0) {
        for (const classId of class_ids) {
          const relationId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO guru_kelas (id, guru_id, kelas_id, sekolah_id, created_at) VALUES (?, ?, ?, ?, ?)",
            [relationId, guruId, classId, req.sekolah_id, createdAt]
          );
        }
        console.log(`✅ Added ${class_ids.length} class assignments`);
      }

      await connection.commit();
      await connection.end();

      console.log("✅ Guru berhasil ditambahkan:", email);
      res.json({
        success: true,
        message: "Guru berhasil ditambahkan",
        id: guruId,
        user_id: userId,
        info: "Password default: password123",
      });
    } catch (txErr) {
      await connection.rollback();
      await connection.end();
      console.error("TRANSACTION ERROR POST GURU:", txErr.message);
      throw txErr;
    }
  } catch (error) {
    if (connection) await connection.end();
    
    console.error("ERROR POST GURU:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Email sudah terdaftar" });
    }
    if (error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(400).json({
        error: "ID mata pelajaran, kelas, atau wali kelas tidak valid",
      });
    }

    res.status(500).json({ error: "Gagal menambah guru: " + error.message });
  }
});

// Update Guru dengan Mata Pelajaran
app.put("/api/guru/:id", authenticateTokenAndSchool, async (req, res) => {
  let connection;
  try {
    const { id } = req.params; // This is guru.id, not user_id
    console.log("Update guru:", id, req.body);

    const {
      nama,
      email,
      nip,
      jenis_kelamin,
      subject_ids,
      class_ids,
      wali_kelas_id,
      status_kepegawaian,
    } = req.body;

    // Validation
    if (!nama || !email || !jenis_kelamin) {
      return res.status(400).json({
        error: "Nama, email, dan jenis kelamin wajib diisi",
      });
    }

    if (!["L", "P"].includes(jenis_kelamin)) {
      return res.status(400).json({
        error: "Jenis kelamin harus L (Laki-laki) atau P (Perempuan)",
      });
    }

    connection = await getConnection();

    // Check if guru exists and belongs to the same school
    const [existingGuru] = await connection.execute(
      "SELECT g.id, g.user_id FROM guru g WHERE g.id = ? AND g.sekolah_id = ?",
      [id, req.sekolah_id]
    );

    if (existingGuru.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
    }

    const userId = existingGuru[0].user_id;
    const updatedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

    await connection.beginTransaction();

    try {
      // 1. Update users table
      await connection.execute(
        "UPDATE users SET nama = ?, email = ?, updated_at = ? WHERE id = ?",
        [nama, email, updatedAt, userId]
      );

      // 2. Update guru table
      await connection.execute(
        "UPDATE guru SET nama = ?, nip = ?, jenis_kelamin = ?, wali_kelas_id = ?, status_kepegawaian = ?, updated_at = ? WHERE id = ? AND sekolah_id = ?",
        [
          nama,
          nip || null,
          jenis_kelamin,
          wali_kelas_id || null,
          status_kepegawaian || null,
          updatedAt,
          id,
          req.sekolah_id,
        ]
      );

      // 3. Sync subject assignments
      // Get current subjects
      const [currentSubjects] = await connection.execute(
        "SELECT mata_pelajaran_id FROM guru_mata_pelajaran WHERE guru_id = ?",
        [id]
      );
      const currentSubjectIds = currentSubjects.map(
        (s) => s.mata_pelajaran_id
      );
      const newSubjectIds = subject_ids || [];

      // Remove subjects that are no longer assigned
      for (const currentId of currentSubjectIds) {
        if (!newSubjectIds.includes(currentId)) {
          await connection.execute(
            "DELETE FROM guru_mata_pelajaran WHERE guru_id = ? AND mata_pelajaran_id = ?",
            [id, currentId]
          );
        }
      }

      // Add new subjects
      for (const newId of newSubjectIds) {
        if (!currentSubjectIds.includes(newId)) {
          const relationId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO guru_mata_pelajaran (id, guru_id, mata_pelajaran_id, sekolah_id, created_at) VALUES (?, ?, ?, ?, ?)",
            [relationId, id, newId, req.sekolah_id, updatedAt]
          );
        }
      }

      // 4. Sync class assignments
      // Get current classes
      const [currentClasses] = await connection.execute(
        "SELECT kelas_id FROM guru_kelas WHERE guru_id = ?",
        [id]
      );
      const currentClassIds = currentClasses.map((c) => c.kelas_id);
      const newClassIds = class_ids || [];

      // Remove classes that are no longer assigned
      for (const currentId of currentClassIds) {
        if (!newClassIds.includes(currentId)) {
          await connection.execute(
            "DELETE FROM guru_kelas WHERE guru_id = ? AND kelas_id = ?",
            [id, currentId]
          );
        }
      }

      // Add new classes
      for (const newId of newClassIds) {
        if (!currentClassIds.includes(newId)) {
          const relationId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO guru_kelas (id, guru_id, kelas_id, sekolah_id, created_at) VALUES (?, ?, ?, ?, ?)",
            [relationId, id, newId, req.sekolah_id, updatedAt]
          );
        }
      }

      await connection.commit();
      await connection.end();

      console.log("✅ Guru berhasil diupdate:", id);
      res.json({
        success: true,
        message: "Guru berhasil diupdate",
      });
    } catch (txErr) {
      await connection.rollback();
      await connection.end();
      console.error("TRANSACTION ERROR PUT GURU:", txErr.message);
      if (txErr.code === "ER_DUP_ENTRY") {
        return res.status(400).json({ error: "Email sudah terdaftar" });
      }
      if (txErr.code === "ER_NO_REFERENCED_ROW_2") {
        return res.status(400).json({
          error: "ID mata pelajaran, kelas, atau wali kelas tidak valid",
        });
      }
      throw txErr;
    }
  } catch (error) {
    if (connection) await connection.end();

    console.error("ERROR PUT GURU:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate guru" });
  }
});

// Kelola Absensi
app.get("/api/absensi", authenticateTokenAndSchool, async (req, res) => {
  try {
    const {
      guru_id,
      tanggal,
      mata_pelajaran_id,
      siswa_id,
      kelas_id,
      page,
      limit,
    } = req.query;
    console.log("Mengambil data absensi untuk sekolah:", req.sekolah_id);

    let query = `
      SELECT 
        a.id,
        a.siswa_id,
        a.guru_id,
        a.mata_pelajaran_id,
        a.kelas_id,
        a.sekolah_id,
        DATE_FORMAT(a.tanggal, '%Y-%m-%d') as tanggal,
        a.status,
        a.keterangan,
        a.created_at,
        a.updated_at,
        s.nama as siswa_nama, 
        s.nis, 
        k.nama as kelas_nama, 
        k.id as kelas_id, 
        mp.nama as mata_pelajaran_nama,
        u.nama as guru_nama
      FROM absensi a
      JOIN siswa s ON a.siswa_id = s.id
      JOIN kelas k ON s.kelas_id = k.id
      JOIN mata_pelajaran mp ON a.mata_pelajaran_id = mp.id
      LEFT JOIN users u ON a.guru_id = u.id AND u.role = 'guru'
      WHERE s.sekolah_id = ? AND mp.sekolah_id = ?
    `;
    let params = [req.sekolah_id, req.sekolah_id];

    // Filter conditions (tetap sama)
    if (guru_id) {
      query += " AND a.guru_id = ?";
      params.push(guru_id);
    }

    if (tanggal) {
      query += " AND a.tanggal = ?";
      params.push(tanggal);
    }

    if (mata_pelajaran_id) {
      query += " AND a.mata_pelajaran_id = ?";
      params.push(mata_pelajaran_id);
    }

    if (siswa_id) {
      query += " AND a.siswa_id = ?";
      params.push(siswa_id);
    }

    if (kelas_id) {
      query += " AND s.kelas_id = ?";
      params.push(kelas_id);
    }

    query += " ORDER BY a.tanggal DESC, s.nama ASC";

    const connection = await getConnection();

    // If pagination requested, return paginated response with metadata
    if (page) {
      const pg = buildPaginationQuery(page, limit || 20);

      // Count total
      const countQuery = `SELECT COUNT(*) as total FROM (${query}) as sub`;
      const [countRows] = await connection.execute(countQuery, params);
      const totalItems =
        countRows[0] && countRows[0].total
          ? parseInt(countRows[0].total, 10)
          : 0;

      const paginatedQuery = `${query} ${pg.limitClause}`;
      const [absensi] = await connection.execute(paginatedQuery, params);

      const pagination = calculatePaginationMeta(
        totalItems,
        pg.currentPage,
        pg.perPage
      );

      await connection.end();

      console.log(
        "Berhasil mengambil data absensi (paginated), jumlah:",
        absensi.length
      );
      return res.json({ success: true, data: absensi, pagination });
    }

    // No pagination - return full list (backwards compatible)
    const [absensi] = await connection.execute(query, params);
    await connection.end();

    console.log("Berhasil mengambil data absensi, jumlah:", absensi.length);
    res.json(absensi);
  } catch (error) {
    console.error("ERROR GET ABSENSI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data absensi" });
  }
});

// Get Absensi Summary (Paginated & Filtered)
app.get(
  "/api/absensi/summary",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const {
        page,
        limit,
        guru_id,
        mata_pelajaran_id,
        kelas_id,
        tanggal_start,
        tanggal_end,
        tanggal, // support single date filter too
      } = req.query;

      console.log("Mengambil summary absensi untuk sekolah:", req.sekolah_id);

      const connection = await getConnection();

      // Base query conditions
      let conditions = ["a.sekolah_id = ?"];
      let params = [req.sekolah_id];

      if (guru_id) {
        conditions.push("a.guru_id = ?");
        params.push(guru_id);
      }

      if (mata_pelajaran_id) {
        conditions.push("a.mata_pelajaran_id = ?");
        params.push(mata_pelajaran_id);
      }

      if (kelas_id) {
        conditions.push("s.kelas_id = ?");
        params.push(kelas_id);
      }

      if (tanggal) {
        // Specific date
        conditions.push("DATE(a.tanggal) = ?");
        params.push(tanggal);
      } else if (tanggal_start && tanggal_end) {
        // Date range
        conditions.push("DATE(a.tanggal) BETWEEN ? AND ?");
        params.push(tanggal_start, tanggal_end);
      }

      const whereClause = conditions.join(" AND ");

      // Build pagination
      const pg = buildPaginationQuery(page, limit || 10);

      // Query to get aggregated data
      // Group by: Mata Pelajaran, Kelas, Tanggal
      const query = `
      SELECT 
        a.mata_pelajaran_id,
        mp.nama as mata_pelajaran_nama,
        s.kelas_id,
        k.nama as kelas_nama,
        DATE_FORMAT(a.tanggal, '%Y-%m-%d') as tanggal,
        COUNT(a.id) as total_students,
        SUM(CASE WHEN a.status = 'hadir' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN a.status != 'hadir' THEN 1 ELSE 0 END) as absent
      FROM absensi a
      JOIN siswa s ON a.siswa_id = s.id
      JOIN kelas k ON s.kelas_id = k.id
      JOIN mata_pelajaran mp ON a.mata_pelajaran_id = mp.id
      WHERE ${whereClause}
      GROUP BY a.mata_pelajaran_id, s.kelas_id, DATE(a.tanggal)
      ORDER BY a.tanggal DESC
      ${pg.limitClause}
    `;

      // Count total groups for pagination
      const countQuery = `
      SELECT COUNT(*) as total FROM (
        SELECT 1
        FROM absensi a
        JOIN siswa s ON a.siswa_id = s.id
        WHERE ${whereClause}
        GROUP BY a.mata_pelajaran_id, s.kelas_id, DATE(a.tanggal)
      ) as sub
    `;

      const [countRows] = await connection.execute(countQuery, params);
      const totalItems =
        countRows[0] && countRows[0].total
          ? parseInt(countRows[0].total, 10)
          : 0;

      const [summary] = await connection.execute(query, params);

      await connection.end();

      const pagination = calculatePaginationMeta(
        totalItems,
        pg.currentPage,
        pg.perPage
      );

      console.log(
        `✅ Absensi Summary: ${summary.length} groups (Total: ${totalItems})`
      );

      res.json({
        success: true,
        data: summary,
        pagination,
      });
    } catch (error) {
      console.error("ERROR GET ABSENSI SUMMARY:", error.message);
      res.status(500).json({ error: "Gagal mengambil summary absensi" });
    }
  }
);

// Export data absensi ke Excel
app.post("/api/export-presence", async (req, res) => {
  try {
    const { presenceData, filters = {} } = req.body;

    console.log("Exporting presence data:", {
      dataCount: presenceData?.length,
      filters: filters,
    });

    if (!presenceData || !Array.isArray(presenceData)) {
      return res.status(400).json({
        success: false,
        message: "Data absensi tidak valid",
      });
    }

    if (presenceData.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Tidak ada data absensi untuk diexport",
      });
    }

    // Debug: Log sample data
    console.log("Sample data:", presenceData.slice(0, 2));

    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for Excel - PERBAIKI MAPPING DATA
    const excelData = [
      // Header row
      [
        "NIS",
        "Nama Siswa",
        "Kelas",
        "Mata Pelajaran",
        "Tanggal",
        "Hari",
        "Status",
        "Keterangan",
        "Guru Pengajar",
        "Jam Pelajaran",
      ],
      // Data rows - PERBAIKI ACCESSOR FIELDS
      ...presenceData.map((presence) => {
        // Format tanggal dari ISO string ke format readable
        const tanggal = presence.tanggal
          ? new Date(presence.tanggal).toISOString().split("T")[0]
          : "";

        // Get day name
        const hari = presence.tanggal ? getDayName(presence.tanggal) : "";

        // Get status label
        const status = getStatusLabel(presence.status);

        return [
          presence.nis || "",
          presence.siswa_nama || "",
          presence.kelas_nama || "",
          presence.mata_pelajaran_nama || "",
          tanggal,
          hari,
          status,
          presence.keterangan || "",
          presence.guru_nama || "", // Pastikan field ini ada di data
          presence.jam_pelajaran || "", // Pastikan field ini ada di data
        ];
      }),
    ];

    console.log("Excel data prepared, rows:", excelData.length);

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths for better readability
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    const columnWidths = [12, 20, 15, 20, 12, 10, 12, 20, 20, 15];
    for (let i = 0; i < columnWidths.length; i++) {
      worksheet["!cols"][i] = { width: columnWidths[i] };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data Absensi");

    // Generate Excel buffer
    const excelBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    console.log("Excel file generated successfully, size:", excelBuffer.length);

    // Set headers untuk file download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Data_Absensi_${Date.now()}.xlsx"`
    );
    res.setHeader("Content-Length", excelBuffer.length);

    // Kirim file buffer
    res.send(excelBuffer);
  } catch (error) {
    console.error("EXPORT PRESENCE ERROR:", error.message);
    console.error("Error stack:", error.stack);

    // Pastikan mengirim JSON error response
    res.status(500).json({
      success: false,
      message: `Gagal mengexport data absensi: ${error.message}`,
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Helper functions - PASTIKAN ADA
function getStatusLabel(status) {
  if (!status) return "";

  switch (status.toLowerCase()) {
    case "hadir":
      return "Hadir";
    case "terlambat":
      return "Terlambat";
    case "izin":
      return "Izin";
    case "sakit":
      return "Sakit";
    case "alpha":
      return "Alpha";
    default:
      return status;
  }
}

function getDayName(dateString) {
  if (!dateString) return "";

  try {
    const days = [
      "Minggu",
      "Senin",
      "Selasa",
      "Rabu",
      "Kamis",
      "Jumat",
      "Sabtu",
    ];
    const date = new Date(dateString);
    return days[date.getDay()];
  } catch (error) {
    console.error("Error parsing date:", error);
    return "";
  }
}
// Validasi data absensi sebelum import
app.post("/api/validate-presence", authenticateToken, async (req, res) => {
  try {
    const { presenceData } = req.body;

    if (!presenceData || !Array.isArray(presenceData)) {
      return res.status(400).json({
        success: false,
        message: "Data absensi tidak valid",
      });
    }

    const validatedData = [];
    const errors = [];

    for (let i = 0; i < presenceData.length; i++) {
      const presence = presenceData[i];
      const validatedPresence = {};
      let hasError = false;

      // Validasi field required
      if (!presence.nis || presence.nis.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: NIS tidak boleh kosong`);
        hasError = true;
      } else {
        validatedPresence.nis = presence.nis.toString().trim();
      }

      if (
        !presence.siswa_nama ||
        presence.siswa_nama.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Nama siswa tidak boleh kosong`);
        hasError = true;
      } else {
        validatedPresence.siswa_nama = presence.siswa_nama.toString().trim();
      }

      if (
        !presence.kelas_nama ||
        presence.kelas_nama.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Kelas tidak boleh kosong`);
        hasError = true;
      } else {
        validatedPresence.kelas_nama = presence.kelas_nama.toString().trim();
      }

      if (
        !presence.mata_pelajaran_nama ||
        presence.mata_pelajaran_nama.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Mata pelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedPresence.mata_pelajaran_nama = presence.mata_pelajaran_nama
          .toString()
          .trim();
      }

      if (!presence.tanggal || presence.tanggal.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: Tanggal tidak boleh kosong`);
        hasError = true;
      } else {
        validatedPresence.tanggal = presence.tanggal.toString().trim();
      }

      if (!presence.status || presence.status.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: Status tidak boleh kosong`);
        hasError = true;
      } else {
        const status = presence.status.toString().trim().toLowerCase();
        const allowedStatus = ["hadir", "terlambat", "izin", "sakit", "alpha"];
        if (!allowedStatus.includes(status)) {
          errors.push(
            `Baris ${
              i + 1
            }: Status harus salah satu dari: hadir, terlambat, izin, sakit, alpha`
          );
          hasError = true;
        } else {
          validatedPresence.status = status;
        }
      }

      // Field optional
      validatedPresence.keterangan = presence.keterangan || "";
      validatedPresence.guru_nama = presence.guru_nama || "";
      validatedPresence.jam_pelajaran = presence.jam_pelajaran || "";

      if (!hasError) {
        validatedData.push(validatedPresence);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validasi data absensi gagal",
        errors: errors,
        validatedData: validatedData,
      });
    }

    res.json({
      success: true,
      message: "Validasi data absensi berhasil",
      validatedData: validatedData,
    });
  } catch (error) {
    console.error("Presence validation error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal validasi data absensi: ${error.message}`,
    });
  }
});

function getDayName(dateString) {
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const date = new Date(dateString);
  return days[date.getDay()];
}

// Debug endpoint untuk cek struktur tabel absensi
app.get("/api/debug/absensi-structure", authenticateToken, async (req, res) => {
  try {
    const connection = await getConnection();
    const [structure] = await connection.execute("DESCRIBE absensi");
    await connection.end();
    res.json({ structure });
  } catch (error) {
    console.error("ERROR GET ABSENSI STRUCTURE:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get data absensi existing untuk debugging
app.get("/api/debug/absensi-data", authenticateToken, async (req, res) => {
  try {
    const connection = await getConnection();
    const [absensi] = await connection.execute(
      "SELECT id, siswa_id, guru_id, mata_pelajaran_id, kelas_id, sekolah_id, DATE_FORMAT(tanggal, '%Y-%m-%d') as tanggal, status, keterangan, created_at, updated_at FROM absensi LIMIT 10"
    );
    await connection.end();
    res.json({ absensi });
  } catch (error) {
    console.error("ERROR GET ABSENSI DATA:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Perbaiki endpoint POST absensi dengan validasi lengkap
app.post("/api/absensi", authenticateTokenAndSchool, async (req, res) => {
  let connection;
  try {
    console.log("Menambah absensi:", req.body);
    const {
      siswa_id,
      guru_id,
      mata_pelajaran_id,
      kelas_id,
      tanggal,
      status,
      keterangan,
    } = req.body;

    // Validasi data required dengan pesan yang lebih jelas
    const missingFields = [];
    if (!siswa_id) missingFields.push("siswa_id");
    if (!guru_id) missingFields.push("guru_id");
    if (!mata_pelajaran_id) missingFields.push("mata_pelajaran_id");
    if (!kelas_id) missingFields.push("kelas_id");
    if (!tanggal) missingFields.push("tanggal");
    if (!status) missingFields.push("status");

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: "Data tidak lengkap",
        missing_fields: missingFields,
      });
    }

    // Validasi status
    const allowedStatus = ["hadir", "terlambat", "izin", "sakit", "alpha"];
    if (!allowedStatus.includes(status)) {
      return res.status(400).json({
        error: "Status tidak valid",
        allowed: allowedStatus,
        received: status,
      });
    }

    connection = await getConnection();

    // Cek apakah siswa termasuk dalam sekolah yang sama
    const [siswaCheck] = await connection.execute(
      "SELECT id FROM siswa WHERE id = ? AND sekolah_id = ?",
      [siswa_id, req.sekolah_id]
    );

    if (siswaCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Siswa tidak ditemukan atau tidak memiliki akses" });
    }

    // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
    const [mapelCheck] = await connection.execute(
      "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
      [mata_pelajaran_id, req.sekolah_id]
    );

    if (mapelCheck.length === 0) {
      await connection.end();
      return res.status(404).json({
        error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
      });
    }

    // Cek apakah guru termasuk dalam sekolah yang sama
    const [guruCheck] = await connection.execute(
      "SELECT id FROM users WHERE id = ? AND role = 'guru' AND sekolah_id = ?",
      [guru_id, req.sekolah_id]
    );

    if (guruCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
    }

    // Cek apakah absensi sudah ada untuk kombinasi yang sama
    const [existing] = await connection.execute(
      "SELECT id FROM absensi WHERE siswa_id = ? AND mata_pelajaran_id = ? AND tanggal = ? AND guru_id = ?",
      [siswa_id, mata_pelajaran_id, tanggal, guru_id]
    );

    let absensiId;
    let action;

    if (existing.length > 0) {
      // Update jika sudah ada
      absensiId = existing[0].id;
      action = "updated";

      await connection.execute(
        "UPDATE absensi SET status = ?, keterangan = ?, kelas_id = ?, sekolah_id = ?, updated_at = NOW() WHERE id = ?",
        [status, keterangan || "", kelas_id, req.sekolah_id, absensiId]
      );
      console.log("Absensi berhasil diupdate:", absensiId);
    } else {
      // Insert baru
      absensiId = crypto.randomUUID();
      action = "created";

      await connection.execute(
        "INSERT INTO absensi (id, siswa_id, guru_id, mata_pelajaran_id, kelas_id, sekolah_id, tanggal, status, keterangan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          absensiId,
          siswa_id,
          guru_id,
          mata_pelajaran_id,
          kelas_id,
          req.sekolah_id,
          tanggal,
          status,
          keterangan || "",
        ]
      );
      console.log("Absensi berhasil ditambahkan:", absensiId);
    }

    // ========== KIRIM NOTIFIKASI ==========
    try {
      // Ambil data siswa dan mata pelajaran untuk notifikasi
      const [siswaData] = await connection.execute(
        "SELECT nama FROM siswa WHERE id = ?",
        [siswa_id]
      );

      const [mapelData] = await connection.execute(
        "SELECT nama FROM mata_pelajaran WHERE id = ?",
        [mata_pelajaran_id]
      );

      if (siswaData.length > 0 && mapelData.length > 0) {
        // Format tanggal untuk notifikasi
        const formattedDate = new Date(tanggal).toLocaleDateString("id-ID", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        // Buat body notifikasi berdasarkan status
        let notificationTitle, notificationBody;

        switch (status) {
          case "hadir":
            notificationTitle = "✅ Absensi Hadir";
            notificationBody = `${siswaData[0].nama} hadir pada pelajaran ${mapelData[0].nama}`;
            break;
          case "terlambat":
            notificationTitle = "⚠️ Keterlambatan";
            notificationBody = `${siswaData[0].nama} terlambat pada pelajaran ${mapelData[0].nama}`;
            break;
          case "izin":
            notificationTitle = "📝 Izin";
            notificationBody = `${siswaData[0].nama} izin pada pelajaran ${mapelData[0].nama}`;
            break;
          case "sakit":
            notificationTitle = "🏥 Sakit";
            notificationBody = `${siswaData[0].nama} sakit pada pelajaran ${mapelData[0].nama}`;
            break;
          case "alpha":
            notificationTitle = "❌ Alpha";
            notificationBody = `${siswaData[0].nama} alpha pada pelajaran ${mapelData[0].nama}`;
            break;
          default:
            notificationTitle = "📋 Absensi";
            notificationBody = `Update absensi ${siswaData[0].nama} pada ${mapelData[0].nama}`;
        }

        // Tambahkan keterangan jika ada
        if (keterangan) {
          notificationBody += ` - ${keterangan}`;
        }

        // Panggil endpoint notifikasi absensi
        const notificationBodyData = {
          siswa_id: siswa_id,
          status_absensi: status,
          mata_pelajaran: mapelData[0].nama,
          tanggal: tanggal,
          data: {
            absensi_id: absensiId,
            action: action,
            tanggal_formatted: formattedDate,
          },
        };

        console.log("Mengirim notifikasi absensi:", notificationBodyData);

        // Kirim request notifikasi - gunakan internal function, tidak perlu HTTP request
        await sendAbsensiNotification(
          notificationBodyData,
          req.headers["authorization"]
        );
      }
    } catch (notifError) {
      console.error("Error dalam pengiriman notifikasi:", notifError);
      // Jangan gagalkan proses absensi hanya karena notifikasi error
    }
    // ========== END KIRIM NOTIFIKASI ==========

    await connection.end();

    return res.json({
      message: `Absensi berhasil ${
        action === "created" ? "ditambahkan" : "diupdate"
      }`,
      id: absensiId,
      action: action,
    });
  } catch (error) {
    // Pastikan koneksi ditutup jika ada error
    if (connection) {
      await connection.end();
    }

    console.error("ERROR POST ABSENSI:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_NO_SUCH_TABLE") {
      return res.status(500).json({
        error:
          "Tabel absensi tidak ditemukan. Silakan buat tabel terlebih dahulu.",
      });
    }

    if (error.code === "ER_BAD_NULL_ERROR") {
      return res.status(400).json({
        error: "Data required tidak boleh kosong",
        details: error.message,
      });
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        error:
          "Absensi untuk siswa ini sudah ada pada tanggal dan mata pelajaran yang sama",
      });
    }

    res.status(500).json({
      error: "Gagal menambah absensi: " + error.message,
      code: error.code,
    });
  }
});

// Helper function untuk mengirim notifikasi absensi
async function sendAbsensiNotification(notificationData, authHeader) {
  try {
    const { siswa_id, status_absensi, mata_pelajaran, tanggal, data } =
      notificationData;

    // Dapatkan user_id wali dari siswa
    const connection = await getConnection();
    const [wali] = await connection.execute(
      "SELECT u.id as user_id FROM users u WHERE u.siswa_id = ? AND u.role = 'wali'",
      [siswa_id]
    );

    if (wali.length === 0) {
      await connection.end();
      console.log("User wali tidak ditemukan untuk siswa:", siswa_id);
      return;
    }

    const waliUserId = wali[0].user_id;
    const tokens = await getUserFCMTokens(waliUserId);

    if (tokens.length === 0) {
      await connection.end();
      console.log("Tidak ada token aktif untuk wali:", waliUserId);
      return;
    }

    // Buat title dan body notifikasi
    const title = getAbsensiTitle(status_absensi);
    const body = getAbsensiBody(
      status_absensi,
      mata_pelajaran,
      data?.tanggal_formatted
    );

    const fcmData = {
      type: "absensi",
      siswa_id: siswa_id,
      status_absensi: status_absensi,
      mata_pelajaran: mata_pelajaran,
      tanggal: tanggal,
      absensi_id: data?.absensi_id,
      action: data?.action,
      timestamp: new Date().toISOString(),
      ...data,
    };

    const result = await sendNotificationToMultiple(
      tokens,
      title,
      body,
      fcmData
    );

    // Simpan ke history notifications
    const notifId = crypto.randomUUID();
    await connection.execute(
      "INSERT INTO notifications (id, user_id, title, body, type, data) VALUES (?, ?, ?, ?, 'absensi', ?)",
      [notifId, waliUserId, title, body, JSON.stringify(fcmData)]
    );

    await connection.end();

    console.log("Notifikasi absensi berhasil dikirim ke wali:", waliUserId);
    return result;
  } catch (error) {
    console.error("ERROR SEND ABSENSI NOTIFICATION:", error.message);
  }
}

// Helper function untuk title notifikasi absensi
function getAbsensiTitle(status) {
  const titles = {
    hadir: "✅ Absensi Hadir",
    terlambat: "⚠️ Keterlambatan",
    izin: "📝 Izin",
    sakit: "🏥 Sakit",
    alpha: "❌ Alpha",
  };
  return titles[status] || "📋 Update Absensi";
}

// Helper function untuk body notifikasi absensi
function getAbsensiBody(status, mataPelajaran, tanggalFormatted) {
  const baseBodies = {
    hadir: `hadir pada pelajaran ${mataPelajaran}`,
    terlambat: `terlambat pada pelajaran ${mataPelajaran}`,
    izin: `izin pada pelajaran ${mataPelajaran}`,
    sakit: `sakit pada pelajaran ${mataPelajaran}`,
    alpha: `alpha pada pelajaran ${mataPelajaran}`,
  };

  const baseBody =
    baseBodies[status] || `ada update absensi pada ${mataPelajaran}`;

  if (tanggalFormatted) {
    return `Anak Anda ${baseBody} - ${tanggalFormatted}`;
  }

  return `Anak Anda ${baseBody}`;
}

// Helper function untuk mengirim notifikasi aktivitas kelas
async function sendClassActivityNotification(activityData, authHeader) {
  try {
    const {
      kegiatan_id,
      kelas_id,
      judul,
      deskripsi,
      jenis,
      target,
      mata_pelajaran,
      guru_nama,
      tanggal,
      siswa_target,
    } = activityData;

    const connection = await getConnection();

    // Dapatkan daftar siswa berdasarkan target
    let siswaList = [];

    if (target === "khusus" && siswa_target && siswa_target.length > 0) {
      // Untuk target khusus, ambil siswa yang ditarget
      const placeholders = siswa_target.map(() => "?").join(",");
      const [siswa] = await connection.execute(
        `SELECT id, nama FROM siswa WHERE id IN (${placeholders})`,
        siswa_target
      );
      siswaList = siswa;
    } else {
      // Untuk target umum, ambil semua siswa di kelas tersebut
      const [siswa] = await connection.execute(
        "SELECT id, nama FROM siswa WHERE kelas_id = ?",
        [kelas_id]
      );
      siswaList = siswa;
    }

    if (siswaList.length === 0) {
      await connection.end();
      console.log("Tidak ada siswa ditemukan untuk kelas:", kelas_id);
      return;
    }

    // Loop untuk setiap siswa dan kirim notifikasi ke wali masing-masing
    for (const siswa of siswaList) {
      try {
        // Dapatkan user_id wali dari siswa
        const [wali] = await connection.execute(
          "SELECT u.id as user_id, u.nama as wali_nama FROM users u WHERE u.siswa_id = ? AND u.role = 'wali'",
          [siswa.id]
        );

        if (wali.length === 0) {
          console.log(`User wali tidak ditemukan untuk siswa: ${siswa.nama}`);
          continue;
        }

        const waliUserId = wali[0].user_id;
        const tokens = await getUserFCMTokens(waliUserId);

        if (tokens.length === 0) {
          console.log(`Tidak ada token aktif untuk wali: ${wali[0].wali_nama}`);
          continue;
        }

        // Buat title dan body notifikasi
        const title = getActivityTitle(jenis);
        const body = getActivityBody(jenis, judul, mata_pelajaran, siswa.nama);

        const fcmData = {
          type: "class_activity",
          kegiatan_id: kegiatan_id,
          siswa_id: siswa.id,
          siswa_nama: siswa.nama,
          kelas_id: kelas_id,
          judul: judul,
          deskripsi: deskripsi,
          jenis: jenis,
          target: target,
          mata_pelajaran: mata_pelajaran,
          guru_nama: guru_nama,
          tanggal: tanggal,
          timestamp: new Date().toISOString(),
        };

        const result = await sendNotificationToMultiple(
          tokens,
          title,
          body,
          fcmData
        );

        // Simpan ke history notifications
        try {
          const notifId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO notifications (id, user_id, title, body, type, data) VALUES (?, ?, ?, ?, ?, ?)",
            [
              notifId,
              waliUserId,
              title,
              body,
              "class_activity",
              JSON.stringify(fcmData),
            ]
          );
          console.log(
            `✅ Notifikasi tersimpan ke database untuk wali: ${wali[0].wali_nama}`
          );
        } catch (dbError) {
          console.error(
            `❌ Error menyimpan notifikasi ke database untuk siswa ${siswa.nama}:`,
            dbError.message
          );
          console.error(
            `SQL Error Code: ${dbError.code}, SQL State: ${dbError.sqlState}`
          );
          // Lanjutkan meskipun gagal simpan ke database
        }

        console.log(
          `✅ Notifikasi aktivitas kelas berhasil dikirim ke wali: ${wali[0].wali_nama} untuk siswa: ${siswa.nama}`
        );
      } catch (error) {
        console.error(
          `❌ Error mengirim notifikasi untuk siswa ${siswa.nama}:`,
          error.message
        );
        console.error(`Error Stack:`, error.stack);
        // Lanjutkan ke siswa berikutnya
        continue;
      }
    }

    await connection.end();
    return { success: true, sent_count: siswaList.length };
  } catch (error) {
    console.error("ERROR SEND CLASS ACTIVITY NOTIFICATION:", error.message);
  }
}

// Helper function untuk title notifikasi aktivitas
function getActivityTitle(jenis) {
  const titles = {
    tugas: "📝 Tugas Baru",
    pr: "📚 PR Baru",
    ujian: "📋 Ujian",
    materi: "📖 Materi Baru",
    pengumuman: "📢 Pengumuman",
    kegiatan: "🎯 Kegiatan Baru",
  };
  return titles[jenis] || "📌 Aktivitas Kelas";
}

// Helper function untuk body notifikasi aktivitas
function getActivityBody(jenis, judul, mataPelajaran, siswaNama) {
  const jenisText =
    jenis === "tugas"
      ? "tugas"
      : jenis === "pr"
      ? "PR"
      : jenis === "ujian"
      ? "ujian"
      : jenis === "materi"
      ? "materi"
      : jenis === "pengumuman"
      ? "pengumuman"
      : "aktivitas";

  return `${siswaNama} mendapat ${jenisText} "${judul}" untuk mata pelajaran ${mataPelajaran}`;
}

// Helper function untuk mengirim notifikasi pengumuman
async function sendPengumumanNotification(pengumumanData, authHeader) {
  try {
    const {
      pengumuman_id,
      judul,
      konten,
      kelas_id,
      kelas_nama,
      role_target,
      prioritas,
      pembuat_nama,
      sekolah_id,
    } = pengumumanData;

    const connection = await getConnection();

    // Tentukan target users berdasarkan role_target dan kelas_id
    let targetUsers = [];

    if (role_target === "wali" || role_target === "all") {
      // Ambil wali murid
      let waliQuery = `
        SELECT DISTINCT u.id as user_id, u.nama as user_nama, u.role
        FROM users u
        WHERE u.role = 'wali' AND u.sekolah_id = ?
      `;
      let waliParams = [sekolah_id];

      // Jika ada kelas spesifik, filter wali yang anaknya di kelas tersebut
      if (kelas_id) {
        waliQuery = `
          SELECT DISTINCT u.id as user_id, u.nama as user_nama, u.role
          FROM users u
          JOIN siswa s ON u.siswa_id = s.id
          WHERE u.role = 'wali' 
            AND s.kelas_id = ? 
            AND u.sekolah_id = ?
        `;
        waliParams = [kelas_id, sekolah_id];
      }

      console.log(
        `🔍 Query wali - sekolah_id: ${sekolah_id}, kelas_id: ${
          kelas_id || "semua"
        }`
      );
      const [waliList] = await connection.execute(waliQuery, waliParams);
      console.log(`📊 Ditemukan ${waliList.length} wali murid`);
      if (waliList.length > 0) {
        console.log(`   Contoh wali: ${waliList[0].user_nama}`);
      }
      targetUsers.push(...waliList);
    }

    if (role_target === "guru" || role_target === "all") {
      // Ambil guru
      let guruQuery = `
        SELECT DISTINCT u.id as user_id, u.nama as user_nama, u.role
        FROM users u
        WHERE u.role = 'guru' AND u.sekolah_id = ?
      `;
      let guruParams = [sekolah_id];

      // Jika ada kelas spesifik, filter guru yang mengajar di kelas tersebut
      if (kelas_id) {
        guruQuery = `
          SELECT DISTINCT u.id as user_id, u.nama as user_nama, u.role
          FROM users u
          JOIN jadwal j ON u.id = j.guru_id
          WHERE u.role = 'guru' 
            AND j.kelas_id = ? 
            AND u.sekolah_id = ?
        `;
        guruParams = [kelas_id, sekolah_id];
      }

      const [guruList] = await connection.execute(guruQuery, guruParams);
      targetUsers.push(...guruList);
    }

    if (role_target === "siswa" || role_target === "all") {
      // PENTING: Sistem ini tidak punya user siswa terpisah.
      // Ketika target adalah 'siswa', kirim notifikasi ke WALI yang memiliki siswa tersebut

      console.log(
        `🔍 Query siswa - sekolah_id: ${sekolah_id}, kelas_id: ${
          kelas_id || "semua"
        }`
      );
      console.log(
        `ℹ️  Catatan: Notifikasi untuk siswa akan dikirim ke wali murid`
      );

      // Cari wali yang memiliki siswa (siswa_id terisi)
      let siswaWaliQuery = `
        SELECT DISTINCT u.id as user_id, u.nama as user_nama, u.role, s.nama as nama_siswa
        FROM users u
        JOIN siswa s ON u.siswa_id = s.id
        WHERE u.role = 'wali' AND u.sekolah_id = ?
      `;
      let siswaWaliParams = [sekolah_id];

      // Jika ada kelas spesifik, filter wali yang siswanya di kelas tersebut
      if (kelas_id) {
        siswaWaliQuery = `
          SELECT DISTINCT u.id as user_id, u.nama as user_nama, u.role, s.nama as nama_siswa
          FROM users u
          JOIN siswa s ON u.siswa_id = s.id
          WHERE u.role = 'wali' 
            AND s.kelas_id = ? 
            AND u.sekolah_id = ?
        `;
        siswaWaliParams = [kelas_id, sekolah_id];
      }

      const [siswaWaliList] = await connection.execute(
        siswaWaliQuery,
        siswaWaliParams
      );
      console.log(
        `📊 Ditemukan ${siswaWaliList.length} wali murid (target siswa)`
      );
      if (siswaWaliList.length > 0) {
        console.log(
          `   Contoh: Wali ${siswaWaliList[0].user_nama} (siswa: ${siswaWaliList[0].nama_siswa})`
        );
      }

      // Tambahkan ke target users (cek duplikat jika role_target = 'all')
      for (const wali of siswaWaliList) {
        if (!targetUsers.find((u) => u.user_id === wali.user_id)) {
          targetUsers.push(wali);
        }
      }
    }

    if (targetUsers.length === 0) {
      await connection.end();
      console.log(`Tidak ada target user untuk pengumuman: ${judul}`);
      return { success: false, sent_count: 0 };
    }

    console.log(
      `📢 Target pengumuman: ${targetUsers.length} users (${role_target})`
    );

    let successCount = 0;
    let failCount = 0;

    // Loop untuk setiap target user
    for (const user of targetUsers) {
      try {
        // Dapatkan FCM tokens user
        const tokens = await getUserFCMTokens(user.user_id);

        if (tokens.length === 0) {
          console.log(
            `⚠️  Tidak ada token aktif untuk ${user.role}: ${user.user_nama}`
          );
          continue;
        }

        // Buat title dan body notifikasi
        const title = getPengumumanTitle(prioritas);
        const body = getPengumumanBody(judul, kelas_nama);

        const fcmData = {
          type: "pengumuman",
          pengumuman_id: pengumuman_id,
          judul: judul,
          konten: konten.substring(0, 200), // Truncate konten panjang
          kelas_id: kelas_id || "",
          kelas_nama: kelas_nama || "",
          role_target: role_target,
          prioritas: prioritas,
          pembuat_nama: pembuat_nama,
          timestamp: new Date().toISOString(),
        };

        const result = await sendNotificationToMultiple(
          tokens,
          title,
          body,
          fcmData
        );

        // Simpan ke history notifications
        if (result.success) {
          try {
            const notifId = crypto.randomUUID();
            await connection.execute(
              "INSERT INTO notifications (id, user_id, title, body, type, data) VALUES (?, ?, ?, ?, ?, ?)",
              [
                notifId,
                user.user_id,
                title,
                body,
                "pengumuman",
                JSON.stringify(fcmData),
              ]
            );
            successCount++;
            console.log(
              `✅ Pengumuman terkirim ke ${user.role}: ${user.user_nama}`
            );
          } catch (dbError) {
            console.error(
              `❌ Error menyimpan notifikasi untuk ${user.user_nama}:`,
              dbError.message
            );
          }
        } else {
          failCount++;
        }
      } catch (error) {
        console.error(
          `❌ Error mengirim pengumuman ke ${user.user_nama}:`,
          error.message
        );
        failCount++;
        continue;
      }
    }

    await connection.end();
    console.log(
      `📊 Pengumuman: ${successCount} berhasil, ${failCount} gagal dari ${targetUsers.length} target`
    );

    return {
      success: successCount > 0,
      sent_count: successCount,
      failed_count: failCount,
      total_targets: targetUsers.length,
    };
  } catch (error) {
    console.error("ERROR SEND PENGUMUMAN NOTIFICATION:", error.message);
    console.error("Stack:", error.stack);
    return { success: false, sent_count: 0 };
  }
}

// Helper function untuk title notifikasi pengumuman
function getPengumumanTitle(prioritas) {
  const titles = {
    urgent: "🚨 PENGUMUMAN PENTING",
    penting: "⚠️ Pengumuman Penting",
    biasa: "📢 Pengumuman",
  };
  return titles[prioritas] || "📢 Pengumuman";
}

// Helper function untuk body notifikasi pengumuman
function getPengumumanBody(judul, kelasNama) {
  if (kelasNama) {
    return `${judul} - Kelas ${kelasNama}`;
  }
  return judul;
}

// Kelola Nilai
app.get("/api/nilai", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { siswa_id, guru_id, mata_pelajaran_id, jenis } = req.query;
    console.log("Mengambil data nilai untuk sekolah:", req.sekolah_id);

    let query = `
      SELECT n.*, s.nama as siswa_nama, s.nis, mp.nama as mata_pelajaran_nama
      FROM nilai n
      JOIN siswa s ON n.siswa_id = s.id
      JOIN mata_pelajaran mp ON n.mata_pelajaran_id = mp.id
      WHERE s.sekolah_id = ? AND mp.sekolah_id = ? AND n.sekolah_id = ?
    `;
    let params = [req.sekolah_id, req.sekolah_id, req.sekolah_id];

    if (siswa_id) {
      query += " AND n.siswa_id = ?";
      params.push(siswa_id);
    }

    if (guru_id) {
      query += " AND n.guru_id = ?";
      params.push(guru_id);
    }

    if (mata_pelajaran_id) {
      query += " AND n.mata_pelajaran_id = ?";
      params.push(mata_pelajaran_id);
    }

    if (jenis) {
      query += " AND n.jenis = ?";
      params.push(jenis);
    }

    const connection = await getConnection();
    const [nilai] = await connection.execute(query, params);
    await connection.end();

    console.log("Berhasil mengambil data nilai, jumlah:", nilai.length);
    res.json(nilai);
  } catch (error) {
    console.error("ERROR GET NILAI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data nilai" });
  }
});

app.post("/api/export-nilai", async (req, res) => {
  try {
    const { nilaiData, filters = {} } = req.body;

    if (!nilaiData || !Array.isArray(nilaiData)) {
      return res.status(400).json({
        success: false,
        message: "Data nilai tidak valid",
      });
    }

    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for Excel
    const excelData = [
      // Header row
      [
        "NIS",
        "Nama Siswa",
        "Kelas",
        "Mata Pelajaran",
        "Jenis Nilai",
        "Nilai",
        "Deskripsi",
        "Tanggal",
        "Guru Pengajar",
      ],
      // Data rows
      ...nilaiData.map((nilai) => [
        nilai.nis || "",
        nilai.nama_siswa || "",
        nilai.kelas_nama || "",
        nilai.mata_pelajaran_nama || "",
        getJenisNilaiLabel(nilai.jenis),
        nilai.nilai?.toString() || "",
        nilai.deskripsi || "",
        formatDateForExport(nilai.tanggal),
        nilai.guru_nama || "",
      ]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths for better readability
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    const columnWidths = [12, 20, 15, 20, 12, 8, 25, 12, 20];
    for (let i = 0; i < columnWidths.length; i++) {
      worksheet["!cols"][i] = { width: columnWidths[i] };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data Nilai");

    // Generate filename
    const filename = `Data_Nilai_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading file:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh file",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Export nilai error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengexport data nilai: ${error.message}`,
    });
  }
});

function getJenisNilaiLabel(jenis) {
  switch (jenis) {
    case "harian":
      return "Harian";
    case "tugas":
      return "Tugas";
    case "ulangan":
      return "Ulangan";
    case "uts":
      return "UTS";
    case "uas":
      return "UAS";
    default:
      return jenis;
  }
}

function formatDateForExport(date) {
  if (!date) return "";
  try {
    const parsed = new Date(date);
    return parsed.toISOString().split("T")[0];
  } catch (e) {
    return date;
  }
}

app.post("/api/nilai", authenticateTokenAndSchool, async (req, res) => {
  try {
    console.log("Menambah nilai:", req.body);
    const {
      siswa_id,
      guru_id,
      mata_pelajaran_id,
      jenis,
      nilai: nilaiValue,
      deskripsi,
      tanggal,
    } = req.body;

    const id = crypto.randomUUID();
    const connection = await getConnection();

    // Cek apakah siswa termasuk dalam sekolah yang sama
    const [siswaCheck] = await connection.execute(
      "SELECT id FROM siswa WHERE id = ? AND sekolah_id = ?",
      [siswa_id, req.sekolah_id]
    );

    if (siswaCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Siswa tidak ditemukan atau tidak memiliki akses" });
    }

    // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
    const [mapelCheck] = await connection.execute(
      "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
      [mata_pelajaran_id, req.sekolah_id]
    );

    if (mapelCheck.length === 0) {
      await connection.end();
      return res.status(404).json({
        error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
      });
    }

    const [nilaiExist] = await connection.execute(
      "SELECT id FROM nilai WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id]
    );
    if (nilaiExist.length > 0) {
      await connection.end();
      return res
        .status(400)
        .json({ error: "Nilai dengan ID tersebut sudah ada" });
    }

    // Cek apakah guru termasuk dalam sekolah yang sama
    const [guruCheck] = await connection.execute(
      "SELECT id FROM users WHERE id = ? AND role = 'guru' AND sekolah_id = ?",
      [guru_id, req.sekolah_id]
    );

    if (guruCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
    }

    await connection.execute(
      "INSERT INTO nilai (id, siswa_id, guru_id, mata_pelajaran_id, jenis, nilai, deskripsi, tanggal, sekolah_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        siswa_id,
        guru_id,
        mata_pelajaran_id,
        jenis,
        nilaiValue,
        deskripsi,
        tanggal,
        req.sekolah_id,
      ]
    );
    await connection.end();

    console.log("Nilai berhasil ditambahkan:", id);
    res.json({ message: "Nilai berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST NILAI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah nilai" });
  }
});

// Update Nilai
app.put("/api/nilai/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update nilai:", id, req.body);
    const {
      siswa_id,
      guru_id,
      mata_pelajaran_id,
      jenis,
      nilai: nilaiValue,
      deskripsi,
      tanggal,
    } = req.body;

    const connection = await getConnection();

    // Cek apakah nilai termasuk dalam sekolah yang sama melalui relasi siswa/mapel
    const [nilaiCheck] = await connection.execute(
      `SELECT n.id 
       FROM nilai n
       JOIN siswa s ON n.siswa_id = s.id
       JOIN mata_pelajaran mp ON n.mata_pelajaran_id = mp.id
       WHERE n.id = ? AND s.sekolah_id = ? AND mp.sekolah_id = ? AND n.sekolah_id = ?`,
      [id, req.sekolah_id, req.sekolah_id, req.sekolah_id]
    );

    if (nilaiCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Nilai tidak ditemukan atau tidak memiliki akses" });
    }

    // Validasi data terkait
    const [siswaCheck] = await connection.execute(
      "SELECT id FROM siswa WHERE id = ? AND sekolah_id = ?",
      [siswa_id, req.sekolah_id]
    );

    if (siswaCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Siswa tidak ditemukan atau tidak memiliki akses" });
    }

    const [mapelCheck] = await connection.execute(
      "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
      [mata_pelajaran_id, req.sekolah_id]
    );

    if (mapelCheck.length === 0) {
      await connection.end();
      return res.status(404).json({
        error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
      });
    }

    await connection.execute(
      "UPDATE nilai SET siswa_id = ?, guru_id = ?, mata_pelajaran_id = ?, jenis = ?, nilai = ?, deskripsi = ?, tanggal = ? WHERE id = ?",
      [
        siswa_id,
        guru_id,
        mata_pelajaran_id,
        jenis,
        nilaiValue,
        deskripsi,
        tanggal,
        id,
      ]
    );
    await connection.end();

    console.log("Nilai berhasil diupdate:", id);
    res.json({ message: "Nilai berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT NILAI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate nilai" });
  }
});

// Delete Nilai
app.delete("/api/nilai/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete nilai:", id);

    const connection = await getConnection();

    // Cek apakah nilai termasuk dalam sekolah yang sama
    const [nilaiCheck] = await connection.execute(
      `SELECT n.id 
       FROM nilai n
       JOIN siswa s ON n.siswa_id = s.id
       JOIN mata_pelajaran mp ON n.mata_pelajaran_id = mp.id
       WHERE n.id = ? AND s.sekolah_id = ? AND mp.sekolah_id = ? AND n.sekolah_id = ?`,
      [id, req.sekolah_id, req.sekolah_id, req.sekolah_id]
    );

    if (nilaiCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Nilai tidak ditemukan atau tidak memiliki akses" });
    }

    await connection.execute("DELETE FROM nilai WHERE id = ?", [id]);
    await connection.end();

    console.log("Nilai berhasil dihapus:", id);
    res.json({ message: "Nilai berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE NILAI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus nilai" });
  }
});

// Get Nilai by ID
app.get("/api/nilai/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data nilai by ID:", id);

    const connection = await getConnection();
    const [nilai] = await connection.execute(
      `SELECT n.*, s.nama as siswa_nama, s.nis, mp.nama as mata_pelajaran_nama 
       FROM nilai n 
       JOIN siswa s ON n.siswa_id = s.id 
       JOIN mata_pelajaran mp ON n.mata_pelajaran_id = mp.id 
       WHERE n.id = ? AND s.sekolah_id = ? AND mp.sekolah_id = ? AND n.sekolah_id = ?`,
      [id, req.sekolah_id, req.sekolah_id, req.sekolah_id]
    );
    await connection.end();

    if (nilai.length === 0) {
      return res.status(404).json({ error: "Nilai tidak ditemukan" });
    }

    console.log("Berhasil mengambil data nilai:", id);
    res.json(nilai[0]);
  } catch (error) {
    console.error("ERROR GET NILAI BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data nilai" });
  }
});

// Get Bab by Mata Pelajaran
app.get("/api/bab-materi", authenticateToken, async (req, res) => {
  try {
    const { mata_pelajaran_id } = req.query;
    console.log("Mengambil data bab materi");

    let query = `
      SELECT bm.*, mp.nama as mata_pelajaran_nama
      FROM bab_materi bm
      JOIN mata_pelajaran mp ON bm.mata_pelajaran_id = mp.id
      WHERE 1=1
    `;
    let params = [];

    if (mata_pelajaran_id) {
      query += " AND bm.mata_pelajaran_id = ?";
      params.push(mata_pelajaran_id);
    }

    query += " ORDER BY bm.urutan";

    const connection = await getConnection();
    const [babMateri] = await connection.execute(query, params);
    await connection.end();

    console.log(
      "Berhasil mengambil data bab materi, jumlah:",
      babMateri.length
    );
    res.json(babMateri);
  } catch (error) {
    console.error("ERROR GET BAB MATERI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data bab materi" });
  }
});

// Get Sub Bab by Bab ID
app.get("/api/sub-bab-materi", authenticateToken, async (req, res) => {
  try {
    const { bab_id } = req.query;
    console.log("Mengambil data sub bab materi");

    if (!bab_id) {
      return res.status(400).json({ error: "Parameter bab_id diperlukan" });
    }

    const connection = await getConnection();
    const [subBabMateri] = await connection.execute(
      "SELECT sbm.*, bm.judul_bab FROM sub_bab_materi sbm JOIN bab_materi bm ON sbm.bab_id = bm.id WHERE sbm.bab_id = ? ORDER BY sbm.urutan",
      [bab_id]
    );
    await connection.end();

    console.log(
      "Berhasil mengambil data sub bab materi, jumlah:",
      subBabMateri.length
    );
    res.json(subBabMateri);
  } catch (error) {
    console.error("ERROR GET SUB BAB MATERI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data sub bab materi" });
  }
});

// Get Konten Materi by Sub Bab ID
app.get("/api/konten-materi", authenticateToken, async (req, res) => {
  try {
    const { sub_bab_id } = req.query;
    console.log("Mengambil data konten materi");

    if (!sub_bab_id) {
      return res.status(400).json({ error: "Parameter sub_bab_id diperlukan" });
    }

    const connection = await getConnection();
    const [kontenMateri] = await connection.execute(
      `SELECT km.*, sbm.judul_sub_bab, bm.judul_bab, mp.nama as mata_pelajaran_nama 
       FROM konten_materi km 
       JOIN sub_bab_materi sbm ON km.sub_bab_id = sbm.id 
       JOIN bab_materi bm ON sbm.bab_id = bm.id 
       JOIN mata_pelajaran mp ON bm.mata_pelajaran_id = mp.id 
       WHERE km.sub_bab_id = ? 
       ORDER BY km.created_at`,
      [sub_bab_id]
    );
    await connection.end();

    console.log(
      "Berhasil mengambil data konten materi, jumlah:",
      kontenMateri.length
    );
    res.json(kontenMateri);
  } catch (error) {
    console.error("ERROR GET KONTEN MATERI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data konten materi" });
  }
});

// ==================== MATERI PROGRESS ENDPOINTS ====================

// Get Materi Progress (checked state) for a teacher and subject
app.get("/api/materi-progress", authenticateToken, async (req, res) => {
  try {
    const { guru_id, mata_pelajaran_id } = req.query;
    console.log("Mengambil data progress materi");

    if (!guru_id || !mata_pelajaran_id) {
      return res.status(400).json({
        error: "Parameter guru_id dan mata_pelajaran_id diperlukan",
      });
    }

    const connection = await getConnection();
    const [progress] = await connection.execute(
      `SELECT * FROM materi_progress 
       WHERE guru_id = ? AND mata_pelajaran_id = ? AND is_checked = TRUE`,
      [guru_id, mata_pelajaran_id]
    );
    await connection.end();

    console.log(
      "Berhasil mengambil data progress materi, jumlah:",
      progress.length
    );
    res.json(progress);
  } catch (error) {
    console.error("ERROR GET MATERI PROGRESS:", error.message);
    res.status(500).json({ error: "Gagal mengambil data progress materi" });
  }
});

// Save or Update Materi Progress (toggle checked state)
app.post("/api/materi-progress", authenticateToken, async (req, res) => {
  try {
    console.log("Menyimpan progress materi:", req.body);
    const { guru_id, mata_pelajaran_id, bab_id, sub_bab_id, is_checked } =
      req.body;

    if (!guru_id || !mata_pelajaran_id) {
      return res.status(400).json({
        error: "Parameter guru_id dan mata_pelajaran_id diperlukan",
      });
    }

    // At least bab_id must be provided
    if (!bab_id) {
      return res.status(400).json({
        error: "Parameter bab_id diperlukan",
      });
    }

    const connection = await getConnection();

    // Check if record already exists
    const [existing] = await connection.execute(
      `SELECT * FROM materi_progress 
       WHERE guru_id = ? AND mata_pelajaran_id = ? 
       AND bab_id = ? AND (sub_bab_id = ? OR (sub_bab_id IS NULL AND ? IS NULL))`,
      [
        guru_id,
        mata_pelajaran_id,
        bab_id,
        sub_bab_id || null,
        sub_bab_id || null,
      ]
    );

    if (existing.length > 0) {
      // Update existing record
      // If unchecked (is_checked = false), also reset is_generated to false
      await connection.execute(
        `UPDATE materi_progress 
         SET is_checked = ?, is_generated = IF(? = FALSE, FALSE, is_generated), updated_at = CURRENT_TIMESTAMP 
         WHERE guru_id = ? AND mata_pelajaran_id = ? 
         AND bab_id = ? AND (sub_bab_id = ? OR (sub_bab_id IS NULL AND ? IS NULL))`,
        [
          is_checked,
          is_checked,
          guru_id,
          mata_pelajaran_id,
          bab_id,
          sub_bab_id || null,
          sub_bab_id || null,
        ]
      );
      console.log("Progress materi berhasil diupdate");
    } else {
      // Insert new record
      await connection.execute(
        `INSERT INTO materi_progress 
         (guru_id, mata_pelajaran_id, bab_id, sub_bab_id, is_checked, is_generated) 
         VALUES (?, ?, ?, ?, ?, FALSE)`,
        [guru_id, mata_pelajaran_id, bab_id, sub_bab_id || null, is_checked]
      );
      console.log("Progress materi berhasil ditambahkan");
    }

    await connection.end();
    res.json({
      message: "Progress materi berhasil disimpan",
      is_checked: is_checked,
    });
  } catch (error) {
    console.error("ERROR SAVE MATERI PROGRESS:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menyimpan progress materi" });
  }
});

// Batch save materi progress (for saving multiple checkboxes at once)
app.post("/api/materi-progress/batch", authenticateToken, async (req, res) => {
  try {
    console.log("Menyimpan batch progress materi:", req.body);
    const { guru_id, mata_pelajaran_id, progress_items } = req.body;

    if (
      !guru_id ||
      !mata_pelajaran_id ||
      !progress_items ||
      !Array.isArray(progress_items)
    ) {
      return res.status(400).json({
        error:
          "Parameter guru_id, mata_pelajaran_id, dan progress_items diperlukan",
      });
    }

    const connection = await getConnection();

    // Process each item
    for (const item of progress_items) {
      const { bab_id, sub_bab_id, is_checked } = item;

      if (!bab_id) continue; // Skip invalid items

      // Check if record exists
      const [existing] = await connection.execute(
        `SELECT * FROM materi_progress 
         WHERE guru_id = ? AND mata_pelajaran_id = ? 
         AND bab_id = ? AND (sub_bab_id = ? OR (sub_bab_id IS NULL AND ? IS NULL))`,
        [
          guru_id,
          mata_pelajaran_id,
          bab_id,
          sub_bab_id || null,
          sub_bab_id || null,
        ]
      );

      if (existing.length > 0) {
        // Update
        // If unchecked (is_checked = false), also reset is_generated to false
        await connection.execute(
          `UPDATE materi_progress 
           SET is_checked = ?, is_generated = IF(? = FALSE, FALSE, is_generated), updated_at = CURRENT_TIMESTAMP 
           WHERE guru_id = ? AND mata_pelajaran_id = ? 
           AND bab_id = ? AND (sub_bab_id = ? OR (sub_bab_id IS NULL AND ? IS NULL))`,
          [
            is_checked,
            is_checked,
            guru_id,
            mata_pelajaran_id,
            bab_id,
            sub_bab_id || null,
            sub_bab_id || null,
          ]
        );
      } else {
        // Insert
        await connection.execute(
          `INSERT INTO materi_progress 
           (guru_id, mata_pelajaran_id, bab_id, sub_bab_id, is_checked, is_generated) 
           VALUES (?, ?, ?, ?, ?, FALSE)`,
          [guru_id, mata_pelajaran_id, bab_id, sub_bab_id || null, is_checked]
        );
      }
    }

    await connection.end();
    console.log(
      `Batch progress materi berhasil disimpan, jumlah: ${progress_items.length}`
    );
    res.json({
      message: "Batch progress materi berhasil disimpan",
      count: progress_items.length,
    });
  } catch (error) {
    console.error("ERROR BATCH SAVE MATERI PROGRESS:", error.message);
    res.status(500).json({ error: "Gagal menyimpan batch progress materi" });
  }
});

// Mark materi as generated (when used for RPP/activity generation)
app.post(
  "/api/materi-progress/mark-generated",
  authenticateToken,
  async (req, res) => {
    try {
      console.log("Menandai materi sebagai sudah di-generate:", req.body);
      const { guru_id, mata_pelajaran_id, items } = req.body;

      if (!guru_id || !mata_pelajaran_id || !items || !Array.isArray(items)) {
        return res.status(400).json({
          error: "Parameter guru_id, mata_pelajaran_id, dan items diperlukan",
        });
      }

      const connection = await getConnection();

      // Mark each item as generated
      for (const item of items) {
        const { bab_id, sub_bab_id } = item;

        if (!bab_id) continue;

        // Update the is_generated flag
        await connection.execute(
          `UPDATE materi_progress 
         SET is_generated = TRUE, updated_at = CURRENT_TIMESTAMP 
         WHERE guru_id = ? AND mata_pelajaran_id = ? 
         AND bab_id = ? AND (sub_bab_id = ? OR (sub_bab_id IS NULL AND ? IS NULL))`,
          [
            guru_id,
            mata_pelajaran_id,
            bab_id,
            sub_bab_id || null,
            sub_bab_id || null,
          ]
        );
      }

      await connection.end();
      console.log(
        `Materi berhasil ditandai sebagai generated, jumlah: ${items.length}`
      );
      res.json({
        message: "Materi berhasil ditandai sebagai sudah di-generate",
        count: items.length,
      });
    } catch (error) {
      console.error("ERROR MARK GENERATED:", error.message);
      res
        .status(500)
        .json({ error: "Gagal menandai materi sebagai generated" });
    }
  }
);

// Reset generated status (to allow regeneration)
app.post(
  "/api/materi-progress/reset-generated",
  authenticateToken,
  async (req, res) => {
    try {
      console.log("Reset status generated materi:", req.body);
      const { guru_id, mata_pelajaran_id, items } = req.body;

      if (!guru_id || !mata_pelajaran_id || !items || !Array.isArray(items)) {
        return res.status(400).json({
          error: "Parameter guru_id, mata_pelajaran_id, dan items diperlukan",
        });
      }

      const connection = await getConnection();

      // Reset is_generated flag for each item
      for (const item of items) {
        const { bab_id, sub_bab_id } = item;

        if (!bab_id) continue;

        await connection.execute(
          `UPDATE materi_progress 
         SET is_generated = FALSE, updated_at = CURRENT_TIMESTAMP 
         WHERE guru_id = ? AND mata_pelajaran_id = ? 
         AND bab_id = ? AND (sub_bab_id = ? OR (sub_bab_id IS NULL AND ? IS NULL))`,
          [
            guru_id,
            mata_pelajaran_id,
            bab_id,
            sub_bab_id || null,
            sub_bab_id || null,
          ]
        );
      }

      await connection.end();
      console.log(
        `Status generated berhasil di-reset, jumlah: ${items.length}`
      );
      res.json({
        message: "Status generated berhasil di-reset",
        count: items.length,
      });
    } catch (error) {
      console.error("ERROR RESET GENERATED:", error.message);
      res.status(500).json({ error: "Gagal reset status generated" });
    }
  }
);

// ==================== END MATERI PROGRESS ENDPOINTS ====================

// Create Bab Materi
app.post("/api/bab-materi", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah bab materi baru:", req.body);
    const { mata_pelajaran_id, judul_bab, urutan } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO bab_materi (id, mata_pelajaran_id, judul_bab, urutan) VALUES (?, ?, ?, ?)",
      [id, mata_pelajaran_id, judul_bab, urutan]
    );
    await connection.end();

    console.log("Bab materi berhasil ditambahkan:", id);
    res.json({ message: "Bab materi berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST BAB MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah bab materi" });
  }
});

// Create Sub Bab Materi
app.post("/api/sub-bab-materi", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah sub bab materi baru:", req.body);
    const { bab_id, judul_sub_bab, urutan } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO sub_bab_materi (id, bab_id, judul_sub_bab, urutan) VALUES (?, ?, ?, ?)",
      [id, bab_id, judul_sub_bab, urutan]
    );
    await connection.end();

    console.log("Sub bab materi berhasil ditambahkan:", id);
    res.json({ message: "Sub bab materi berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST SUB BAB MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah sub bab materi" });
  }
});

// Create Konten Materi
app.post("/api/konten-materi", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah konten materi baru:", req.body);
    const { sub_bab_id, judul_konten, isi_konten } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO konten_materi (id, sub_bab_id, judul_konten, isi_konten) VALUES (?, ?, ?, ?)",
      [id, sub_bab_id, judul_konten, isi_konten]
    );
    await connection.end();

    console.log("Konten materi berhasil ditambahkan:", id);
    res.json({ message: "Konten materi berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST KONTEN MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah konten materi" });
  }
});

// Update Bab Materi
app.put("/api/bab-materi/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update bab materi:", id, req.body);
    const { judul_bab, urutan } = req.body;

    const connection = await getConnection();
    await connection.execute(
      "UPDATE bab_materi SET judul_bab = ?, urutan = ? WHERE id = ?",
      [judul_bab, urutan, id]
    );
    await connection.end();

    console.log("Bab materi berhasil diupdate:", id);
    res.json({ message: "Bab materi berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT BAB MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate bab materi" });
  }
});

// Update Sub Bab Materi
app.put("/api/sub-bab-materi/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update sub bab materi:", id, req.body);
    const { judul_sub_bab, urutan } = req.body;

    const connection = await getConnection();
    await connection.execute(
      "UPDATE sub_bab_materi SET judul_sub_bab = ?, urutan = ? WHERE id = ?",
      [judul_sub_bab, urutan, id]
    );
    await connection.end();

    console.log("Sub bab materi berhasil diupdate:", id);
    res.json({ message: "Sub bab materi berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT SUB BAB MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate sub bab materi" });
  }
});

// Update Konten Materi
app.put("/api/konten-materi/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update konten materi:", id, req.body);
    const { judul_konten, isi_konten } = req.body;

    const connection = await getConnection();
    await connection.execute(
      "UPDATE konten_materi SET judul_konten = ?, isi_konten = ? WHERE id = ?",
      [judul_konten, isi_konten, id]
    );
    await connection.end();

    console.log("Konten materi berhasil diupdate:", id);
    res.json({ message: "Konten materi berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT KONTEN MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate konten materi" });
  }
});

// Delete Bab Materi
app.delete("/api/bab-materi/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete bab materi:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM bab_materi WHERE id = ?", [id]);
    await connection.end();

    console.log("Bab materi berhasil dihapus:", id);
    res.json({ message: "Bab materi berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE BAB MATERI:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(400).json({
        error: "Bab materi tidak dapat dihapus karena masih memiliki sub bab",
      });
    }

    res.status(500).json({ error: "Gagal menghapus bab materi" });
  }
});

// Delete Sub Bab Materi
app.delete("/api/sub-bab-materi/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete sub bab materi:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM sub_bab_materi WHERE id = ?", [id]);
    await connection.end();

    console.log("Sub bab materi berhasil dihapus:", id);
    res.json({ message: "Sub bab materi berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE SUB BAB MATERI:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(400).json({
        error:
          "Sub bab materi tidak dapat dihapus karena masih memiliki konten",
      });
    }

    res.status(500).json({ error: "Gagal menghapus sub bab materi" });
  }
});

// Delete Konten Materi
app.delete("/api/konten-materi/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete konten materi:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM konten_materi WHERE id = ?", [id]);
    await connection.end();

    console.log("Konten materi berhasil dihapus:", id);
    res.json({ message: "Konten materi berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE KONTEN MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus konten materi" });
  }
});

// Kelola Materi
app.get("/api/materi", authenticateToken, async (req, res) => {
  try {
    const { guru_id, mata_pelajaran_id } = req.query;
    console.log("Mengambil data materi");

    let query = `
      SELECT m.*, u.nama as guru_nama, mp.nama as mata_pelajaran_nama
      FROM materi m
      JOIN users u ON m.guru_id = u.id
      JOIN mata_pelajaran mp ON m.mata_pelajaran_id = mp.id
      WHERE 1=1
    `;
    let params = [];

    if (guru_id) {
      query += " AND m.guru_id = ?";
      params.push(guru_id);
    }

    if (mata_pelajaran_id) {
      query += " AND m.mata_pelajaran_id = ?";
      params.push(mata_pelajaran_id);
    }

    const connection = await getConnection();
    const [materi] = await connection.execute(query, params);
    await connection.end();

    console.log("Berhasil mengambil data materi, jumlah:", materi.length);
    res.json(materi);
  } catch (error) {
    console.error("ERROR GET MATERI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data materi" });
  }
});

app.post("/api/materi", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah materi:", req.body);
    const { guru_id, mata_pelajaran_id, judul, deskripsi, file_path } =
      req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO materi (id, guru_id, mata_pelajaran_id, judul, deskripsi, file_path) VALUES (?, ?, ?, ?, ?, ?)",
      [id, guru_id, mata_pelajaran_id, judul, deskripsi, file_path]
    );
    await connection.end();

    console.log("Materi berhasil ditambahkan:", id);
    res.json({ message: "Materi berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah materi" });
  }
});

// Endpoint khusus untuk mata pelajaran by guru
app.get("/api/mata-pelajaran-by-guru", authenticateToken, async (req, res) => {
  try {
    const { guru_id } = req.query;
    console.log("Mengambil mata pelajaran untuk guru:", guru_id);

    if (!guru_id) {
      return res.status(400).json({ error: "Parameter guru_id diperlukan" });
    }

    const connection = await getConnection();

    // Query yang diperbaiki - pastikan kita mencari berdasarkan user_id
    const [result] = await connection.execute(
      `SELECT mp.* 
       FROM mata_pelajaran mp
       JOIN users u ON mp.id = u.mata_pelajaran_id
       WHERE u.id = ? AND u.sekolah_id = ?`,
      [guru_id, req.sekolah_id]
    );

    await connection.end();

    console.log("Mata pelajaran ditemukan:", result.length);
    res.json(result);
  } catch (error) {
    console.error("ERROR GET MATA PELAJARAN BY GURU:", error.message);
    res.status(500).json({ error: "Gagal mengambil mata pelajaran guru" });
  }
});

// Get all Mata Pelajaran with Kelas
app.get(
  "/api/mata-pelajaran-with-kelas",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log(
        "Mengambil mata pelajaran dengan data kelas untuk sekolah:",
        req.sekolah_id
      );

      const connection = await getConnection();

      const [mataPelajaran] = await connection.execute(
        `
        SELECT 
          mp.*,
          GROUP_CONCAT(DISTINCT k.nama) as kelas_names,
          GROUP_CONCAT(DISTINCT k.id) as kelas_ids,
          COUNT(DISTINCT k.id) as jumlah_kelas
        FROM mata_pelajaran mp
        LEFT JOIN mata_pelajaran_kelas mpk ON mp.id = mpk.mata_pelajaran_id
        LEFT JOIN kelas k ON mpk.kelas_id = k.id AND k.sekolah_id = ?
        WHERE mp.sekolah_id = ?
        GROUP BY mp.id
        ORDER BY mp.nama
      `,
        [req.sekolah_id, req.sekolah_id]
      );

      await connection.end();

      console.log(
        "Mata pelajaran dengan kelas ditemukan:",
        mataPelajaran.length
      );
      res.json(mataPelajaran);
    } catch (error) {
      console.error("ERROR GET MATA PELAJARAN WITH KELAS:", error.message);
      res
        .status(500)
        .json({ error: "Gagal mengambil data mata pelajaran dengan kelas" });
    }
  }
);

// Get Kelas by Mata Pelajaran
app.get(
  "/api/kelas-by-mata-pelajaran",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { mata_pelajaran_id } = req.query;
      console.log("Mengambil kelas untuk mata pelajaran:", mata_pelajaran_id);

      if (!mata_pelajaran_id) {
        return res
          .status(400)
          .json({ error: "Parameter mata_pelajaran_id diperlukan" });
      }

      const connection = await getConnection();

      // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
      const [mapelCheck] = await connection.execute(
        "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
        [mata_pelajaran_id, req.sekolah_id]
      );

      if (mapelCheck.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
        });
      }

      const [kelas] = await connection.execute(
        `SELECT k.* 
       FROM kelas k
       JOIN mata_pelajaran_kelas mpk ON k.id = mpk.kelas_id
       WHERE mpk.mata_pelajaran_id = ? AND k.sekolah_id = ?
       ORDER BY k.nama`,
        [mata_pelajaran_id, req.sekolah_id] // Tambahkan sekolah_id
      );

      await connection.end();

      console.log("Kelas ditemukan:", kelas.length);
      res.json(kelas);
    } catch (error) {
      console.error("ERROR GET KELAS BY MATA PELAJARAN:", error.message);
      res.status(500).json({ error: "Gagal mengambil data kelas" });
    }
  }
);

// Add Kelas to Mata Pelajaran
app.post(
  "/api/mata-pelajaran-kelas",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { mata_pelajaran_id, kelas_id } = req.body;
      console.log("Menambah kelas ke mata pelajaran:", {
        mata_pelajaran_id,
        kelas_id,
      });

      if (!mata_pelajaran_id || !kelas_id) {
        return res
          .status(400)
          .json({ error: "mata_pelajaran_id dan kelas_id diperlukan" });
      }

      const id = crypto.randomUUID();
      const connection = await getConnection();

      // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
      const [mapelCheck] = await connection.execute(
        "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
        [mata_pelajaran_id, req.sekolah_id]
      );

      if (mapelCheck.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
        });
      }

      // Cek apakah kelas termasuk dalam sekolah yang sama
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelas_id, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }

      // Check if relationship already exists
      const [existing] = await connection.execute(
        "SELECT * FROM mata_pelajaran_kelas WHERE mata_pelajaran_id = ? AND kelas_id = ?",
        [mata_pelajaran_id, kelas_id]
      );

      if (existing.length > 0) {
        await connection.end();
        return res
          .status(400)
          .json({ error: "Relasi mata pelajaran-kelas sudah ada" });
      }

      await connection.execute(
        "INSERT INTO mata_pelajaran_kelas (id, mata_pelajaran_id, kelas_id) VALUES (?, ?, ?)",
        [id, mata_pelajaran_id, kelas_id]
      );

      await connection.end();

      console.log("Relasi mata pelajaran-kelas berhasil ditambahkan:", id);
      res.json({ message: "Relasi berhasil ditambahkan", id });
    } catch (error) {
      console.error("ERROR ADD MATA PELAJARAN KELAS:", error.message);
      res
        .status(500)
        .json({ error: "Gagal menambah relasi mata pelajaran-kelas" });
    }
  }
);

// Remove Kelas from Mata Pelajaran
app.delete(
  "/api/mata-pelajaran-kelas",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { mata_pelajaran_id, kelas_id } = req.query;
      console.log("Menghapus kelas dari mata pelajaran:", {
        mata_pelajaran_id,
        kelas_id,
      });

      if (!mata_pelajaran_id || !kelas_id) {
        return res
          .status(400)
          .json({ error: "mata_pelajaran_id dan kelas_id diperlukan" });
      }

      const connection = await getConnection();

      // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
      const [mapelCheck] = await connection.execute(
        "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
        [mata_pelajaran_id, req.sekolah_id]
      );

      if (mapelCheck.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
        });
      }

      // Cek apakah kelas termasuk dalam sekolah yang sama
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelas_id, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }

      await connection.execute(
        "DELETE FROM mata_pelajaran_kelas WHERE mata_pelajaran_id = ? AND kelas_id = ?",
        [mata_pelajaran_id, kelas_id]
      );

      await connection.end();

      console.log("Relasi mata pelajaran-kelas berhasil dihapus");
      res.json({ message: "Relasi berhasil dihapus" });
    } catch (error) {
      console.error("ERROR REMOVE MATA PELAJARAN KELAS:", error.message);
      res
        .status(500)
        .json({ error: "Gagal menghapus relasi mata pelajaran-kelas" });
    }
  }
);

// Add mata pelajaran to guru
app.post(
  "/api/guru/:id/mata-pelajaran",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { mata_pelajaran_id } = req.body;

      console.log("Menambah mata pelajaran ke guru:", id, mata_pelajaran_id);

      const connection = await getConnection();

      // Cek apakah guru termasuk dalam sekolah yang sama
      const [guruCheck] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'guru' AND sekolah_id = ?",
        [id, req.sekolah_id]
      );

      if (guruCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
      }

      // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
      const [mapelCheck] = await connection.execute(
        "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
        [mata_pelajaran_id, req.sekolah_id]
      );

      if (mapelCheck.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
        });
      }

      // Check if relationship already exists
      const [existing] = await connection.execute(
        "SELECT * FROM guru_mata_pelajaran WHERE guru_id = ? AND mata_pelajaran_id = ?",
        [id, mata_pelajaran_id]
      );

      if (existing.length > 0) {
        await connection.end();
        return res
          .status(400)
          .json({ error: "Guru sudah memiliki mata pelajaran ini" });
      }

      const relationId = crypto.randomUUID();
      await connection.execute(
        "INSERT INTO guru_mata_pelajaran (id, guru_id, mata_pelajaran_id, sekolah_id) VALUES (?, ?, ?, ?)",
        [relationId, id, mata_pelajaran_id, req.sekolah_id]
      );

      await connection.end();

      console.log("Mata pelajaran berhasil ditambahkan ke guru");
      res.json({
        message: "Mata pelajaran berhasil ditambahkan",
        id: relationId,
      });
    } catch (error) {
      console.error("ERROR ADD MATA PELAJARAN TO GURU:", error.message);
      res.status(500).json({ error: "Gagal menambah mata pelajaran ke guru" });
    }
  }
);

// Get mata pelajaran by guru
app.get(
  "/api/guru/:id/mata-pelajaran",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log("Mengambil mata pelajaran untuk guru:", id);

      const connection = await getConnection();

      // Cek apakah guru termasuk dalam sekolah yang sama
      const [guruCheck] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'guru' AND sekolah_id = ?",
        [id, req.sekolah_id]
      );

      if (guruCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
      }

      // Build filter conditions
      const conditions = [
        "gmp.guru_id = ?",
        "mp.sekolah_id = ?",
      ];
      const params = [id, req.sekolah_id];

      const { page, limit, search, subject_ids } = req.query;

      if (search) {
        conditions.push(
          "(mp.nama LIKE ? OR mp.kode LIKE ? OR mp.deskripsi LIKE ?)"
        );
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (subject_ids) {
        const ids = subject_ids.split(",").map((id) => id.trim());
        if (ids.length > 0) {
          conditions.push(`mp.id IN (${ids.map(() => "?").join(",")})`);
          params.push(...ids);
        }
      }

      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      // Build pagination
      const { limitClause, currentPage, perPage } = buildPaginationQuery(
        page,
        limit
      );

      // Count total items
      const countQuery = `
        SELECT COUNT(*) as total
        FROM mata_pelajaran mp
        JOIN guru_mata_pelajaran gmp ON mp.id = gmp.mata_pelajaran_id
        ${whereClause}
      `;
      const [countResult] = await connection.execute(countQuery, params);
      const totalItems = countResult[0].total;

      // Get paginated data
      const dataQuery = `
        SELECT mp.* 
        FROM mata_pelajaran mp
        JOIN guru_mata_pelajaran gmp ON mp.id = gmp.mata_pelajaran_id
        ${whereClause}
        ORDER BY mp.nama ASC
        ${limitClause}
      `;
      const [mataPelajaran] = await connection.execute(dataQuery, params);

      await connection.end();

      // Calculate pagination metadata
      const pagination = calculatePaginationMeta(
        totalItems,
        currentPage,
        perPage
      );

      res.json({
        success: true,
        data: mataPelajaran,
        pagination,
      });


    } catch (error) {
      console.error("ERROR GET MATA PELAJARAN BY GURU:", error.message);
      res.status(500).json({ error: "Gagal mengambil mata pelajaran guru" });
    }
  }
);

// Remove mata pelajaran from guru
app.delete(
  "/api/guru/:guruId/mata-pelajaran/:mataPelajaranId",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { guruId, mataPelajaranId } = req.params;
      console.log(
        "Menghapus mata pelajaran dari guru:",
        guruId,
        mataPelajaranId
      );

      const connection = await getConnection();

      // Cek apakah guru termasuk dalam sekolah yang sama
      const [guruCheck] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'guru' AND sekolah_id = ?",
        [guruId, req.sekolah_id]
      );

      if (guruCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
      }

      // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
      const [mapelCheck] = await connection.execute(
        "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
        [mataPelajaranId, req.sekolah_id]
      );

      if (mapelCheck.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
        });
      }

      await connection.execute(
        "DELETE FROM guru_mata_pelajaran WHERE guru_id = ? AND mata_pelajaran_id = ?",
        [guruId, mataPelajaranId]
      );

      await connection.end();

      console.log("Mata pelajaran berhasil dihapus dari guru");
      res.json({ message: "Mata pelajaran berhasil dihapus" });
    } catch (error) {
      console.error("ERROR REMOVE MATA PELAJARAN FROM GURU:", error.message);
      res
        .status(500)
        .json({ error: "Gagal menghapus mata pelajaran dari guru" });
    }
  }
);

// Kelola Guru - Get all teachers with their subjects
app.get(
  "/api/guru-matapelajaran",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Mengambil data guru untuk sekolah:", req.sekolah_id);
      const connection = await getConnection();

      const [guru] = await connection.execute(
        `
      SELECT 
        u.*, 
        k.nama as kelas_nama,
        (SELECT COUNT(*) FROM kelas WHERE wali_kelas_id = u.id) as is_wali_kelas,
        GROUP_CONCAT(DISTINCT mp.nama) as mata_pelajaran_names,
        GROUP_CONCAT(DISTINCT mp.id) as mata_pelajaran_ids
      FROM users u 
      LEFT JOIN kelas k ON u.kelas_id = k.id AND k.sekolah_id = ?
      LEFT JOIN guru_mata_pelajaran gmp ON u.id = gmp.guru_id
      LEFT JOIN mata_pelajaran mp ON gmp.mata_pelajaran_id = mp.id AND mp.sekolah_id = ?
      WHERE u.role = 'guru' AND u.sekolah_id = ?
      GROUP BY u.id
    `,
        [req.sekolah_id, req.sekolah_id, req.sekolah_id]
      );

      await connection.end();

      console.log("Berhasil mengambil data guru, jumlah:", guru.length);
      res.json(guru);
    } catch (error) {
      console.error("ERROR GET GURU:", error.message);
      res.status(500).json({ error: "Gagal mengambil data guru" });
    }
  }
);

// Get all hari
app.get("/api/hari", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data hari");
    const connection = await getConnection();
    const [hari] = await connection.execute(
      "SELECT * FROM hari ORDER BY urutan"
    );
    await connection.end();
    console.log("Berhasil mengambil data hari, jumlah:", hari.length);
    res.json(hari);
  } catch (error) {
    console.error("ERROR GET HARI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data hari" });
  }
});

// Get all semester
app.get("/api/semester", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data semester");
    const connection = await getConnection();
    const [semester] = await connection.execute(
      "SELECT * FROM semester ORDER BY nama"
    );
    await connection.end();
    console.log("Berhasil mengambil data semester, jumlah:", semester.length);
    res.json(semester);
  } catch (error) {
    console.error("ERROR GET SEMESTER:", error.message);
    res.status(500).json({ error: "Gagal mengambil data semester" });
  }
});

// Get all jam pelajaran
app.get("/api/jam-pelajaran", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data jam pelajaran");
    const connection = await getConnection();
    const [jamPelajaran] = await connection.execute(
      "SELECT * FROM jam_pelajaran ORDER BY jam_ke"
    );
    await connection.end();
    console.log(
      "Berhasil mengambil data jam pelajaran, jumlah:",
      jamPelajaran.length
    );
    res.json(jamPelajaran);
  } catch (error) {
    console.error("ERROR GET JAM PELAJARAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data jam pelajaran" });
  }
});

// Create jam pelajaran
app.post("/api/jam-pelajaran", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah jam pelajaran baru:", req.body);
    const { jam_ke, jam_mulai, jam_selesai } = req.body;
    const id = crypto.randomUUID();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO jam_pelajaran (id, jam_ke, jam_mulai, jam_selesai) VALUES (?, ?, ?, ?)",
      [id, jam_ke, jam_mulai, jam_selesai]
    );
    await connection.end();

    console.log("Jam pelajaran berhasil ditambahkan:", id);
    res.json({ message: "Jam pelajaran berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST JAM PELAJARAN:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah jam pelajaran" });
  }
});

// Get Jadwal Mengajar (WITH PAGINATION & FILTER)
app.get(
  "/api/jadwal-mengajar",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const {
        page,
        limit,
        guru_id,
        kelas_id,
        hari_id,
        semester_id,
        tahun_ajaran,
        search,
      } = req.query;

      console.log("Mengambil data jadwal mengajar dengan filter:", {
        guru_id,
        kelas_id,
        hari_id,
        semester_id,
        tahun_ajaran,
        search,
      });
      console.log("Pagination:", { page, limit });

      const connection = await getConnection();

      // Build filter conditions
      const conditions = ["jm.sekolah_id = ?"];
      const params = [req.sekolah_id];

      if (guru_id) {
        conditions.push("jm.guru_id = ?");
        params.push(guru_id);
      }
      if (kelas_id) {
        conditions.push("jm.kelas_id = ?");
        params.push(kelas_id);
      }
      if (hari_id) {
        conditions.push("jm.hari_id = ?");
        params.push(hari_id);
      }
      if (semester_id) {
        conditions.push("jm.semester_id = ?");
        params.push(semester_id);
      }
      if (tahun_ajaran) {
        conditions.push("jm.tahun_ajaran = ?");
        params.push(tahun_ajaran);
      }
      if (search) {
        conditions.push("(u.nama LIKE ? OR mp.nama LIKE ? OR k.nama LIKE ?)");
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // Build pagination
      const { limitClause, currentPage, perPage } = buildPaginationQuery(
        page,
        limit
      );

      // Count total items
      const countQuery = `
        SELECT COUNT(*) as total
        FROM jadwal_mengajar jm
        JOIN users u ON jm.guru_id = u.id AND u.sekolah_id = ?
        JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id AND mp.sekolah_id = ?
        JOIN kelas k ON jm.kelas_id = k.id AND k.sekolah_id = ?
        ${whereClause}
      `;
      const countParams = [
        req.sekolah_id,
        req.sekolah_id,
        req.sekolah_id,
        ...params,
      ];
      const [countResult] = await connection.execute(countQuery, countParams);
      const totalItems = countResult[0].total;

      // Get paginated data
      const dataQuery = `
        SELECT jm.*, 
          u.nama as guru_nama,
          mp.nama as mata_pelajaran_nama,
          k.nama as kelas_nama,
          h.nama as hari_nama,
          s.nama as semester_nama,
          jp.jam_ke,
          jp.jam_mulai,
          jp.jam_selesai
        FROM jadwal_mengajar jm
        JOIN users u ON jm.guru_id = u.id AND u.sekolah_id = ?
        JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id AND mp.sekolah_id = ?
        JOIN kelas k ON jm.kelas_id = k.id AND k.sekolah_id = ?
        JOIN hari h ON jm.hari_id = h.id
        JOIN semester s ON jm.semester_id = s.id
        JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
        ${whereClause}
        ORDER BY h.urutan, jp.jam_ke
        ${limitClause}
      `;
      const dataParams = [
        req.sekolah_id,
        req.sekolah_id,
        req.sekolah_id,
        ...params,
      ];
      const [jadwal] = await connection.execute(dataQuery, dataParams);

      await connection.end();

      // Calculate pagination metadata
      const pagination = calculatePaginationMeta(
        totalItems,
        currentPage,
        perPage
      );

      console.log(
        `✅ Data jadwal mengajar: ${jadwal.length} items (Total: ${totalItems})`
      );

      res.json({
        success: true,
        data: jadwal,
        pagination,
      });
    } catch (error) {
      console.error("ERROR GET JADWAL MENGAJAR:", error.message);
      res.status(500).json({ error: "Gagal mengambil data jadwal mengajar" });
    }
  }
);

// Get Filter Options for Jadwal Mengajar
app.get(
  "/api/jadwal-mengajar/filter-options",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Mengambil filter options untuk jadwal mengajar");
      const connection = await getConnection();

      // Get available teachers
      const [teachers] = await connection.execute(
        `SELECT id, nama 
       FROM users 
       WHERE role = 'guru' AND sekolah_id = ? 
       ORDER BY nama ASC`,
        [req.sekolah_id]
      );

      // Get available classes
      const [classes] = await connection.execute(
        `SELECT id, nama, grade_level 
       FROM kelas 
       WHERE sekolah_id = ? 
       ORDER BY grade_level ASC, nama ASC`,
        [req.sekolah_id]
      );

      // Get available days
      const [days] = await connection.execute(
        `SELECT id, nama, urutan 
       FROM hari 
       ORDER BY urutan ASC`
      );

      // Get available semesters
      const [semesters] = await connection.execute(
        `SELECT id, nama 
       FROM semester 
       ORDER BY id ASC`
      );

      await connection.end();

      res.json({
        success: true,
        data: {
          teachers: teachers,
          classes: classes,
          days: days,
          semesters: semesters,
        },
      });

      console.log("✅ Filter options berhasil diambil");
    } catch (error) {
      console.error("ERROR GET FILTER OPTIONS:", error.message);
      res.status(500).json({ error: "Gagal mengambil filter options" });
    }
  }
);

// Fungsi untuk membaca Excel jadwal mengajar dari buffer
async function readExcelSchedulesFromBuffer(buffer) {
  const XLSX = require("xlsx");

  // Baca workbook langsung dari buffer
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Konversi ke JSON
  const data = XLSX.utils.sheet_to_json(worksheet);

  console.log("Raw Excel schedule data from buffer:", data);

  const schedules = [];

  data.forEach((row, index) => {
    try {
      // Mapping kolom dengan berbagai kemungkinan nama
      const scheduleData = mapExcelRowToSchedule(row, index + 2);
      if (scheduleData) {
        schedules.push(scheduleData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${schedules.length} schedules from Excel buffer`);
  return schedules;
}

// Fungsi mapping row untuk jadwal mengajar
function mapExcelRowToSchedule(row, rowNumber) {
  // Normalize keys to lowercase for case-insensitive matching
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing schedule row ${rowNumber}:`, normalizedRow);

  // Mapping berbagai kemungkinan nama kolom
  const guruNama =
    normalizedRow["guru_nama"] ||
    normalizedRow["nama guru"] ||
    normalizedRow["guru"] ||
    normalizedRow["teacher"] ||
    normalizedRow["teacher name"] ||
    "";

  const mataPelajaranNama =
    normalizedRow["mata_pelajaran_nama"] ||
    normalizedRow["mata pelajaran"] ||
    normalizedRow["pelajaran"] ||
    normalizedRow["subject"] ||
    normalizedRow["subject name"] ||
    "";

  const kelasNama =
    normalizedRow["kelas_nama"] ||
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    normalizedRow["nama kelas"] ||
    normalizedRow["class name"] ||
    "";

  const hariNama =
    normalizedRow["hari_nama"] ||
    normalizedRow["hari"] ||
    normalizedRow["day"] ||
    normalizedRow["nama hari"] ||
    "";

  const jamKe =
    normalizedRow["jam ke"] ||
    normalizedRow["jam"] ||
    normalizedRow["period"] ||
    normalizedRow["jam pelajaran"] ||
    "";

  const semesterNama =
    normalizedRow["semester_nama"] ||
    normalizedRow["semester"] ||
    normalizedRow["semester name"] ||
    "";

  const tahunAjaran =
    normalizedRow["tahun_ajaran"] ||
    normalizedRow["tahun ajaran"] ||
    normalizedRow["academic year"] ||
    normalizedRow["tahun"] ||
    "";

  // Jika data required tidak ada, skip
  if (
    !guruNama ||
    !mataPelajaranNama ||
    !kelasNama ||
    !hariNama ||
    !jamKe ||
    !semesterNama ||
    !tahunAjaran
  ) {
    console.log(`Skipping schedule row ${rowNumber}: Missing required data`, {
      guruNama,
      mataPelajaranNama,
      kelasNama,
      hariNama,
      jamKe,
      semesterNama,
      tahunAjaran,
    });
    return null;
  }

  const schedule = {
    guru_nama: guruNama.toString().trim(),
    mata_pelajaran_nama: mataPelajaranNama.toString().trim(),
    kelas_nama: kelasNama.toString().trim(),
    hari_nama: hariNama.toString().trim(),
    jam_ke: jamKe.toString().trim(),
    semester_nama: semesterNama.toString().trim(),
    tahun_ajaran: tahunAjaran.toString().trim(),
    row_number: rowNumber,
  };

  console.log(`Mapped schedule data for row ${rowNumber}:`, schedule);
  return schedule;
}

// Fungsi processScheduleImport
async function processScheduleImport(
  importedSchedules,
  teacherList,
  subjectList,
  classList,
  dayList,
  semesterList,
  periodList
) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const scheduleData of importedSchedules) {
      try {
        // Validasi data required
        if (
          !scheduleData.guru_nama ||
          !scheduleData.mata_pelajaran_nama ||
          !scheduleData.kelas_nama ||
          !scheduleData.hari_nama ||
          !scheduleData.jam_ke ||
          !scheduleData.semester_nama ||
          !scheduleData.tahun_ajaran
        ) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        // Cari guru berdasarkan nama
        const teacherItem = teacherList.find(
          (teacher) =>
            teacher.nama.toLowerCase() === scheduleData.guru_nama.toLowerCase()
        );

        if (!teacherItem) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Guru '${scheduleData.guru_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cari mata pelajaran berdasarkan nama
        const subjectItem = subjectList.find(
          (subject) =>
            subject.nama.toLowerCase() ===
            scheduleData.mata_pelajaran_nama.toLowerCase()
        );

        if (!subjectItem) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Mata pelajaran '${scheduleData.mata_pelajaran_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cari kelas berdasarkan nama
        const classItem = classList.find(
          (cls) =>
            cls.nama.toLowerCase() === scheduleData.kelas_nama.toLowerCase()
        );

        if (!classItem) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Kelas '${scheduleData.kelas_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cari hari berdasarkan nama
        const dayItem = dayList.find(
          (day) =>
            day.nama.toLowerCase() === scheduleData.hari_nama.toLowerCase()
        );

        if (!dayItem) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Hari '${scheduleData.hari_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cari semester berdasarkan nama
        const semesterItem = semesterList.find(
          (semester) =>
            semester.nama
              .toLowerCase()
              .includes(scheduleData.semester_nama.toLowerCase()) ||
            scheduleData.semester_nama
              .toLowerCase()
              .includes(semester.nama.toLowerCase())
        );

        if (!semesterItem) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Semester '${scheduleData.semester_nama}' tidak ditemukan`
          );
          continue;
        }

        // Cari jam pelajaran berdasarkan jam_ke
        const periodItem = periodList.find(
          (period) =>
            period.jam_ke.toString() === scheduleData.jam_ke.toString()
        );

        if (!periodItem) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Jam ke-${scheduleData.jam_ke} tidak ditemukan`
          );
          continue;
        }

        // Cek apakah jadwal sudah ada (untuk menghindari duplikasi)
        const [existingSchedule] = await connection.execute(
          `SELECT id FROM jadwal_mengajar 
           WHERE guru_id = ? AND mata_pelajaran_id = ? AND kelas_id = ? 
           AND hari_id = ? AND jam_pelajaran_id = ? AND semester_id = ? AND tahun_ajaran = ?`,
          [
            teacherItem.id,
            subjectItem.id,
            classItem.id,
            dayItem.id,
            periodItem.id,
            semesterItem.id,
            scheduleData.tahun_ajaran,
          ]
        );

        if (existingSchedule.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Jadwal sudah ada untuk kombinasi ini`
          );
          continue;
        }

        // Cek konflik jadwal - guru
        const [teacherConflict] = await connection.execute(
          `SELECT id FROM jadwal_mengajar 
           WHERE guru_id = ? AND hari_id = ? AND jam_pelajaran_id = ? 
           AND semester_id = ? AND tahun_ajaran = ?`,
          [
            teacherItem.id,
            dayItem.id,
            periodItem.id,
            semesterItem.id,
            scheduleData.tahun_ajaran,
          ]
        );

        if (teacherConflict.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Guru sudah memiliki jadwal lain di jam yang sama`
          );
          continue;
        }

        // Cek konflik jadwal - kelas
        const [classConflict] = await connection.execute(
          `SELECT id FROM jadwal_mengajar 
           WHERE kelas_id = ? AND hari_id = ? AND jam_pelajaran_id = ? 
           AND semester_id = ? AND tahun_ajaran = ?`,
          [
            classItem.id,
            dayItem.id,
            periodItem.id,
            semesterItem.id,
            scheduleData.tahun_ajaran,
          ]
        );

        if (classConflict.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${scheduleData.row_number}: Kelas sudah memiliki jadwal lain di jam yang sama`
          );
          continue;
        }

        // Mulai transaction untuk jadwal ini
        await connection.beginTransaction();

        try {
          const scheduleId = crypto.randomUUID();

          // Insert jadwal mengajar
          await connection.execute(
            `INSERT INTO jadwal_mengajar 
             (id, guru_id, mata_pelajaran_id, kelas_id, hari_id, jam_pelajaran_id, semester_id, tahun_ajaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              scheduleId,
              teacherItem.id,
              subjectItem.id,
              classItem.id,
              dayItem.id,
              periodItem.id,
              semesterItem.id,
              scheduleData.tahun_ajaran,
            ]
          );

          // Commit transaction
          await connection.commit();
          results.success++;
        } catch (transactionError) {
          // Rollback jika ada error
          await connection.rollback();
          throw transactionError;
        }
      } catch (scheduleError) {
        results.failed++;
        results.errors.push(
          `Baris ${scheduleData.row_number}: ${scheduleError.message}`
        );
        console.error(
          `Error importing schedule for ${scheduleData.guru_nama}:`,
          scheduleError.message
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

app.post("/api/export-schedules", async (req, res) => {
  try {
    const { schedules } = req.body;

    if (!schedules || !Array.isArray(schedules)) {
      return res.status(400).json({
        success: false,
        message: "Data jadwal tidak valid",
      });
    }

    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for Excel
    const excelData = [
      // Header row
      [
        "Guru",
        "Mata Pelajaran",
        "Kelas",
        "Hari",
        "Jam Ke",
        "Semester",
        "Tahun Ajaran",
        "Jam Mulai",
        "Jam Selesai",
      ],
      // Data rows
      ...schedules.map((schedule) => [
        schedule.guru_nama || "",
        schedule.mata_pelajaran_nama || "",
        schedule.kelas_nama || "",
        schedule.hari_nama || "",
        schedule.jam_ke?.toString() || "",
        schedule.semester_nama || "",
        schedule.tahun_ajaran || "",
        schedule.jam_mulai || "",
        schedule.jam_selesai || "",
      ]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Add style to header row
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    for (let i = 0; i < 9; i++) {
      worksheet["!cols"][i] = { width: 15 };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data Jadwal Mengajar");

    // Generate filename
    const filename = `Data_Jadwal_Mengajar_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading file:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh file",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengexport data: ${error.message}`,
    });
  }
});

// Download template Excel untuk jadwal mengajar
app.get("/api/download-template-schedule", async (req, res) => {
  try {
    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare template data
    const templateData = [
      // Header row
      [
        "Guru",
        "Mata Pelajaran",
        "Kelas",
        "Hari",
        "Jam Ke",
        "Semester",
        "Tahun Ajaran",
      ],
      // Example data
      [
        "Budi Santoso",
        "Ilmu Pengetahuan Alam 7",
        "7A",
        "Senin",
        "1",
        "Ganjil",
        "2024/2025",
      ],
      ["Sari Dewi", "Matematika 7", "7B", "Selasa", "2", "Ganjil", "2024/2025"],
      // Empty row
      [],
      // Notes
      ["Catatan:"],
      ["* Wajib diisi"],
      [
        "- Pastikan nama guru, mata pelajaran, kelas, dan hari sesuai dengan data yang ada di sistem",
      ],
      ["- Jam ke harus sesuai dengan data jam pelajaran yang tersedia (1-10)"],
      ["- Format tahun ajaran: YYYY/YYYY (contoh: 2024/2025)"],
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);

    // Set column widths
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    for (let i = 0; i < 7; i++) {
      worksheet["!cols"][i] = { width: 20 };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Template Jadwal Mengajar"
    );

    // Generate filename
    const filename = "Template_Import_Jadwal_Mengajar.xlsx";
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading template:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh template",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Template download error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengunduh template: ${error.message}`,
    });
  }
});

// Validasi data jadwal sebelum import
app.post("/validate-schedules", async (req, res) => {
  try {
    const { schedules } = req.body;

    if (!schedules || !Array.isArray(schedules)) {
      return res.status(400).json({
        success: false,
        message: "Data jadwal tidak valid",
      });
    }

    const validatedData = [];
    const errors = [];

    for (let i = 0; i < schedules.length; i++) {
      const schedule = schedules[i];
      const validatedSchedule = {};
      let hasError = false;

      // Validasi field required
      if (!schedule.guru_nama || schedule.guru_nama.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: Nama guru tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.guru_nama = schedule.guru_nama;
      }

      if (
        !schedule.mata_pelajaran_nama ||
        schedule.mata_pelajaran_nama.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Nama mata pelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.mata_pelajaran_nama = schedule.mata_pelajaran_nama;
      }

      if (
        !schedule.kelas_nama ||
        schedule.kelas_nama.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Nama kelas tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.kelas_nama = schedule.kelas_nama;
      }

      if (!schedule.hari_nama || schedule.hari_nama.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: Hari tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.hari_nama = schedule.hari_nama;
      }

      if (schedule.jam_ke === null || schedule.jam_ke === undefined) {
        errors.push(`Baris ${i + 1}: Jam ke tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.jam_ke = schedule.jam_ke;
      }

      if (
        !schedule.semester_nama ||
        schedule.semester_nama.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Semester tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.semester_nama = schedule.semester_nama;
      }

      if (
        !schedule.tahun_ajaran ||
        schedule.tahun_ajaran.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Tahun ajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedSchedule.tahun_ajaran = schedule.tahun_ajaran;
      }

      // Field optional
      validatedSchedule.jam_mulai = schedule.jam_mulai;
      validatedSchedule.jam_selesai = schedule.jam_selesai;

      if (!hasError) {
        validatedData.push(validatedSchedule);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validasi data gagal",
        errors: errors,
        validatedData: validatedData,
      });
    }

    res.json({
      success: true,
      message: "Validasi data berhasil",
      validatedData: validatedData,
    });
  } catch (error) {
    console.error("Validation error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal validasi data: ${error.message}`,
    });
  }
});

// Import jadwal mengajar dari Excel
app.post(
  "/api/jadwal-mengajar/import",
  authenticateToken,
  excelUploadMiddleware,
  async (req, res) => {
    let connection;
    try {
      console.log("Import jadwal mengajar dari Excel (memory storage)");

      if (!req.file) {
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received in memory:", {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        bufferLength: req.file.buffer.length,
      });

      // Baca file Excel langsung dari buffer
      const importedSchedules = await readExcelSchedulesFromBuffer(
        req.file.buffer
      );

      if (importedSchedules.length === 0) {
        return res.status(400).json({
          error:
            "Tidak ada data jadwal mengajar yang valid ditemukan dalam file",
        });
      }

      console.log(`Found ${importedSchedules.length} schedules to import`);

      // Ambil data referensi untuk mapping
      connection = await getConnection();

      const [teacherList] = await connection.execute(
        "SELECT id, nama FROM users WHERE role = 'guru'"
      );

      const [subjectList] = await connection.execute(
        "SELECT id, nama FROM mata_pelajaran"
      );

      const [classList] = await connection.execute(
        "SELECT id, nama FROM kelas"
      );

      const [dayList] = await connection.execute("SELECT id, nama FROM hari");

      const [semesterList] = await connection.execute(
        "SELECT id, nama FROM semester"
      );

      const [periodList] = await connection.execute(
        "SELECT id, jam_ke FROM jam_pelajaran"
      );

      await connection.end();

      // Proses import
      const result = await processScheduleImport(
        importedSchedules,
        teacherList,
        subjectList,
        classList,
        dayList,
        semesterList,
        periodList
      );

      console.log("Import completed:", result);
      res.json({
        message: "Import selesai",
        ...result,
      });
    } catch (error) {
      if (connection) {
        await connection.end();
      }

      console.error("ERROR IMPORT JADWAL MENGAJAR:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengimport jadwal mengajar: " + error.message,
      });
    }
  }
);

// Update Create Jadwal Mengajar dengan validasi bentrokan
app.post(
  "/api/jadwal-mengajar",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Menambah jadwal mengajar baru:", req.body);
      const {
        guru_id,
        mata_pelajaran_id,
        kelas_id,
        hari_id,
        jam_pelajaran_id,
        semester_id,
        tahun_ajaran,
      } = req.body;

      const id = crypto.randomUUID();
      const connection = await getConnection();

      // Cek apakah guru termasuk dalam sekolah yang sama
      const [guruCheck] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'guru' AND sekolah_id = ?",
        [guru_id, req.sekolah_id]
      );

      if (guruCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
      }

      // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
      const [mapelCheck] = await connection.execute(
        "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
        [mata_pelajaran_id, req.sekolah_id]
      );

      if (mapelCheck.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
        });
      }

      // Cek apakah kelas termasuk dalam sekolah yang sama
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelas_id, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }

      // Cek konflik jadwal - guru, hari, semester, jam_pelajaran yang sama
      const [konflikGuru] = await connection.execute(
        `SELECT jm.*, u.nama as guru_nama, jp.jam_ke 
       FROM jadwal_mengajar jm
       JOIN users u ON jm.guru_id = u.id
       JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
       WHERE jm.guru_id = ? AND jm.hari_id = ? AND jm.semester_id = ? AND jm.tahun_ajaran = ? AND jm.jam_pelajaran_id = ? AND jm.sekolah_id = ?`,
        [
          guru_id,
          hari_id,
          semester_id,
          tahun_ajaran,
          jam_pelajaran_id,
          req.sekolah_id,
        ]
      );

      if (konflikGuru.length > 0) {
        await connection.end();
        return res.status(400).json({
          error: `Guru sudah memiliki jadwal di jam ke-${konflikGuru[0].jam_ke} pada hari yang sama`,
        });
      }

      // Cek konflik jadwal - kelas, hari, semester, jam_pelajaran yang sama
      const [konflikKelas] = await connection.execute(
        `SELECT jm.*, k.nama as kelas_nama, jp.jam_ke 
       FROM jadwal_mengajar jm
       JOIN kelas k ON jm.kelas_id = k.id
       JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
       WHERE jm.kelas_id = ? AND jm.hari_id = ? AND jm.semester_id = ? AND jm.tahun_ajaran = ? AND jm.jam_pelajaran_id = ?`,
        [kelas_id, hari_id, semester_id, tahun_ajaran, jam_pelajaran_id]
      );

      if (konflikKelas.length > 0) {
        await connection.end();
        return res.status(400).json({
          error: `Kelas sudah memiliki jadwal di jam ke-${konflikKelas[0].jam_ke} pada hari yang sama`,
        });
      }

      await connection.execute(
        "INSERT INTO jadwal_mengajar (id, guru_id, mata_pelajaran_id, kelas_id, hari_id, jam_pelajaran_id, semester_id, tahun_ajaran, sekolah_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          guru_id,
          mata_pelajaran_id,
          kelas_id,
          hari_id,
          jam_pelajaran_id,
          semester_id,
          tahun_ajaran,
          req.sekolah_id, // Tambahkan sekolah_id
        ]
      );

      await connection.end();

      console.log("Jadwal mengajar berhasil ditambahkan:", id);
      res.json({ message: "Jadwal mengajar berhasil ditambahkan", id });
    } catch (error) {
      console.error("ERROR POST JADWAL MENGAJAR:", error.message);
      console.error("SQL Error code:", error.code);
      res.status(500).json({ error: "Gagal menambah jadwal mengajar" });
    }
  }
);

// Update Jadwal Mengajar dengan validasi bentrokan
app.put(
  "/api/jadwal-mengajar/:id",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log("Update jadwal mengajar:", id, req.body);
      const {
        guru_id,
        mata_pelajaran_id,
        kelas_id,
        hari_id,
        jam_pelajaran_id,
        semester_id,
        tahun_ajaran,
      } = req.body;

      const connection = await getConnection();

      // Cek apakah jadwal termasuk dalam sekolah yang sama
      const [jadwalCheck] = await connection.execute(
        "SELECT id FROM jadwal_mengajar WHERE id = ? AND sekolah_id = ?",
        [id, req.sekolah_id]
      );

      if (jadwalCheck.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Jadwal mengajar tidak ditemukan atau tidak memiliki akses",
        });
      }

      // Cek apakah guru termasuk dalam sekolah yang sama
      const [guruCheck] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'guru' AND sekolah_id = ?",
        [guru_id, req.sekolah_id]
      );

      if (guruCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
      }

      // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
      const [mapelCheck] = await connection.execute(
        "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
        [mata_pelajaran_id, req.sekolah_id]
      );

      if (mapelCheck.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
        });
      }

      // Cek apakah kelas termasuk dalam sekolah yang sama
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelas_id, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }

      // Cek konflik jadwal - guru (kecuali dengan dirinya sendiri)
      const [konflikGuru] = await connection.execute(
        `SELECT jm.*, u.nama as guru_nama, jp.jam_ke 
       FROM jadwal_mengajar jm
       JOIN users u ON jm.guru_id = u.id
       JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
       WHERE jm.id != ? AND jm.guru_id = ? AND jm.hari_id = ? AND jm.semester_id = ? AND jm.tahun_ajaran = ? AND jm.jam_pelajaran_id = ?`,
        [id, guru_id, hari_id, semester_id, tahun_ajaran, jam_pelajaran_id]
      );

      if (konflikGuru.length > 0) {
        await connection.end();
        return res.status(400).json({
          error: `Guru sudah memiliki jadwal di jam ke-${konflikGuru[0].jam_ke} pada hari yang sama`,
        });
      }

      // Cek konflik jadwal - kelas (kecuali dengan dirinya sendiri)
      const [konflikKelas] = await connection.execute(
        `SELECT jm.*, k.nama as kelas_nama, jp.jam_ke 
       FROM jadwal_mengajar jm
       JOIN kelas k ON jm.kelas_id = k.id
       JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
       WHERE jm.id != ? AND jm.kelas_id = ? AND jm.hari_id = ? AND jm.semester_id = ? AND jm.tahun_ajaran = ? AND jm.jam_pelajaran_id = ?`,
        [id, kelas_id, hari_id, semester_id, tahun_ajaran, jam_pelajaran_id]
      );

      if (konflikKelas.length > 0) {
        await connection.end();
        return res.status(400).json({
          error: `Kelas sudah memiliki jadwal di jam ke-${konflikKelas[0].jam_ke} pada hari yang sama`,
        });
      }

      await connection.execute(
        "UPDATE jadwal_mengajar SET guru_id = ?, mata_pelajaran_id = ?, kelas_id = ?, hari_id = ?, jam_pelajaran_id = ?, semester_id = ?, tahun_ajaran = ? WHERE id = ? AND sekolah_id = ?",
        [
          guru_id,
          mata_pelajaran_id,
          kelas_id,
          hari_id,
          jam_pelajaran_id,
          semester_id,
          tahun_ajaran,
          id,
          req.sekolah_id, // Tambahkan sekolah_id di WHERE
        ]
      );

      await connection.end();

      console.log("Jadwal mengajar berhasil diupdate:", id);
      res.json({ message: "Jadwal mengajar berhasil diupdate" });
    } catch (error) {
      console.error("ERROR PUT JADWAL MENGAJAR:", error.message);
      console.error("SQL Error code:", error.code);
      res.status(500).json({ error: "Gagal mengupdate jadwal mengajar" });
    }
  }
);

// Delete Jadwal Mengajar
app.delete(
  "/api/jadwal-mengajar/:id",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log("Delete jadwal mengajar:", id);

      const connection = await getConnection();

      // Cek apakah jadwal termasuk dalam sekolah yang sama
      const [jadwalCheck] = await connection.execute(
        "SELECT id FROM jadwal_mengajar WHERE id = ? AND sekolah_id = ?",
        [id, req.sekolah_id]
      );

      if (jadwalCheck.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Jadwal mengajar tidak ditemukan atau tidak memiliki akses",
        });
      }

      await connection.execute(
        "DELETE FROM jadwal_mengajar WHERE id = ? AND sekolah_id = ?",
        [id, req.sekolah_id]
      );
      await connection.end();

      console.log("Jadwal mengajar berhasil dihapus:", id);
      res.json({ message: "Jadwal mengajar berhasil dihapus" });
    } catch (error) {
      console.error("ERROR DELETE JADWAL MENGAJAR:", error.message);
      console.error("SQL Error code:", error.code);
      res.status(500).json({ error: "Gagal menghapus jadwal mengajar" });
    }
  }
);

// Endpoint untuk mendeteksi jadwal yang bentrok
app.get(
  "/api/jadwal-mengajar/conflicts",
  authenticateToken,
  async (req, res) => {
    try {
      const {
        hari_id,
        kelas_id,
        semester_id,
        tahun_ajaran,
        jam_pelajaran_id,
        exclude_id,
      } = req.query;

      console.log("Mengecek jadwal bentrok:", req.query);

      if (
        !hari_id ||
        !kelas_id ||
        !semester_id ||
        !tahun_ajaran ||
        !jam_pelajaran_id
      ) {
        return res.status(400).json({ error: "Parameter tidak lengkap" });
      }

      let query = `
      SELECT jm.*, 
        u.nama as guru_nama,
        mp.nama as mata_pelajaran_nama,
        k.nama as kelas_nama,
        h.nama as hari_nama,
        jp.jam_ke,
        jp.jam_mulai,
        jp.jam_selesai
      FROM jadwal_mengajar jm
      JOIN users u ON jm.guru_id = u.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id
      JOIN kelas k ON jm.kelas_id = k.id
      JOIN hari h ON jm.hari_id = h.id
      JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
      WHERE jm.hari_id = ? 
        AND jm.kelas_id = ? 
        AND jm.semester_id = ? 
        AND jm.tahun_ajaran = ? 
        AND jm.jam_pelajaran_id = ?
    `;

      let params = [
        hari_id,
        kelas_id,
        semester_id,
        tahun_ajaran,
        jam_pelajaran_id,
      ];

      if (exclude_id) {
        query += " AND jm.id != ?";
        params.push(exclude_id);
      }

      const connection = await getConnection();
      const [conflicts] = await connection.execute(query, params);
      await connection.end();

      console.log("Jadwal bentrok ditemukan:", conflicts.length);
      res.json(conflicts);
    } catch (error) {
      console.error("ERROR CHECK CONFLICTS:", error.message);
      res.status(500).json({ error: "Gagal memeriksa jadwal bentrok" });
    }
  }
);

// Get Jadwal Mengajar by Guru ID
app.get(
  "/api/jadwal-mengajar/guru/:guruId",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { guruId } = req.params;
      const { semester_id, tahun_ajaran, hari_id } = req.query;

      console.log("Mengambil jadwal mengajar untuk guru:", guruId);

      // Cek apakah guru termasuk dalam sekolah yang sama
      const connection = await getConnection();

      const [guruCheck] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'guru' AND sekolah_id = ?",
        [guruId, req.sekolah_id]
      );

      if (guruCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
      }

      let query = `
      SELECT jm.*, 
        u.nama as guru_nama,
        mp.nama as mata_pelajaran_nama,
        k.nama as kelas_nama,
        h.nama as hari_nama,
        h.urutan as hari_urutan,
        s.nama as semester_nama,
        jp.jam_ke,
        jp.jam_mulai,
        jp.jam_selesai
      FROM jadwal_mengajar jm
      JOIN users u ON jm.guru_id = u.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id AND mp.sekolah_id = ?
      JOIN kelas k ON jm.kelas_id = k.id AND k.sekolah_id = ?
      JOIN hari h ON jm.hari_id = h.id
      JOIN semester s ON jm.semester_id = s.id
      JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
      WHERE jm.guru_id = ? AND jm.sekolah_id = ?
    `;

      let params = [req.sekolah_id, req.sekolah_id, guruId, req.sekolah_id];

      if (semester_id) {
        query += " AND jm.semester_id = ?";
        params.push(semester_id);
      }

      if (tahun_ajaran) {
        query += " AND jm.tahun_ajaran = ?";
        params.push(tahun_ajaran);
      }

      if (hari_id) {
        query += " AND jm.hari_id = ?";
        params.push(hari_id);
      }

      query += " ORDER BY h.urutan, jp.jam_ke";

      const [jadwal] = await connection.execute(query, params);
      await connection.end();

      console.log("Berhasil mengambil jadwal guru, jumlah:", jadwal.length);
      res.json(jadwal);
    } catch (error) {
      console.error("ERROR GET JADWAL MENGAJAR BY GURU:", error.message);
      res.status(500).json({ error: "Gagal mengambil jadwal mengajar guru" });
    }
  }
);

// Endpoint untuk debug - cek data jadwal berdasarkan guru ID
app.get(
  "/api/debug/jadwal-guru/:guruId",
  authenticateToken,
  async (req, res) => {
    try {
      const { guruId } = req.params;
      console.log("Debug jadwal untuk guru:", guruId);

      const connection = await getConnection();

      // Query untuk melihat semua jadwal guru tertentu
      const [jadwal] = await connection.execute(
        `SELECT jm.*, u.nama as guru_nama 
       FROM jadwal_mengajar jm 
       JOIN users u ON jm.guru_id = u.id 
       WHERE jm.guru_id = ?`,
        [guruId]
      );

      // Query untuk melihat data user
      const [user] = await connection.execute(
        "SELECT * FROM users WHERE id = ?",
        [guruId]
      );

      await connection.end();

      console.log("Data jadwal ditemukan:", jadwal.length);
      console.log("Data user:", user.length > 0 ? user[0] : "Tidak ditemukan");

      res.json({
        guru: user[0] || null,
        jadwal: jadwal,
        total_jadwal: jadwal.length,
      });
    } catch (error) {
      console.error("ERROR DEBUG JADWAL GURU:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

// PERBAIKAN: Endpoint current dengan filter yang benar
app.get(
  "/api/jadwal-mengajar/current",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { semester_id, tahun_ajaran, hari_id } = req.query;

      console.log("Mengambil jadwal dengan filter:", {
        userId,
        semester_id,
        tahun_ajaran,
        hari_id,
      });

      let query = `
      SELECT jm.*, 
        u.nama as guru_nama,
        mp.nama as mata_pelajaran_nama,
        k.nama as kelas_nama,
        h.nama as hari_nama,
        h.urutan as hari_urutan,
        s.nama as semester_nama,
        jp.jam_ke,
        jp.jam_mulai,
        jp.jam_selesai
      FROM jadwal_mengajar jm
      JOIN users u ON jm.guru_id = u.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id AND mp.sekolah_id = ?
      JOIN kelas k ON jm.kelas_id = k.id AND k.sekolah_id = ?
      JOIN hari h ON jm.hari_id = h.id
      JOIN semester s ON jm.semester_id = s.id
      JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
      WHERE jm.guru_id = ? AND jm.sekolah_id = ?
    `;

      let params = [req.sekolah_id, req.sekolah_id, userId, req.sekolah_id];

      // Filter semester
      if (semester_id) {
        if (semester_id === "1" || semester_id === "2") {
          query += " AND jm.semester_id = ?";
          params.push(semester_id);
        } else if (semester_id.toLowerCase().includes("ganjil")) {
          query +=
            " AND (jm.semester_id = '1' OR jm.semester_id = 'ganjil' OR s.nama LIKE '%ganjil%')";
        } else if (semester_id.toLowerCase().includes("genap")) {
          query +=
            " AND (jm.semester_id = '2' OR jm.semester_id = 'genap' OR s.nama LIKE '%genap%')";
        } else {
          query += " AND (jm.semester_id = ? OR s.nama LIKE ?)";
          params.push(semester_id, `%${semester_id}%`);
        }
      }

      if (tahun_ajaran) {
        query += " AND jm.tahun_ajaran = ?";
        params.push(tahun_ajaran);
      }

      if (hari_id) {
        if (!isNaN(hari_id)) {
          query += " AND jm.hari_id = ?";
          params.push(hari_id);
        } else {
          query += " AND (h.nama = ? OR h.id = ?)";
          params.push(hari_id, hari_id);
        }
      }

      query += " ORDER BY h.urutan, jp.jam_ke";

      const connection = await getConnection();
      const [jadwal] = await connection.execute(query, params);
      await connection.end();

      console.log("Jadwal ditemukan setelah filter:", jadwal.length);
      res.json(jadwal);
    } catch (error) {
      console.error("ERROR GET JADWAL MENGAJAR CURRENT:", error.message);
      res.status(500).json({ error: "Gagal mengambil jadwal mengajar" });
    }
  }
);

// Endpoint alternatif untuk filter yang lebih fleksibel
app.get(
  "/api/jadwal-mengajar/filtered",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { hari, semester, tahun_ajaran } = req.query;

      console.log("Filtered request:", {
        userId,
        hari,
        semester,
        tahun_ajaran,
      });

      let query = `
      SELECT jm.*, 
        u.nama as guru_nama,
        mp.nama as mata_pelajaran_nama,
        k.nama as kelas_nama,
        h.nama as hari_nama,
        h.urutan as hari_urutan,
        s.nama as semester_nama,
        jp.jam_ke,
        jp.jam_mulai,
        jp.jam_selesai
      FROM jadwal_mengajar jm
      JOIN users u ON jm.guru_id = u.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id
      JOIN kelas k ON jm.kelas_id = k.id
      JOIN hari h ON jm.hari_id = h.id
      JOIN semester s ON jm.semester_id = s.id
      JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
      WHERE jm.guru_id = ?
    `;

      let params = [userId];

      // Filter hari berdasarkan nama
      if (hari && hari !== "Semua Hari") {
        query += " AND h.nama = ?";
        params.push(hari);
      }

      // Filter semester berdasarkan nama
      if (semester && semester !== "Semua Semester") {
        if (semester === "Ganjil" || semester === "1") {
          query += " AND (s.nama LIKE '%ganjil%' OR jm.semester_id = '1')";
        } else if (semester === "Genap" || semester === "2") {
          query += " AND (s.nama LIKE '%genap%' OR jm.semester_id = '2')";
        } else {
          query += " AND s.nama LIKE ?";
          params.push(`%${semester}%`);
        }
      }

      // Filter tahun ajaran
      if (tahun_ajaran) {
        query += " AND jm.tahun_ajaran = ?";
        params.push(tahun_ajaran);
      }

      query += " ORDER BY h.urutan, jp.jam_ke";

      console.log("Filtered query:", query);
      console.log("Filtered params:", params);

      const connection = await getConnection();
      const [jadwal] = await connection.execute(query, params);
      await connection.end();

      console.log("Filtered jadwal found:", jadwal.length);
      res.json(jadwal);
    } catch (error) {
      console.error("ERROR FILTERED JADWAL:", error.message);
      res.status(500).json({ error: "Gagal mengambil jadwal terfilter" });
    }
  }
);

// Get RPP dengan detail lengkap
// Get RPP dengan detail lengkap (Supports Pagination)
app.get("/api/rpp", authenticateTokenAndSchool, async (req, res) => {
  try {
    const {
      guru_id,
      status,
      page,
      limit,
      search,
      mata_pelajaran_id,
      kelas_id,
      semester,
      tahun_ajaran,
    } = req.query;

    console.log("Mengambil data RPP untuk sekolah:", req.sekolah_id);

    // If page is present, use pagination mode
    if (page) {
      const { limitClause, offset, perPage, currentPage } =
        buildPaginationQuery(page, limit);

      // Build filter conditions
      const conditions = [];
      const params = [];

      // Base condition: sekolah_id
      conditions.push("r.sekolah_id = ?");
      params.push(req.sekolah_id);

      if (guru_id) {
        conditions.push("r.guru_id = ?");
        params.push(guru_id);
      }

      if (status) {
        conditions.push("r.status = ?");
        params.push(status);
      }

      if (mata_pelajaran_id) {
        conditions.push("r.mata_pelajaran_id = ?");
        params.push(mata_pelajaran_id);
      }

      if (kelas_id) {
        conditions.push("r.kelas_id = ?");
        params.push(kelas_id);
      }

      if (semester) {
        conditions.push("r.semester = ?");
        params.push(semester);
      }

      if (tahun_ajaran) {
        conditions.push("r.tahun_ajaran = ?");
        params.push(tahun_ajaran);
      }

      if (search) {
        const searchParam = `%${search}%`;
        conditions.push(
          "(r.judul LIKE ? OR mp.nama LIKE ? OR u.nama LIKE ? OR k.nama LIKE ?)"
        );
        params.push(searchParam, searchParam, searchParam, searchParam);
      }

      const whereClause =
        conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

      // Count total items
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM rpp r
        JOIN mata_pelajaran mp ON r.mata_pelajaran_id = mp.id
        JOIN users u ON r.guru_id = u.id
        LEFT JOIN kelas k ON r.kelas_id = k.id
        ${whereClause}
      `;

      const connection = await getConnection();
      const [countResult] = await connection.execute(countQuery, params);
      const totalItems = countResult[0].total;

      // Get paginated data
      const dataQuery = `
        SELECT r.*, 
          mp.nama as mata_pelajaran_nama,
          u.nama as guru_nama,
          k.nama as kelas_nama
        FROM rpp r
        JOIN mata_pelajaran mp ON r.mata_pelajaran_id = mp.id
        JOIN users u ON r.guru_id = u.id
        LEFT JOIN kelas k ON r.kelas_id = k.id
        ${whereClause}
        ORDER BY r.created_at DESC
        ${limitClause}
      `;

      const [rows] = await connection.execute(dataQuery, params);
      await connection.end();

      const paginationMeta = calculatePaginationMeta(
        totalItems,
        currentPage,
        perPage
      );

      return res.json({
        success: true,
        data: rows,
        pagination: paginationMeta,
      });
    } else {
      // Backward compatibility: Return list directly
      let query = `
        SELECT r.*, 
          mp.nama as mata_pelajaran_nama,
          u.nama as guru_nama,
          k.nama as kelas_nama
        FROM rpp r
        JOIN mata_pelajaran mp ON r.mata_pelajaran_id = mp.id AND mp.sekolah_id = ?
        JOIN users u ON r.guru_id = u.id AND u.sekolah_id = ?
        LEFT JOIN kelas k ON r.kelas_id = k.id AND k.sekolah_id = ?
        WHERE r.sekolah_id = ?
      `;
      let params = [
        req.sekolah_id,
        req.sekolah_id,
        req.sekolah_id,
        req.sekolah_id,
      ];

      if (guru_id) {
        query += " AND r.guru_id = ?";
        params.push(guru_id);
      }

      if (status) {
        query += " AND r.status = ?";
        params.push(status);
      }

      query += " ORDER BY r.created_at DESC";

      const connection = await getConnection();
      const [rpp] = await connection.execute(query, params);
      await connection.end();

      console.log(
        "Berhasil mengambil data RPP (Legacy List), jumlah:",
        rpp.length
      );
      res.json(rpp);
    }
  } catch (error) {
    console.error("ERROR GET RPP:", error.message);
    res.status(500).json({ error: "Gagal mengambil data RPP" });
  }
});

app.post("/api/export-rpp", async (req, res) => {
  try {
    const { rppList } = req.body;

    if (!rppList || !Array.isArray(rppList)) {
      return res.status(400).json({
        success: false,
        message: "Data RPP tidak valid",
      });
    }

    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for Excel
    const excelData = [
      // Header row
      [
        "Judul RPP",
        "Guru Pengajar",
        "Mata Pelajaran",
        "Kelas",
        "Semester",
        "Tahun Ajaran",
        "Status",
        "Tanggal Dibuat",
        "Catatan Admin",
        "Kompetensi Dasar",
        "Tujuan Pembelajaran",
        "Materi Pembelajaran",
        "Metode Pembelajaran",
        "Media Pembelajaran",
        "Sumber Belajar",
        "Langkah Pembelajaran",
        "Penilaian",
      ],
      // Data rows
      ...rppList.map((rpp) => [
        rpp.judul || "",
        rpp.guru_nama || "",
        rpp.mata_pelajaran_nama || "",
        rpp.kelas_nama || "",
        rpp.semester || "",
        rpp.tahun_ajaran || "",
        getStatusText(rpp.status),
        formatDateForExport(rpp.created_at),
        rpp.catatan_admin || "",
        rpp.kompetensi_dasar || "",
        rpp.tujuan_pembelajaran || "",
        rpp.materi_pembelajaran || "",
        rpp.metode_pembelajaran || "",
        rpp.media_pembelajaran || "",
        rpp.sumber_belajar || "",
        rpp.langkah_pembelajaran || "",
        rpp.penilaian || "",
      ]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths for better readability
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    const columnWidths = [
      20, 15, 20, 10, 10, 12, 10, 12, 15, 25, 25, 25, 20, 20, 20, 30, 25,
    ];
    for (let i = 0; i < columnWidths.length; i++) {
      worksheet["!cols"][i] = { width: columnWidths[i] };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data RPP");

    // Generate filename
    const filename = `Data_RPP_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, "../temp", filename);

    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, "../temp"))) {
      fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
    }

    // Write file
    XLSX.writeFile(workbook, filePath);

    // Send file as response
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("Error downloading file:", err);
        res.status(500).json({
          success: false,
          message: "Gagal mengunduh file",
        });
      }

      // Clean up temporary file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Export RPP error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal mengexport data RPP: ${error.message}`,
    });
  }
});

// Validasi data RPP sebelum import
app.post("/api/validate-rpp", async (req, res) => {
  try {
    const { rppData } = req.body;

    if (!rppData || !Array.isArray(rppData)) {
      return res.status(400).json({
        success: false,
        message: "Data RPP tidak valid",
      });
    }

    const validatedData = [];
    const errors = [];

    for (let i = 0; i < rppData.length; i++) {
      const rpp = rppData[i];
      const validatedRpp = {};
      let hasError = false;

      // Validasi field required
      if (!rpp.judul || rpp.judul.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: Judul RPP tidak boleh kosong`);
        hasError = true;
      } else {
        validatedRpp.judul = rpp.judul.toString().trim();
      }

      if (!rpp.mata_pelajaran_id || isNaN(parseInt(rpp.mata_pelajaran_id))) {
        errors.push(`Baris ${i + 1}: Mata Pelajaran ID tidak valid`);
        hasError = true;
      } else {
        validatedRpp.mata_pelajaran_id = parseInt(rpp.mata_pelajaran_id);
      }

      if (!rpp.kelas_id || isNaN(parseInt(rpp.kelas_id))) {
        errors.push(`Baris ${i + 1}: Kelas ID tidak valid`);
        hasError = true;
      } else {
        validatedRpp.kelas_id = parseInt(rpp.kelas_id);
      }

      if (!rpp.semester || !["Ganjil", "Genap"].includes(rpp.semester)) {
        errors.push(`Baris ${i + 1}: Semester harus "Ganjil" atau "Genap"`);
        hasError = true;
      } else {
        validatedRpp.semester = rpp.semester;
      }

      if (!rpp.tahun_ajaran || !isValidTahunAjaran(rpp.tahun_ajaran)) {
        errors.push(
          `Baris ${i + 1}: Format tahun ajaran tidak valid (contoh: 2024/2025)`
        );
        hasError = true;
      } else {
        validatedRpp.tahun_ajaran = rpp.tahun_ajaran;
      }

      if (
        !rpp.kompetensi_dasar ||
        rpp.kompetensi_dasar.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Kompetensi dasar tidak boleh kosong`);
        hasError = true;
      } else {
        validatedRpp.kompetensi_dasar = rpp.kompetensi_dasar.toString().trim();
      }

      if (
        !rpp.tujuan_pembelajaran ||
        rpp.tujuan_pembelajaran.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Tujuan pembelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedRpp.tujuan_pembelajaran = rpp.tujuan_pembelajaran
          .toString()
          .trim();
      }

      if (
        !rpp.materi_pembelajaran ||
        rpp.materi_pembelajaran.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Materi pembelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedRpp.materi_pembelajaran = rpp.materi_pembelajaran
          .toString()
          .trim();
      }

      if (
        !rpp.langkah_pembelajaran ||
        rpp.langkah_pembelajaran.toString().trim() === ""
      ) {
        errors.push(`Baris ${i + 1}: Langkah pembelajaran tidak boleh kosong`);
        hasError = true;
      } else {
        validatedRpp.langkah_pembelajaran = rpp.langkah_pembelajaran
          .toString()
          .trim();
      }

      if (!rpp.penilaian || rpp.penilaian.toString().trim() === "") {
        errors.push(`Baris ${i + 1}: Penilaian tidak boleh kosong`);
        hasError = true;
      } else {
        validatedRpp.penilaian = rpp.penilaian.toString().trim();
      }

      // Field optional
      validatedRpp.metode_pembelajaran = rpp.metode_pembelajaran || "";
      validatedRpp.media_pembelajaran = rpp.media_pembelajaran || "";
      validatedRpp.sumber_belajar = rpp.sumber_belajar || "";

      if (!hasError) {
        validatedData.push(validatedRpp);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validasi data RPP gagal",
        errors: errors,
        validatedData: validatedData,
      });
    }

    res.json({
      success: true,
      message: "Validasi data RPP berhasil",
      validatedData: validatedData,
    });
  } catch (error) {
    console.error("RPP validation error:", error);
    res.status(500).json({
      success: false,
      message: `Gagal validasi data RPP: ${error.message}`,
    });
  }
});

// Helper functions
function getStatusText(status) {
  switch (status) {
    case "Disetujui":
      return "Approved";
    case "Menunggu":
      return "Pending";
    case "Ditolak":
      return "Rejected";
    default:
      return status || "-";
  }
}

function formatDateForExport(date) {
  if (!date) return "";
  try {
    const parsed = new Date(date);
    return parsed.toISOString().split("T")[0];
  } catch (e) {
    return date;
  }
}

function isValidTahunAjaran(tahunAjaran) {
  const pattern = /^\d{4}\/\d{4}$/;
  if (!pattern.test(tahunAjaran)) return false;

  const [start, end] = tahunAjaran.split("/");
  return parseInt(end) - parseInt(start) === 1;
}

// Create RPP dengan handling undefined values
app.post("/api/rpp", authenticateTokenAndSchool, async (req, res) => {
  try {
    console.log("Menambah RPP:", req.body);
    const {
      guru_id,
      mata_pelajaran_id,
      kelas_id,
      judul,
      semester,
      tahun_ajaran,
      kompetensi_inti,
      kompetensi_dasar,
      indikator,
      tujuan_pembelajaran,
      materi_pokok,
      metode_pembelajaran,
      media_alat,
      sumber_belajar,
      kegiatan_pembelajaran,
      penilaian,
      file_path,
      status = "Menunggu",
    } = req.body;

    // Validasi field required
    if (
      !guru_id ||
      !mata_pelajaran_id ||
      !judul ||
      !semester ||
      !tahun_ajaran
    ) {
      return res.status(400).json({
        error: "Data tidak lengkap",
        required: [
          "guru_id",
          "mata_pelajaran_id",
          "judul",
          "semester",
          "tahun_ajaran",
        ],
      });
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");

    const connection = await getConnection();

    // Cek apakah guru termasuk dalam sekolah yang sama
    const [guruCheck] = await connection.execute(
      "SELECT id FROM users WHERE id = ? AND role = 'guru' AND sekolah_id = ?",
      [guru_id, req.sekolah_id]
    );

    if (guruCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
    }

    // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
    const [mapelCheck] = await connection.execute(
      "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
      [mata_pelajaran_id, req.sekolah_id]
    );

    if (mapelCheck.length === 0) {
      await connection.end();
      return res.status(404).json({
        error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
      });
    }

    // Cek apakah kelas termasuk dalam sekolah yang sama (jika ada kelas_id)
    if (kelas_id) {
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelas_id, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }
    }

    // Handle undefined values by converting them to null
    const cleanKelasId = kelas_id || null;
    const cleanKompetensiInti = kompetensi_inti || null;
    const cleanKompetensiDasar = kompetensi_dasar || null;
    const cleanIndikator = indikator || null;
    const cleanTujuanPembelajaran = tujuan_pembelajaran || null;
    const cleanMateriPokok = materi_pokok || null;
    const cleanMetodePembelajaran = metode_pembelajaran || null;
    const cleanMediaAlat = media_alat || null;
    const cleanSumberBelajar = sumber_belajar || null;
    const cleanKegiatanPembelajaran = kegiatan_pembelajaran || null;
    const cleanPenilaian = penilaian || null;
    const cleanFilePath = file_path || null;

    await connection.execute(
      `INSERT INTO rpp (
        id, guru_id, mata_pelajaran_id, kelas_id, judul, semester, tahun_ajaran,
        kompetensi_inti, kompetensi_dasar, indikator, tujuan_pembelajaran,
        materi_pokok, metode_pembelajaran, media_alat, sumber_belajar,
        kegiatan_pembelajaran, penilaian, file_path, status, created_at, sekolah_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        guru_id,
        mata_pelajaran_id,
        cleanKelasId,
        judul,
        semester,
        tahun_ajaran,
        cleanKompetensiInti,
        cleanKompetensiDasar,
        cleanIndikator,
        cleanTujuanPembelajaran,
        cleanMateriPokok,
        cleanMetodePembelajaran,
        cleanMediaAlat,
        cleanSumberBelajar,
        cleanKegiatanPembelajaran,
        cleanPenilaian,
        cleanFilePath,
        status,
        createdAt,
        req.sekolah_id, // Tambahkan sekolah_id
      ]
    );
    await connection.end();

    console.log("Berhasil menambah RPP:", id);
    res.json({ id, message: "RPP berhasil disimpan" });
  } catch (error) {
    console.error("ERROR CREATE RPP:", error.message);
    console.error("Error details:", error);
    res.status(500).json({ error: "Gagal menyimpan RPP: " + error.message });
  }
});

// Update status RPP (untuk admin)
app.put("/api/rpp/:id/status", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, catatan } = req.body;

    console.log("Update status RPP:", id, status);

    const connection = await getConnection();

    // Cek apakah RPP termasuk dalam sekolah yang sama
    const [rppCheck] = await connection.execute(
      "SELECT id FROM rpp WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id]
    );

    if (rppCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "RPP tidak ditemukan atau tidak memiliki akses" });
    }

    await connection.execute(
      "UPDATE rpp SET status = ?, catatan_admin = ?, updated_at = NOW() WHERE id = ? AND sekolah_id = ?",
      [status, catatan || "", id, req.sekolah_id] // Tambahkan sekolah_id di WHERE
    );
    await connection.end();

    console.log("Status RPP berhasil diupdate:", id);
    res.json({ message: "Status RPP berhasil diupdate" });
  } catch (error) {
    console.error("ERROR UPDATE RPP STATUS:", error.message);
    res.status(500).json({ error: "Gagal mengupdate status RPP" });
  }
});

// Update RPP (edit full data)
app.put("/api/rpp/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update RPP:", id, req.body);
    const {
      mata_pelajaran_id,
      kelas_id,
      judul,
      semester,
      tahun_ajaran,
      kompetensi_inti,
      kompetensi_dasar,
      indikator,
      tujuan_pembelajaran,
      materi_pokok,
      metode_pembelajaran,
      media_alat,
      sumber_belajar,
      kegiatan_pembelajaran,
      penilaian,
      file_path,
    } = req.body;

    // Validasi field required
    if (!mata_pelajaran_id || !judul || !semester || !tahun_ajaran) {
      return res.status(400).json({
        error: "Data tidak lengkap",
        required: ["mata_pelajaran_id", "judul", "semester", "tahun_ajaran"],
      });
    }

    const connection = await getConnection();

    // Cek apakah RPP termasuk dalam sekolah yang sama
    const [rppCheck] = await connection.execute(
      "SELECT id, guru_id FROM rpp WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id]
    );

    if (rppCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "RPP tidak ditemukan atau tidak memiliki akses" });
    }

    // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
    const [mapelCheck] = await connection.execute(
      "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
      [mata_pelajaran_id, req.sekolah_id]
    );

    if (mapelCheck.length === 0) {
      await connection.end();
      return res.status(404).json({
        error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
      });
    }

    // Cek apakah kelas termasuk dalam sekolah yang sama (jika ada kelas_id)
    if (kelas_id) {
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelas_id, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }
    }

    // Handle undefined values by converting them to null
    const cleanKelasId = kelas_id || null;
    const cleanKompetensiInti = kompetensi_inti || null;
    const cleanKompetensiDasar = kompetensi_dasar || null;
    const cleanIndikator = indikator || null;
    const cleanTujuanPembelajaran = tujuan_pembelajaran || null;
    const cleanMateriPokok = materi_pokok || null;
    const cleanMetodePembelajaran = metode_pembelajaran || null;
    const cleanMediaAlat = media_alat || null;
    const cleanSumberBelajar = sumber_belajar || null;
    const cleanKegiatanPembelajaran = kegiatan_pembelajaran || null;
    const cleanPenilaian = penilaian || null;
    const cleanFilePath = file_path || null;

    await connection.execute(
      `UPDATE rpp SET 
        mata_pelajaran_id = ?,
        kelas_id = ?,
        judul = ?,
        semester = ?,
        tahun_ajaran = ?,
        kompetensi_inti = ?,
        kompetensi_dasar = ?,
        indikator = ?,
        tujuan_pembelajaran = ?,
        materi_pokok = ?,
        metode_pembelajaran = ?,
        media_alat = ?,
        sumber_belajar = ?,
        kegiatan_pembelajaran = ?,
        penilaian = ?,
        file_path = ?,
        updated_at = NOW()
      WHERE id = ? AND sekolah_id = ?`,
      [
        mata_pelajaran_id,
        cleanKelasId,
        judul,
        semester,
        tahun_ajaran,
        cleanKompetensiInti,
        cleanKompetensiDasar,
        cleanIndikator,
        cleanTujuanPembelajaran,
        cleanMateriPokok,
        cleanMetodePembelajaran,
        cleanMediaAlat,
        cleanSumberBelajar,
        cleanKegiatanPembelajaran,
        cleanPenilaian,
        cleanFilePath,
        id,
        req.sekolah_id,
      ]
    );
    await connection.end();

    console.log("RPP berhasil diupdate:", id);
    res.json({ message: "RPP berhasil diupdate" });
  } catch (error) {
    console.error("ERROR UPDATE RPP:", error.message);
    console.error("Error details:", error);
    res.status(500).json({ error: "Gagal mengupdate RPP: " + error.message });
  }
});

// Delete RPP
app.delete("/api/rpp/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete RPP:", id);

    const connection = await getConnection();

    // Cek apakah RPP termasuk dalam sekolah yang sama
    const [rppCheck] = await connection.execute(
      "SELECT id FROM rpp WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id]
    );

    if (rppCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "RPP tidak ditemukan atau tidak memiliki akses" });
    }

    await connection.execute(
      "DELETE FROM rpp WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id] // Tambahkan sekolah_id di WHERE
    );
    await connection.end();

    console.log("RPP berhasil dihapus:", id);
    res.json({ message: "RPP berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE RPP:", error.message);
    res.status(500).json({ error: "Gagal menghapus RPP" });
  }
});

// Endpoint untuk upload file
app.post(
  "/api/upload/rpp",
  authenticateToken,
  uploadMiddleware,
  async (req, res) => {
    try {
      console.log("Upload RPP endpoint hit");

      if (!req.file) {
        console.log("No file received");
        return res.status(400).json({ error: "Tidak ada file yang diupload" });
      }

      console.log("File received:", {
        originalname: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
        path: req.file.path,
      });

      const fileUrl = `/uploads/rpp/${req.file.filename}`;

      console.log("File uploaded successfully:", fileUrl);

      res.json({
        message: "File berhasil diupload",
        file_path: fileUrl,
        file_name: req.file.originalname,
        file_size: req.file.size,
      });
    } catch (error) {
      console.error("ERROR UPLOAD FILE:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Gagal mengupload file",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

app.get(
  "/api/kegiatan/filter-options",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Mengambil filter options untuk kegiatan");
      const connection = await getConnection();

      const { guru_id, kelas_id, tanggal, bulan, tahun, mata_pelajaran_id } =
        req.query;

      // Base params and where clause for sekolah
      const baseParams = [req.sekolah_id];
      let baseWhere = `WHERE k.sekolah_id = ?`;

      // If guru_id provided, add to where
      if (guru_id) {
        baseWhere += ` AND k.guru_id = ?`;
        baseParams.push(guru_id);
      }

      // If kelas_id provided, add to where
      if (kelas_id) {
        baseWhere += ` AND k.kelas_id = ?`;
        baseParams.push(kelas_id);
      }

      // If mata_pelajaran_id provided, add to where
      if (mata_pelajaran_id) {
        baseWhere += ` AND k.mata_pelajaran_id = ?`;
        baseParams.push(mata_pelajaran_id);
      }

      // If tanggal provided, try to match date (allow full datetime)
      if (tanggal) {
        baseWhere += ` AND DATE(k.tanggal) = ?`;
        baseParams.push(tanggal);
      }

      // If bulan provided (1-12)
      if (bulan) {
        baseWhere += ` AND MONTH(k.tanggal) = ?`;
        baseParams.push(bulan);
      }

      // If tahun provided
      if (tahun) {
        baseWhere += ` AND YEAR(k.tanggal) = ?`;
        baseParams.push(tahun);
      }

      // Guru options
      const [guruRows] = await connection.execute(
        `SELECT DISTINCT u.id, u.nama as label
         FROM users u
         INNER JOIN kegiatan k ON k.guru_id = u.id
         ${baseWhere}
         ORDER BY u.nama ASC`,
        baseParams
      );

      // Kelas options
      const [kelasRows] = await connection.execute(
        `SELECT DISTINCT kk.id, kk.nama as label
         FROM kelas kk
         INNER JOIN kegiatan k ON k.kelas_id = kk.id
         ${baseWhere}
         ORDER BY kk.nama ASC`,
        baseParams
      );

      // If no kelas found from kegiatan (some guru may not have kegiatan entries),
      // try to fetch kelas from mata_pelajaran_kelas via guru_mata_pelajaran mapping
      // when a specific guru_id is provided.
      let finalKelasRows = kelasRows;
      if (Array.isArray(kelasRows) && kelasRows.length === 0 && guru_id) {
        try {
          const [fallbackKelasRows] = await connection.execute(
            `SELECT DISTINCT kk.id, kk.nama as label
           FROM kelas kk
           JOIN mata_pelajaran_kelas mpk ON kk.id = mpk.kelas_id
           JOIN guru_mata_pelajaran gmp ON mpk.mata_pelajaran_id = gmp.mata_pelajaran_id
           WHERE gmp.guru_id = ? AND kk.sekolah_id = ?
           ${mata_pelajaran_id ? "AND mpk.mata_pelajaran_id = ?" : ""}
           ORDER BY kk.nama ASC`,
            mata_pelajaran_id
              ? [guru_id, req.sekolah_id, mata_pelajaran_id]
              : [guru_id, req.sekolah_id]
          );

          if (
            Array.isArray(fallbackKelasRows) &&
            fallbackKelasRows.length > 0
          ) {
            finalKelasRows = fallbackKelasRows;
          }
        } catch (e) {
          console.error(
            "Error fetching fallback kelas from mata_pelajaran_kelas:",
            e.message
          );
          // keep finalKelasRows as original (possibly empty)
        }
      }

      // Tanggal options (distinct dates)
      const [tanggalRows] = await connection.execute(
        `SELECT DISTINCT DATE(k.tanggal) as tanggal
         FROM kegiatan k
         ${baseWhere}
         ORDER BY tanggal DESC`,
        baseParams
      );

      // Month options
      const [monthRows] = await connection.execute(
        `SELECT DISTINCT MONTH(k.tanggal) as bulan
         FROM kegiatan k
         ${baseWhere}
         ORDER BY bulan DESC`,
        baseParams
      );

      // Year options
      const [yearRows] = await connection.execute(
        `SELECT DISTINCT YEAR(k.tanggal) as tahun
         FROM kegiatan k
         ${baseWhere}
         ORDER BY tahun DESC`,
        baseParams
      );

      await connection.end();

      res.json({
        success: true,
        data: {
          guru_options: guruRows.map((r) => ({ id: r.id, label: r.label })),
          kelas_options: finalKelasRows.map((r) => ({
            id: r.id,
            label: r.label,
          })),
          tanggal_options: tanggalRows.map((r) => r.tanggal),
          bulan_options: monthRows.map((r) => r.bulan),
          tahun_options: yearRows.map((r) => r.tahun),
        },
      });
    } catch (error) {
      console.error("ERROR GET Kegiatan filter-options:", error.message);
      res
        .status(500)
        .json({ error: "Gagal mengambil filter options kegiatan" });
    }
  }
);

// Get kegiatan by guru
app.get(
  "/api/kegiatan/guru/:guruId",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { guruId } = req.params;
      console.log(
        "Mengambil kegiatan untuk guru:",
        guruId,
        "sekolah:",
        req.sekolah_id
      );

      const connection = await getConnection();

      // Cek apakah guru termasuk dalam sekolah yang sama
      // Note: guruId is from the guru table, not users table
      const [guruCheck] = await connection.execute(
        "SELECT id FROM guru WHERE id = ? AND sekolah_id = ?",
        [guruId, req.sekolah_id]
      );

      if (guruCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
      }

      const [kegiatan] = await connection.execute(
        `
      SELECT 
        kk.*,
        mp.nama as mata_pelajaran_nama,
        kls.nama as kelas_nama,
        g.nama as guru_nama,
        bm.judul_bab,
        sbm.judul_sub_bab,
        GROUP_CONCAT(DISTINCT s.nama) as siswa_target_names
      FROM kegiatan_kelas kk
      JOIN mata_pelajaran mp ON kk.mata_pelajaran_id = mp.id AND mp.sekolah_id = ?
      JOIN kelas kls ON kk.kelas_id = kls.id AND kls.sekolah_id = ?
      JOIN guru g ON kk.guru_id = g.id AND g.sekolah_id = ?
      LEFT JOIN bab_materi bm ON kk.bab_id = bm.id
      LEFT JOIN sub_bab_materi sbm ON kk.sub_bab_id = sbm.id
      LEFT JOIN kegiatan_siswa_target kst ON kk.id = kst.kegiatan_id
      LEFT JOIN siswa s ON kst.siswa_id = s.id AND s.sekolah_id = ?
      WHERE kk.guru_id = ? AND kk.sekolah_id = ?
      GROUP BY kk.id
      ORDER BY kk.tanggal DESC, kk.created_at DESC
    `,
        [
          req.sekolah_id,
          req.sekolah_id,
          req.sekolah_id,
          req.sekolah_id,
          guruId,
          req.sekolah_id,
        ]
      );

      await connection.end();

      console.log("Kegiatan ditemukan:", kegiatan.length);
      res.json(kegiatan);
    } catch (error) {
      console.error("ERROR GET KEGIATAN:", error.message);
      res.status(500).json({ error: "Gagal mengambil data kegiatan" });
    }
  }
);

// Export kegiatan kelas ke Excel
app.post(
  "/api/export-class-activities",
  authenticateToken,
  async (req, res) => {
    try {
      const { activities } = req.body;

      if (!activities || !Array.isArray(activities)) {
        return res.status(400).json({
          success: false,
          message: "Data kegiatan kelas tidak valid",
        });
      }

      // Create new workbook
      const workbook = XLSX.utils.book_new();

      // Prepare data for Excel
      const excelData = [
        // Header row
        [
          "Judul Kegiatan",
          "Mata Pelajaran",
          "Kelas",
          "Guru Pengajar",
          "Jenis Kegiatan",
          "Target Siswa",
          "Deskripsi",
          "Tanggal",
          "Hari",
          "Batas Waktu",
          "Bab",
          "Sub Bab",
        ],
        // Data rows
        ...activities.map((activity) => [
          activity.judul || "",
          activity.mata_pelajaran_nama || "",
          activity.kelas_nama || "",
          activity.guru_nama || "",
          getActivityTypeLabel(activity.jenis),
          getTargetLabel(activity.target),
          activity.deskripsi || "",
          formatDateForExport(activity.tanggal),
          activity.hari || "",
          formatDateForExport(activity.batas_waktu),
          activity.judul_bab || "",
          activity.judul_sub_bab || "",
        ]),
      ];

      // Create worksheet
      const worksheet = XLSX.utils.aoa_to_sheet(excelData);

      // Set column widths for better readability
      if (!worksheet["!cols"]) worksheet["!cols"] = [];
      const columnWidths = [25, 20, 15, 20, 15, 15, 30, 12, 10, 12, 20, 20];
      for (let i = 0; i < columnWidths.length; i++) {
        worksheet["!cols"][i] = { width: columnWidths[i] };
      }

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, "Data Kegiatan Kelas");

      // Generate filename
      const filename = `Data_Kegiatan_Kelas_${Date.now()}.xlsx`;
      const filePath = path.join(__dirname, "../temp", filename);

      // Ensure temp directory exists
      if (!fs.existsSync(path.join(__dirname, "../temp"))) {
        fs.mkdirSync(path.join(__dirname, "../temp"), { recursive: true });
      }

      // Write file
      XLSX.writeFile(workbook, filePath);

      // Send file as response
      res.download(filePath, filename, (err) => {
        if (err) {
          console.error("Error downloading file:", err);
          res.status(500).json({
            success: false,
            message: "Gagal mengunduh file",
          });
        }

        // Clean up temporary file after download
        setTimeout(() => {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }, 5000);
      });
    } catch (error) {
      console.error("Export class activities error:", error);
      res.status(500).json({
        success: false,
        message: `Gagal mengexport data kegiatan kelas: ${error.message}`,
      });
    }
  }
);

// Helper function untuk jenis kegiatan
function getActivityTypeLabel(jenis) {
  switch (jenis) {
    case "materi":
      return "Materi";
    case "tugas":
      return "Tugas";
    case "kuis":
      return "Kuis";
    case "ulangan":
      return "Ulangan";
    case "proyek":
      return "Proyek";
    case "praktikum":
      return "Praktikum";
    default:
      return jenis || "-";
  }
}

// Helper function untuk target siswa
function getTargetLabel(target) {
  switch (target) {
    case "umum":
      return "Semua Siswa";
    case "khusus":
      return "Siswa Tertentu";
    default:
      return target || "-";
  }
}

// Get kegiatan by kelas (untuk siswa)
app.get(
  "/api/kegiatan/kelas/:kelasId",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { kelasId } = req.params;
      const { siswa_id } = req.query;

      console.log(
        "Mengambil kegiatan untuk kelas:",
        kelasId,
        "sekolah:",
        req.sekolah_id
      );

      const connection = await getConnection();

      // Cek apakah kelas termasuk dalam sekolah yang sama
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelasId, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }

      let query = `
      SELECT 
        kk.*,
        mp.nama as mata_pelajaran_nama,
        kls.nama as kelas_nama,
        u.nama as guru_nama,
        bm.judul_bab,
        sbm.judul_sub_bab,
        (kst.siswa_id IS NOT NULL) as untuk_siswa_ini
      FROM kegiatan_kelas kk
      JOIN mata_pelajaran mp ON kk.mata_pelajaran_id = mp.id AND mp.sekolah_id = ?
      JOIN kelas kls ON kk.kelas_id = kls.id AND kls.sekolah_id = ?
      JOIN users u ON kk.guru_id = u.id AND u.sekolah_id = ?
      LEFT JOIN bab_materi bm ON kk.bab_id = bm.id
      LEFT JOIN sub_bab_materi sbm ON kk.sub_bab_id = sbm.id
      LEFT JOIN kegiatan_siswa_target kst ON kk.id = kst.kegiatan_id AND kst.siswa_id = ?
      WHERE kk.kelas_id = ? AND kk.sekolah_id = ? AND (kk.target = 'umum' OR kst.siswa_id = ?)
      GROUP BY kk.id
      ORDER BY kk.tanggal DESC, kk.created_at DESC
    `;

      const [kegiatan] = await connection.execute(query, [
        req.sekolah_id,
        req.sekolah_id,
        req.sekolah_id,
        siswa_id,
        kelasId,
        req.sekolah_id,
        siswa_id,
      ]);

      await connection.end();

      console.log("Kegiatan ditemukan:", kegiatan.length);
      res.json(kegiatan);
    } catch (error) {
      console.error("ERROR GET KEGIATAN KELAS:", error.message);
      res.status(500).json({ error: "Gagal mengambil data kegiatan" });
    }
  }
);

app.get("/api/kegiatan", authenticateTokenAndSchool, async (req, res) => {
  try {
    const {
      page,
      limit,
      search,
      guru_id,
      kelas_id,
      mata_pelajaran_id,
      target,
      tanggal,
    } = req.query;
    console.log("Mengambil semua kegiatan untuk sekolah:", req.sekolah_id, {
      page,
      limit,
      search,
      guru_id,
      kelas_id,
      mata_pelajaran_id,
      target,
      tanggal,
    });

    // Build filter conditions
    const conditions = [
      "kk.sekolah_id = ?",
      "mp.sekolah_id = ?",
      "kls.sekolah_id = ?",
      "u.sekolah_id = ?",
      "s.sekolah_id = ?",
    ];
    const params = [
      req.sekolah_id,
      req.sekolah_id,
      req.sekolah_id,
      req.sekolah_id,
      req.sekolah_id,
    ];

    if (guru_id) {
      conditions.push("kk.guru_id = ?");
      params.push(guru_id);
    }
    if (kelas_id) {
      conditions.push("kk.kelas_id = ?");
      params.push(kelas_id);
    }
    if (mata_pelajaran_id) {
      conditions.push("kk.mata_pelajaran_id = ?");
      params.push(mata_pelajaran_id);
    }
    if (target) {
      conditions.push("kk.target = ?");
      params.push(target);
    }
    if (tanggal) {
      conditions.push("kk.tanggal = ?");
      params.push(tanggal);
    }
    if (search) {
      conditions.push("(kk.judul LIKE ? OR kk.deskripsi LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Build pagination
    const { limitClause, currentPage, perPage } = buildPaginationQuery(
      page,
      limit
    );

    // Count total items
    const countQuery = `
      SELECT COUNT(DISTINCT kk.id) as total
      FROM kegiatan_kelas kk
      JOIN mata_pelajaran mp ON kk.mata_pelajaran_id = mp.id
      JOIN kelas kls ON kk.kelas_id = kls.id
      JOIN users u ON kk.guru_id = u.id
      LEFT JOIN bab_materi bm ON kk.bab_id = bm.id
      LEFT JOIN sub_bab_materi sbm ON kk.sub_bab_id = sbm.id
      LEFT JOIN kegiatan_siswa_target kst ON kk.id = kst.kegiatan_id
      LEFT JOIN siswa s ON kst.siswa_id = s.id
      ${whereClause}
    `;
    const connection = await getConnection();
    const [countResult] = await connection.execute(countQuery, params);
    const totalItems = countResult[0].total;

    // Get paginated data
    const dataQuery = `
      SELECT 
        kk.*,
        mp.nama as mata_pelajaran_nama,
        kls.nama as kelas_nama,
        u.nama as guru_nama,
        bm.judul_bab,
        sbm.judul_sub_bab,
        GROUP_CONCAT(DISTINCT s.nama) as siswa_target_names
      FROM kegiatan_kelas kk
      JOIN mata_pelajaran mp ON kk.mata_pelajaran_id = mp.id
      JOIN kelas kls ON kk.kelas_id = kls.id
      JOIN users u ON kk.guru_id = u.id
      LEFT JOIN bab_materi bm ON kk.bab_id = bm.id
      LEFT JOIN sub_bab_materi sbm ON kk.sub_bab_id = sbm.id
      LEFT JOIN kegiatan_siswa_target kst ON kk.id = kst.kegiatan_id
      LEFT JOIN siswa s ON kst.siswa_id = s.id
      ${whereClause}
      GROUP BY kk.id
      ORDER BY kk.tanggal DESC, kk.created_at DESC
      ${limitClause}
    `;
    const [kegiatan] = await connection.execute(dataQuery, params);
    await connection.end();

    // Calculate pagination metadata
    const pagination = calculatePaginationMeta(
      totalItems,
      currentPage,
      perPage
    );

    console.log(
      `✅ Data kegiatan: ${kegiatan.length} items (Total: ${totalItems})`
    );

    res.json({
      success: true,
      data: kegiatan,
      pagination,
    });
  } catch (error) {
    console.error("ERROR GET ALL KEGIATAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kegiatan" });
  }
});

app.get("/api/kegiatan/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil kegiatan by ID:", id, "sekolah:", req.sekolah_id);

    const connection = await getConnection();

    const [kegiatan] = await connection.execute(
      `
      SELECT 
        kk.*,
        mp.nama as mata_pelajaran_nama,
        kls.nama as kelas_nama,
        u.nama as guru_nama,
        bm.judul_bab,
        sbm.judul_sub_bab,
        GROUP_CONCAT(DISTINCT s.id) as siswa_target_ids,
        GROUP_CONCAT(DISTINCT s.nama) as siswa_target_names
      FROM kegiatan_kelas kk
      JOIN mata_pelajaran mp ON kk.mata_pelajaran_id = mp.id
      JOIN kelas kls ON kk.kelas_id = kls.id
      JOIN users u ON kk.guru_id = u.id
      LEFT JOIN bab_materi bm ON kk.bab_id = bm.id
      LEFT JOIN sub_bab_materi sbm ON kk.sub_bab_id = sbm.id
      LEFT JOIN kegiatan_siswa_target kst ON kk.id = kst.kegiatan_id
      LEFT JOIN siswa s ON kst.siswa_id = s.id
      WHERE kk.id = ? AND kk.sekolah_id = ?
      GROUP BY kk.id
    `,
      [id, req.sekolah_id]
    );

    await connection.end();

    if (kegiatan.length === 0) {
      return res.status(404).json({ error: "Kegiatan tidak ditemukan" });
    }

    console.log("Kegiatan ditemukan:", kegiatan[0].judul);
    res.json(kegiatan[0]);
  } catch (error) {
    console.error("ERROR GET KEGIATAN BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kegiatan" });
  }
});

app.get("/api/pengumuman", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { page, limit, search, prioritas, role_target, status } = req.query;

    console.log(`DEBUG: Mengambil data pengumuman dengan filter:`, {
      page,
      limit,
      search,
      prioritas,
      role_target,
      status,
    });
    console.log(`DEBUG: User role: ${req.user.role}, sekolah: ${req.sekolah_id}`);

    const connection = await getConnection();

    // Build filter conditions
    const conditions = ["p.sekolah_id = ?"];
    const params = [req.sekolah_id];

    // Role-based filtering (existing logic)
    if (req.user.role === "wali") {
      conditions.push(
        "(p.role_target = 'wali' OR p.role_target = 'semua' OR p.role_target IS NULL OR p.role_target = '')"
      );
    } else if (req.user.role === "guru") {
      conditions.push(
        "(p.role_target = 'guru' OR p.role_target = 'semua' OR p.role_target IS NULL OR p.role_target = '')"
      );
    } else if (req.user.role === "siswa") {
      conditions.push(
        "(p.role_target = 'siswa' OR p.role_target = 'semua' OR p.role_target IS NULL OR p.role_target = '')"
      );
    }
    // Admin dan super_admin bisa lihat semua

    // Additional filters
    if (search) {
      conditions.push("(p.judul LIKE ? OR p.konten LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (prioritas) {
      conditions.push("p.prioritas = ?");
      params.push(prioritas);
    }
    if (role_target) {
      conditions.push("p.role_target = ?");
      params.push(role_target);
    }
    if (status) {
      if (status === "aktif") {
        conditions.push(
          "(p.tanggal_akhir >= CURDATE() OR p.tanggal_akhir IS NULL)"
        );
      } else if (status === "terjadwal") {
        conditions.push("p.tanggal_awal > CURDATE()");
      } else if (status === "kedaluwarsa") {
        conditions.push("p.tanggal_akhir < CURDATE()");
      }
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    console.log("DEBUG: Generated WHERE clause:", whereClause);
    console.log("DEBUG: Query params:", params);

    // Build pagination
    const { limitClause, currentPage, perPage } = buildPaginationQuery(
      page,
      limit
    );

    // Count total items
    const countQuery = `
      SELECT COUNT(*) as total
      FROM pengumuman p
      ${whereClause}
    `;
    const [countResult] = await connection.execute(countQuery, params);
    const totalItems = countResult[0].total;

    // Get paginated data
    const dataQuery = `
      SELECT p.*,
        u.nama as pembuat_nama,
        u.role as pembuat_role
      FROM pengumuman p
      JOIN users u ON p.pembuat_id = u.id
      ${whereClause}
      ORDER BY p.created_at DESC
      ${limitClause}
    `;
    const [pengumuman] = await connection.execute(dataQuery, params);

    await connection.end();

    // Calculate pagination metadata
    const pagination = calculatePaginationMeta(
      totalItems,
      currentPage,
      perPage
    );

    console.log(
      `✅ Data pengumuman: ${pengumuman.length} items (Total: ${totalItems})`
    );

    res.json({
      success: true,
      data: pengumuman,
      pagination,
    });
  } catch (error) {
    console.error("ERROR GET PENGUMUMAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data pengumuman" });
  }
});

// Get Filter Options for Pengumuman
app.get(
  "/api/pengumuman/filter-options",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Mengambil filter options untuk pengumuman");

      // Static filter options
      const prioritasOptions = [
        { value: "biasa", label: "Normal" },
        { value: "penting", label: "Important" },
      ];

      const targetOptions = [
        { value: "semua", label: "All" },
        { value: "guru", label: "Teachers" },
        { value: "siswa", label: "Students" },
        { value: "wali", label: "Parents" },
        { value: "admin", label: "Admins" },
      ];

      const statusOptions = [
        { value: "aktif", label: "Active" },
        { value: "terjadwal", label: "Scheduled" },
        { value: "kedaluwarsa", label: "Expired" },
      ];

      res.json({
        success: true,
        data: {
          prioritas_options: prioritasOptions,
          target_options: targetOptions,
          status_options: statusOptions,
        },
      });

      console.log("✅ Filter options berhasil diambil");
    } catch (error) {
      console.error("ERROR GET FILTER OPTIONS:", error.message);
      res.status(500).json({ error: "Gagal mengambil filter options" });
    }
  }
);

// Get pengumuman by ID
app.get("/api/pengumuman/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(
      "Mengambil data pengumuman by ID:",
      id,
      "sekolah:",
      req.sekolah_id
    );

    const connection = await getConnection();
    const [pengumuman] = await connection.execute(
      `SELECT 
        p.*,
        u.nama as pembuat_nama,
        k.nama as kelas_nama,
        u.role as pembuat_role
      FROM pengumuman p
      JOIN users u ON p.pembuat_id = u.id AND u.sekolah_id = ?
      LEFT JOIN kelas k ON p.kelas_id = k.id AND k.sekolah_id = ?
      WHERE p.id = ? AND p.sekolah_id = ?`,
      [req.sekolah_id, req.sekolah_id, id, req.sekolah_id]
    );
    await connection.end();

    if (pengumuman.length === 0) {
      return res.status(404).json({ error: "Pengumuman tidak ditemukan" });
    }

    console.log("Berhasil mengambil data pengumuman:", id);
    res.json(pengumuman[0]);
  } catch (error) {
    console.error("ERROR GET PENGUMUMAN BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data pengumuman" });
  }
});

// Create pengumuman baru
app.post("/api/pengumuman", authenticateTokenAndSchool, async (req, res) => {
  try {
    console.log("Menambah pengumuman baru:", req.body);
    const {
      judul,
      konten,
      kelas_id,
      role_target,
      prioritas,
      tanggal_awal,
      tanggal_akhir,
    } = req.body;

    // Validasi data required
    if (!judul || !konten) {
      return res.status(400).json({
        error: "Judul dan konten harus diisi",
      });
    }

    const id = crypto.randomUUID();
    const pembuat_id = req.user.id; // ID user yang login

    const connection = await getConnection();

    // Cek apakah kelas termasuk dalam sekolah yang sama (jika ada kelas_id)
    if (kelas_id) {
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelas_id, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }
    }

    await connection.execute(
      `INSERT INTO pengumuman 
        (id, judul, konten, kelas_id, role_target, pembuat_id, prioritas, tanggal_awal, tanggal_akhir, sekolah_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        judul,
        konten,
        kelas_id || null,
        role_target || "all",
        pembuat_id,
        prioritas || "biasa",
        tanggal_awal || null,
        tanggal_akhir || null,
        req.sekolah_id, // Tambahkan sekolah_id
      ]
    );

    console.log("Pengumuman berhasil ditambahkan:", id);

    res.json({
      message: "Pengumuman berhasil ditambahkan",
      id,
    });

    await connection.end();

    // ========== KIRIM NOTIFIKASI PENGUMUMAN ==========
    // Jalankan async setelah response dikirim
    setImmediate(async () => {
      try {
        // Buat connection baru untuk notifikasi
        const notifConnection = await getConnection();

        // Dapatkan info lengkap pengumuman untuk notifikasi
        const [pengumumanInfo] = await notifConnection.execute(
          `SELECT 
            p.id, p.judul, p.konten, p.kelas_id, p.role_target, p.prioritas,
            k.nama as kelas_nama,
            u.nama as pembuat_nama
          FROM pengumuman p
          LEFT JOIN kelas k ON p.kelas_id = k.id
          JOIN users u ON p.pembuat_id = u.id
          WHERE p.id = ?`,
          [id]
        );

        await notifConnection.end();

        if (pengumumanInfo.length > 0) {
          const notificationData = {
            pengumuman_id: id,
            judul: pengumumanInfo[0].judul,
            konten: pengumumanInfo[0].konten,
            kelas_id: pengumumanInfo[0].kelas_id,
            kelas_nama: pengumumanInfo[0].kelas_nama,
            role_target: pengumumanInfo[0].role_target,
            prioritas: pengumumanInfo[0].prioritas,
            pembuat_nama: pengumumanInfo[0].pembuat_nama,
            sekolah_id: req.sekolah_id,
          };

          console.log("📢 Mengirim notifikasi pengumuman:", notificationData);

          // Kirim notifikasi
          const result = await sendPengumumanNotification(
            notificationData,
            req.headers["authorization"]
          );

          if (result && result.success) {
            console.log(
              `✅ Pengumuman berhasil dikirim ke ${result.sent_count} dari ${result.total_targets} target users`
            );
          } else {
            console.log(`⚠️  Pengumuman gagal dikirim atau tidak ada target`);
          }
        }
      } catch (notifError) {
        console.error(
          "❌ Error dalam pengiriman notifikasi pengumuman:",
          notifError.message
        );
        console.error("Stack:", notifError.stack);
        // Jangan gagalkan proses pembuatan pengumuman
      }
    });
    // ========== END KIRIM NOTIFIKASI ==========
  } catch (error) {
    console.error("ERROR POST PENGUMUMAN:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah pengumuman" });
  }
});

// Update pengumuman
app.put("/api/pengumuman/:id", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update pengumuman:", id, req.body);

    const {
      judul,
      konten,
      kelas_id,
      role_target,
      prioritas,
      tanggal_awal,
      tanggal_akhir,
    } = req.body;

    // Validasi data required
    if (!judul || !konten) {
      return res.status(400).json({
        error: "Judul dan konten harus diisi",
      });
    }

    const connection = await getConnection();

    // Cek apakah pengumuman termasuk dalam sekolah yang sama
    const [pengumumanCheck] = await connection.execute(
      "SELECT id FROM pengumuman WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id]
    );

    if (pengumumanCheck.length === 0) {
      await connection.end();
      return res.status(404).json({
        error: "Pengumuman tidak ditemukan atau tidak memiliki akses",
      });
    }

    // Cek apakah kelas termasuk dalam sekolah yang sama (jika ada kelas_id)
    if (kelas_id) {
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelas_id, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }
    }

    await connection.execute(
      `UPDATE pengumuman 
       SET judul = ?, konten = ?, kelas_id = ?, role_target = ?, 
           prioritas = ?, tanggal_awal = ?, tanggal_akhir = ?, updated_at = NOW()
       WHERE id = ? AND sekolah_id = ?`,
      [
        judul,
        konten,
        kelas_id || null,
        role_target || "all",
        prioritas || "biasa",
        tanggal_awal || null,
        tanggal_akhir || null,
        id,
        req.sekolah_id, // Tambahkan sekolah_id di WHERE
      ]
    );

    await connection.end();

    console.log("Pengumuman berhasil diupdate:", id);
    res.json({ message: "Pengumuman berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT PENGUMUMAN:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate pengumuman" });
  }
});

// Delete pengumuman
app.delete(
  "/api/pengumuman/:id",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log("Delete pengumuman:", id, "sekolah:", req.sekolah_id);

      const connection = await getConnection();

      // Cek apakah pengumuman termasuk dalam sekolah yang sama
      const [pengumumanCheck] = await connection.execute(
        "SELECT id FROM pengumuman WHERE id = ? AND sekolah_id = ?",
        [id, req.sekolah_id]
      );

      if (pengumumanCheck.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Pengumuman tidak ditemukan atau tidak memiliki akses",
        });
      }

      await connection.execute(
        "DELETE FROM pengumuman WHERE id = ? AND sekolah_id = ?",
        [id, req.sekolah_id]
      );
      await connection.end();

      console.log("Pengumuman berhasil dihapus:", id);
      res.json({ message: "Pengumuman berhasil dihapus" });
    } catch (error) {
      console.error("ERROR DELETE PENGUMUMAN:", error.message);
      console.error("SQL Error code:", error.code);
      res.status(500).json({ error: "Gagal menghapus pengumuman" });
    }
  }
);

// Get pengumuman untuk user berdasarkan role dan kelas
app.get(
  "/api/pengumuman/user/current",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const user = req.user;
      console.log(
        "Mengambil pengumuman untuk user:",
        user.id,
        "role:",
        user.role,
        "sekolah:",
        req.sekolah_id
      );

      const connection = await getConnection();

      let query = `
      SELECT 
        p.*,
        u.nama as pembuat_nama,
        k.nama as kelas_nama,
        u.role as pembuat_role
      FROM pengumuman p
      JOIN users u ON p.pembuat_id = u.id AND u.sekolah_id = ?
      LEFT JOIN kelas k ON p.kelas_id = k.id AND k.sekolah_id = ?
      WHERE p.sekolah_id = ?
        AND (p.tanggal_awal IS NULL OR p.tanggal_awal <= CURDATE())
        AND (p.tanggal_akhir IS NULL OR p.tanggal_akhir >= CURDATE())
    `;

      let params = [req.sekolah_id, req.sekolah_id, req.sekolah_id];

      // Filter berdasarkan role user
      if (user.role === "siswa") {
        // Untuk siswa: ambil pengumuman untuk role 'all', 'siswa', atau kelas siswa
        const [siswaData] = await connection.execute(
          "SELECT kelas_id FROM siswa WHERE id = ? AND sekolah_id = ?",
          [user.id, req.sekolah_id]
        );

        if (siswaData.length > 0) {
          const kelasId = siswaData[0].kelas_id;
          query += ` AND (
          p.role_target IN ('all', 'siswa') 
          OR (p.kelas_id = ?)
        )`;
          params.push(kelasId);
        } else {
          query += ` AND p.role_target IN ('all', 'siswa')`;
        }
      } else if (user.role === "guru") {
        // Untuk guru: ambil pengumuman untuk role 'all', 'guru', atau kelas yang diampu
        query += ` AND (
        p.role_target IN ('all', 'guru') 
        OR (p.kelas_id IN (SELECT kelas_id FROM jadwal_mengajar WHERE guru_id = ? AND sekolah_id = ?))
      )`;
        params.push(user.id, req.sekolah_id);
      } else if (user.role === "wali") {
        // Untuk wali: ambil pengumuman untuk role 'all', 'wali', atau kelas anaknya
        const [siswaData] = await connection.execute(
          "SELECT kelas_id FROM siswa WHERE id IN (SELECT siswa_id FROM users WHERE id = ?) AND sekolah_id = ?",
          [user.id, req.sekolah_id]
        );

        if (siswaData.length > 0) {
          const kelasId = siswaData[0].kelas_id;
          query += ` AND (
          p.role_target IN ('all', 'wali') 
          OR (p.kelas_id = ?)
        )`;
          params.push(kelasId);
        } else {
          query += ` AND p.role_target IN ('all', 'wali')`;
        }
      } else if (user.role === "admin") {
        // Admin bisa melihat semua pengumuman di sekolahnya
        // Tidak perlu filter tambahan
      } else {
        // Untuk role lainnya, hanya ambil pengumuman umum
        query += ` AND p.role_target = 'all'`;
      }

      query +=
        " ORDER BY CASE WHEN p.prioritas = 'penting' THEN 1 ELSE 2 END, p.created_at DESC";

      console.log("Query pengumuman:", query);
      console.log("Parameters:", params);

      const [pengumuman] = await connection.execute(query, params);
      await connection.end();

      console.log("Pengumuman untuk user ditemukan:", pengumuman.length);
      res.json(pengumuman);
    } catch (error) {
      console.error("ERROR GET PENGUMUMAN USER CURRENT:", error.message);
      console.error("Error stack:", error.stack);
      res
        .status(500)
        .json({ error: "Gagal mengambil data pengumuman: " + error.message });
    }
  }
);

// Backup endpoint untuk pengumuman
app.get(
  "/api/pengumuman/fallback",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const user = req.user;
      console.log(
        "Mengambil pengumuman fallback untuk:",
        user.role,
        "sekolah:",
        req.sekolah_id
      );

      const connection = await getConnection();

      // Query sederhana sebagai fallback
      let query = `
      SELECT 
        p.*,
        u.nama as pembuat_nama,
        k.nama as kelas_nama
      FROM pengumuman p
      JOIN users u ON p.pembuat_id = u.id AND u.sekolah_id = ?
      LEFT JOIN kelas k ON p.kelas_id = k.id AND k.sekolah_id = ?
      WHERE p.sekolah_id = ?
        AND p.role_target IN ('all', ?)
        AND (p.tanggal_awal IS NULL OR p.tanggal_awal <= CURDATE())
        AND (p.tanggal_akhir IS NULL OR p.tanggal_akhir >= CURDATE())
      ORDER BY 
        CASE WHEN p.prioritas = 'penting' THEN 1 ELSE 2 END,
        p.created_at DESC
      LIMIT 50
    `;

      const [pengumuman] = await connection.execute(query, [
        req.sekolah_id,
        req.sekolah_id,
        req.sekolah_id,
        user.role,
      ]);
      await connection.end();

      console.log("Pengumuman fallback ditemukan:", pengumuman.length);
      res.json(pengumuman);
    } catch (error) {
      console.error("ERROR GET PENGUMUMAN FALLBACK:", error.message);
      res
        .status(500)
        .json({ error: "Gagal mengambil data pengumuman fallback" });
    }
  }
);

// Create kegiatan baru
app.post("/api/kegiatan", authenticateTokenAndSchool, async (req, res) => {
  let connection;
  try {
    console.log("Menambah kegiatan baru:", req.body);
    const {
      guru_id,
      mata_pelajaran_id,
      kelas_id,
      judul,
      deskripsi,
      jenis,
      target,
      bab_id,
      sub_bab_id,
      batas_waktu,
      tanggal,
      hari,
      siswa_target,
    } = req.body;

    // Validasi data required
    if (
      !guru_id ||
      !mata_pelajaran_id ||
      !kelas_id ||
      !judul ||
      !tanggal ||
      !hari
    ) {
      return res.status(400).json({
        error: "Data tidak lengkap",
        required: [
          "guru_id",
          "mata_pelajaran_id",
          "kelas_id",
          "judul",
          "tanggal",
          "hari",
        ],
      });
    }

    const id = crypto.randomUUID();
    connection = await getConnection();

    // Cek apakah guru termasuk dalam sekolah yang sama
    const [guruCheck] = await connection.execute(
      "SELECT id FROM users WHERE id = ? AND role = 'guru' AND sekolah_id = ?",
      [guru_id, req.sekolah_id]
    );

    if (guruCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
    }

    // Cek apakah mata pelajaran termasuk dalam sekolah yang sama
    const [mapelCheck] = await connection.execute(
      "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
      [mata_pelajaran_id, req.sekolah_id]
    );

    if (mapelCheck.length === 0) {
      await connection.end();
      return res.status(404).json({
        error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
      });
    }

    // Cek apakah kelas termasuk dalam sekolah yang sama
    const [kelasCheck] = await connection.execute(
      "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
      [kelas_id, req.sekolah_id]
    );

    if (kelasCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
    }

    // Mulai transaction
    await connection.beginTransaction();

    try {
      // Insert kegiatan utama dengan sekolah_id
      await connection.execute(
        `INSERT INTO kegiatan_kelas 
         (id, guru_id, mata_pelajaran_id, kelas_id, judul, deskripsi, jenis, target, 
          bab_id, sub_bab_id, batas_waktu, tanggal, hari, sekolah_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          guru_id,
          mata_pelajaran_id,
          kelas_id,
          judul,
          deskripsi || null,
          jenis || "materi",
          target || "umum",
          bab_id || null,
          sub_bab_id || null,
          batas_waktu || null,
          tanggal,
          hari,
          req.sekolah_id, // Tambahkan sekolah_id
        ]
      );

      // Jika target khusus, insert siswa target dengan validasi
      if (target === "khusus" && siswa_target && siswa_target.length > 0) {
        // Cek apakah semua siswa termasuk dalam sekolah yang sama
        const placeholders = siswa_target.map(() => "?").join(",");
        const [siswaCheck] = await connection.execute(
          `SELECT id FROM siswa WHERE id IN (${placeholders}) AND sekolah_id = ?`,
          [...siswa_target, req.sekolah_id]
        );

        if (siswaCheck.length !== siswa_target.length) {
          await connection.rollback();
          await connection.end();
          return res.status(400).json({
            error: "Beberapa siswa tidak ditemukan atau tidak memiliki akses",
          });
        }

        for (const siswaId of siswa_target) {
          const targetId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO kegiatan_siswa_target (id, kegiatan_id, siswa_id) VALUES (?, ?, ?)",
            [targetId, id, siswaId]
          );
        }
      }

      // Commit transaction
      await connection.commit();

      console.log("Kegiatan berhasil ditambahkan:", id);

      res.status(201).json({
        message: "Kegiatan berhasil ditambahkan",
        id,
        type: "created",
      });
    } catch (transactionError) {
      // Rollback jika ada error
      await connection.rollback();
      throw transactionError;
    } finally {
      await connection.end();
    }

    // ========== KIRIM NOTIFIKASI KE WALI (SETELAH CONNECTION CLOSED) ==========
    // Jalankan async setelah response dikirim, agar tidak mengganggu user experience
    setImmediate(async () => {
      try {
        // Buat connection baru untuk notifikasi
        const notifConnection = await getConnection();

        // Dapatkan info tambahan untuk notifikasi
        const [kegiatanInfo] = await notifConnection.execute(
          `SELECT 
            kk.id, kk.judul, kk.deskripsi, kk.jenis, kk.target, kk.tanggal,
            kk.kelas_id, mp.nama as mata_pelajaran, u.nama as guru_nama
          FROM kegiatan_kelas kk
          JOIN mata_pelajaran mp ON kk.mata_pelajaran_id = mp.id
          JOIN users u ON kk.guru_id = u.id
          WHERE kk.id = ?`,
          [id]
        );

        await notifConnection.end();

        if (kegiatanInfo.length > 0) {
          const notificationData = {
            kegiatan_id: id,
            kelas_id: kegiatanInfo[0].kelas_id,
            judul: kegiatanInfo[0].judul,
            deskripsi: kegiatanInfo[0].deskripsi,
            jenis: kegiatanInfo[0].jenis,
            target: kegiatanInfo[0].target,
            mata_pelajaran: kegiatanInfo[0].mata_pelajaran,
            guru_nama: kegiatanInfo[0].guru_nama,
            tanggal: kegiatanInfo[0].tanggal,
            siswa_target: siswa_target || [],
          };

          console.log(
            "🔔 Mengirim notifikasi aktivitas kelas:",
            notificationData
          );

          // Kirim notifikasi ke wali
          const result = await sendClassActivityNotification(
            notificationData,
            req.headers["authorization"]
          );

          if (result && result.success) {
            console.log(
              `✅ Notifikasi berhasil dikirim ke ${result.sent_count} wali murid`
            );
          }
        }
      } catch (notifError) {
        console.error(
          "❌ Error dalam pengiriman notifikasi aktivitas:",
          notifError.message
        );
        console.error("Stack:", notifError.stack);
        // Jangan gagalkan proses pembuatan kegiatan hanya karena notifikasi error
      }
    });
    // ========== END KIRIM NOTIFIKASI ==========
  } catch (error) {
    console.error("ERROR CREATE KEGIATAN:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(400).json({ error: "Data referensi tidak valid" });
    }

    res
      .status(500)
      .json({ error: "Gagal menambah kegiatan: " + error.message });
  }
});

// Update kegiatan
app.put("/api/kegiatan/:id", authenticateTokenAndSchool, async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    console.log("Update kegiatan:", id, req.body);

    const {
      guru_id,
      mata_pelajaran_id,
      kelas_id,
      judul,
      deskripsi,
      jenis,
      target,
      bab_id,
      sub_bab_id,
      batas_waktu,
      tanggal,
      hari,
      siswa_target,
    } = req.body;

    connection = await getConnection();

    // Cek apakah kegiatan termasuk dalam sekolah yang sama
    const [kegiatanCheck] = await connection.execute(
      "SELECT id FROM kegiatan_kelas WHERE id = ? AND sekolah_id = ?",
      [id, req.sekolah_id]
    );

    if (kegiatanCheck.length === 0) {
      await connection.end();
      return res
        .status(404)
        .json({ error: "Kegiatan tidak ditemukan atau tidak memiliki akses" });
    }

    // Validasi data terkait jika diupdate
    if (guru_id) {
      const [guruCheck] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'guru' AND sekolah_id = ?",
        [guru_id, req.sekolah_id]
      );

      if (guruCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
      }
    }

    if (mata_pelajaran_id) {
      const [mapelCheck] = await connection.execute(
        "SELECT id FROM mata_pelajaran WHERE id = ? AND sekolah_id = ?",
        [mata_pelajaran_id, req.sekolah_id]
      );

      if (mapelCheck.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Mata pelajaran tidak ditemukan atau tidak memiliki akses",
        });
      }
    }

    if (kelas_id) {
      const [kelasCheck] = await connection.execute(
        "SELECT id FROM kelas WHERE id = ? AND sekolah_id = ?",
        [kelas_id, req.sekolah_id]
      );

      if (kelasCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Kelas tidak ditemukan atau tidak memiliki akses" });
      }
    }

    await connection.beginTransaction();

    try {
      // Update kegiatan utama
      const updateFields = [];
      const updateValues = [];

      if (guru_id) {
        updateFields.push("guru_id = ?");
        updateValues.push(guru_id);
      }
      if (mata_pelajaran_id) {
        updateFields.push("mata_pelajaran_id = ?");
        updateValues.push(mata_pelajaran_id);
      }
      if (kelas_id) {
        updateFields.push("kelas_id = ?");
        updateValues.push(kelas_id);
      }
      if (judul) {
        updateFields.push("judul = ?");
        updateValues.push(judul);
      }
      if (deskripsi !== undefined) {
        updateFields.push("deskripsi = ?");
        updateValues.push(deskripsi || null);
      }
      if (jenis) {
        updateFields.push("jenis = ?");
        updateValues.push(jenis);
      }
      if (target) {
        updateFields.push("target = ?");
        updateValues.push(target);
      }
      if (bab_id !== undefined) {
        updateFields.push("bab_id = ?");
        updateValues.push(bab_id || null);
      }
      if (sub_bab_id !== undefined) {
        updateFields.push("sub_bab_id = ?");
        updateValues.push(sub_bab_id || null);
      }
      if (batas_waktu !== undefined) {
        updateFields.push("batas_waktu = ?");
        updateValues.push(batas_waktu || null);
      }
      if (tanggal) {
        updateFields.push("tanggal = ?");
        updateValues.push(tanggal);
      }
      if (hari) {
        updateFields.push("hari = ?");
        updateValues.push(hari);
      }

      updateFields.push("updated_at = NOW()");
      updateValues.push(id, req.sekolah_id);

      if (updateFields.length > 0) {
        await connection.execute(
          `UPDATE kegiatan_kelas SET ${updateFields.join(
            ", "
          )} WHERE id = ? AND sekolah_id = ?`,
          updateValues
        );
      }

      // Hapus siswa target lama
      await connection.execute(
        "DELETE FROM kegiatan_siswa_target WHERE kegiatan_id = ?",
        [id]
      );

      // Insert siswa target baru jika target khusus
      if (target === "khusus" && siswa_target && siswa_target.length > 0) {
        // Cek apakah semua siswa termasuk dalam sekolah yang sama
        const placeholders = siswa_target.map(() => "?").join(",");
        const [siswaCheck] = await connection.execute(
          `SELECT id FROM siswa WHERE id IN (${placeholders}) AND sekolah_id = ?`,
          [...siswa_target, req.sekolah_id]
        );

        if (siswaCheck.length !== siswa_target.length) {
          await connection.rollback();
          await connection.end();
          return res.status(400).json({
            error: "Beberapa siswa tidak ditemukan atau tidak memiliki akses",
          });
        }

        for (const siswaId of siswa_target) {
          const targetId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO kegiatan_siswa_target (id, kegiatan_id, siswa_id) VALUES (?, ?, ?)",
            [targetId, id, siswaId]
          );
        }
      }

      await connection.commit();

      console.log("Kegiatan berhasil diupdate:", id);
      res.json({ message: "Kegiatan berhasil diupdate" });
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("ERROR UPDATE KEGIATAN:", error.message);
    res.status(500).json({ error: "Gagal mengupdate kegiatan" });
  }
});
// Delete kegiatan
app.delete(
  "/api/kegiatan/:id",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log("Delete kegiatan:", id, "sekolah:", req.sekolah_id);

      const connection = await getConnection();

      // Cek apakah kegiatan termasuk dalam sekolah yang sama
      const [kegiatanCheck] = await connection.execute(
        "SELECT id FROM kegiatan_kelas WHERE id = ? AND sekolah_id = ?",
        [id, req.sekolah_id]
      );

      if (kegiatanCheck.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Kegiatan tidak ditemukan atau tidak memiliki akses",
        });
      }

      // Hapus otomatis akan cascade ke kegiatan_siswa_target karena foreign key constraint
      await connection.execute(
        "DELETE FROM kegiatan_kelas WHERE id = ? AND sekolah_id = ?",
        [id, req.sekolah_id]
      );
      await connection.end();

      console.log("Kegiatan berhasil dihapus:", id);
      res.json({ message: "Kegiatan berhasil dihapus" });
    } catch (error) {
      console.error("ERROR DELETE KEGIATAN:", error.message);
      res.status(500).json({ error: "Gagal menghapus kegiatan" });
    }
  }
);

// Get jadwal untuk dropdown (disesuaikan)
app.get(
  "/api/jadwal/guru/:guruId",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { guruId } = req.params;
      const { hari, tahun_ajaran } = req.query;

      console.log(
        "Mengambil jadwal untuk form kegiatan:",
        guruId,
        "sekolah:",
        req.sekolah_id
      );

      const connection = await getConnection();

      // Cek apakah guru termasuk dalam sekolah yang sama
      const [guruCheck] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'guru' AND sekolah_id = ?",
        [guruId, req.sekolah_id]
      );

      if (guruCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Guru tidak ditemukan atau tidak memiliki akses" });
      }

      let query = `
      SELECT 
        jm.id,
        jm.kelas_id,
        k.nama as kelas_nama,
        jm.mata_pelajaran_id,
        mp.nama as mata_pelajaran_nama,
        jm.hari_id,
        h.nama as hari_nama
      FROM jadwal_mengajar jm
      JOIN kelas k ON jm.kelas_id = k.id AND k.sekolah_id = ?
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id AND mp.sekolah_id = ?
      JOIN hari h ON jm.hari_id = h.id
      WHERE jm.guru_id = ? AND jm.sekolah_id = ?
    `;

      let params = [req.sekolah_id, req.sekolah_id, guruId, req.sekolah_id];

      if (hari && hari !== "Semua Hari") {
        query += " AND h.nama = ?";
        params.push(hari);
      }

      if (tahun_ajaran) {
        query += " AND jm.tahun_ajaran = ?";
        params.push(tahun_ajaran);
      }

      query += " ORDER BY h.urutan, k.nama";

      const [jadwal] = await connection.execute(query, params);
      await connection.end();

      console.log("Jadwal ditemukan untuk form:", jadwal.length);
      res.json(jadwal);
    } catch (error) {
      console.error("ERROR GET JADWAL FORM:", error.message);
      res.status(500).json({ error: "Gagal mengambil data jadwal" });
    }
  }
);

// ==================== JENIS PEMBAYARAN (ADMIN) ====================

// Get semua jenis pembayaran
app.get(
  "/api/jenis-pembayaran",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log(
        "Mengambil data jenis pembayaran untuk sekolah:",
        req.sekolah_id
      );
      const connection = await getConnection();

      const [jenisPembayaran] = await connection.execute(
        "SELECT * FROM jenis_pembayaran WHERE sekolah_id = ? ORDER BY created_at DESC",
        [req.sekolah_id]
      );

      await connection.end();

      // Transform status: mapping Database → Flutter
      // Database: 'tidak_aktif' → Flutter: 'non-aktif'
      const transformedData = jenisPembayaran.map((item) => ({
        ...item,
        status: item.status === "tidak_aktif" ? "non-aktif" : "aktif",
      }));

      console.log(
        "Berhasil mengambil data jenis pembayaran, jumlah:",
        transformedData.length
      );
      res.json(transformedData);
    } catch (error) {
      console.error("ERROR GET JENIS PEMBAYARAN:", error.message);
      res.status(500).json({ error: "Gagal mengambil data jenis pembayaran" });
    }
  }
);

// Create jenis pembayaran
app.post(
  "/api/jenis-pembayaran",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { nama, deskripsi, jumlah, periode, status, tujuan } = req.body;

      // Normalisasi status: mapping Flutter → Database
      // Flutter: 'non-aktif' → Database: 'tidak_aktif'
      const normalizedStatus = status === "non-aktif" ? "tidak_aktif" : "aktif";

      const connection = await getConnection();
      const id = crypto.randomUUID();

      await connection.execute(
        "INSERT INTO jenis_pembayaran (id, nama, deskripsi, jumlah, periode, status, tujuan, sekolah_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          nama,
          deskripsi,
          jumlah,
          periode,
          normalizedStatus,
          JSON.stringify(tujuan),
          req.sekolah_id,
        ]
      );

      await connection.end();
      res.json({ message: "Jenis pembayaran berhasil dibuat", id });
    } catch (error) {
      console.error("ERROR CREATE JENIS PEMBAYARAN:", error.message);
      res.status(500).json({ error: "Gagal membuat jenis pembayaran" });
    }
  }
);

// Update jenis pembayaran
app.put(
  "/api/jenis-pembayaran/:id",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { nama, deskripsi, jumlah, periode, status, tujuan } = req.body;

      // Normalisasi status: mapping Flutter → Database
      // Flutter: 'non-aktif' → Database: 'tidak_aktif'
      const normalizedStatus = status === "non-aktif" ? "tidak_aktif" : "aktif";

      console.log(
        `Update jenis pembayaran: ${nama}, status: ${status} -> ${normalizedStatus}`
      );

      const connection = await getConnection();

      await connection.execute(
        "UPDATE jenis_pembayaran SET nama = ?, deskripsi = ?, jumlah = ?, periode = ?, status = ?, tujuan = ? WHERE id = ? AND sekolah_id = ?",
        [
          nama,
          deskripsi,
          jumlah,
          periode,
          normalizedStatus, // Gunakan normalizedStatus saja, BUKAN status
          JSON.stringify(tujuan),
          id,
          req.sekolah_id,
        ]
      );

      await connection.end();
      res.json({ message: "Jenis pembayaran berhasil diupdate" });
    } catch (error) {
      console.error("ERROR UPDATE JENIS PEMBAYARAN:", error.message);
      res.status(500).json({ error: "Gagal mengupdate jenis pembayaran" });
    }
  }
);

// Delete jenis pembayaran
app.delete(
  "/api/jenis-pembayaran/:id",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log("Delete jenis pembayaran:", id);

      const connection = await getConnection();

      // Cek apakah jenis pembayaran termasuk dalam sekolah yang sama
      const [existing] = await connection.execute(
        "SELECT id FROM jenis_pembayaran WHERE id = ? AND sekolah_id = ?",
        [id, req.sekolah_id]
      );

      if (existing.length === 0) {
        await connection.end();
        return res.status(404).json({
          error: "Jenis pembayaran tidak ditemukan atau tidak memiliki akses",
        });
      }

      // Cek apakah ada tagihan yang menggunakan jenis pembayaran ini
      const [tagihan] = await connection.execute(
        "SELECT id FROM tagihan WHERE jenis_pembayaran_id = ?",
        [id]
      );

      if (tagihan.length > 0) {
        await connection.end();
        return res.status(400).json({
          error:
            "Jenis pembayaran tidak dapat dihapus karena masih memiliki tagihan",
        });
      }

      await connection.execute(
        "DELETE FROM jenis_pembayaran WHERE id = ? AND sekolah_id = ?",
        [id, req.sekolah_id]
      );

      await connection.end();
      console.log("Jenis pembayaran berhasil dihapus:", id);
      res.json({ message: "Jenis pembayaran berhasil dihapus" });
    } catch (error) {
      console.error("ERROR DELETE JENIS PEMBAYARAN:", error.message);
      res.status(500).json({ error: "Gagal menghapus jenis pembayaran" });
    }
  }
);

// ==================== TAGIHAN ====================

// Generate tagihan otomatis (dijalankan via cron job)
async function generateTagihanOtomatis() {
  let connection;
  try {
    console.log("Memulai generate tagihan otomatis");
    connection = await getConnection();

    // Ambil semua jenis pembayaran aktif
    const [jenisPembayaran] = await connection.execute(
      "SELECT * FROM jenis_pembayaran WHERE status = 'aktif'"
    );

    const today = new Date();

    for (const jenis of jenisPembayaran) {
      // Tentukan jatuh tempo berdasarkan periode
      let jatuhTempo = new Date();

      switch (jenis.periode) {
        case "bulanan":
          jatuhTempo.setMonth(today.getMonth() + 1);
          break;
        case "semester":
          jatuhTempo.setMonth(today.getMonth() + 6);
          break;
        case "tahunan":
          jatuhTempo.setFullYear(today.getFullYear() + 1);
          break;
      }

      // Ambil semua siswa di sekolah
      const [siswaList] = await connection.execute(
        "SELECT id FROM siswa WHERE sekolah_id = ?",
        [jenis.sekolah_id]
      );

      for (const siswa of siswaList) {
        // Cek apakah tagihan sudah ada untuk periode ini
        const [existingTagihan] = await connection.execute(
          `SELECT id FROM tagihan 
           WHERE siswa_id = ? AND jenis_pembayaran_id = ? 
           AND YEAR(jatuh_tempo) = YEAR(?) AND MONTH(jatuh_tempo) = MONTH(?)`,
          [siswa.id, jenis.id, jatuhTempo, jatuhTempo]
        );

        if (existingTagihan.length === 0) {
          // Buat tagihan baru
          const tagihanId = crypto.randomUUID();
          await connection.execute(
            "INSERT INTO tagihan (id, siswa_id, jenis_pembayaran_id, jumlah, jatuh_tempo) VALUES (?, ?, ?, ?, ?)",
            [tagihanId, siswa.id, jenis.id, jenis.jumlah, jatuhTempo]
          );

          console.log(`Tagihan dibuat: ${tagihanId} untuk siswa ${siswa.id}`);

          // ========== KIRIM NOTIFIKASI TAGIHAN ==========
          // Ambil data lengkap untuk notifikasi
          const [tagihanInfo] = await connection.execute(
            `SELECT 
              t.id as tagihan_id,
              t.siswa_id,
              s.nama as siswa_nama,
              t.jumlah,
              t.jatuh_tempo,
              jp.nama as jenis_pembayaran_nama,
              s.sekolah_id
            FROM tagihan t
            JOIN siswa s ON t.siswa_id = s.id
            JOIN jenis_pembayaran jp ON t.jenis_pembayaran_id = jp.id
            WHERE t.id = ?`,
            [tagihanId]
          );

          if (tagihanInfo.length > 0) {
            const notifData = tagihanInfo[0];
            // Jalankan async tanpa await agar tidak menghambat proses generate
            setImmediate(async () => {
              try {
                const result = await sendTagihanNotification(notifData);
                if (result && result.success) {
                  console.log(
                    `✅ Notifikasi tagihan terkirim ke ${result.sent_count} wali`
                  );
                }
              } catch (notifError) {
                console.error(
                  `❌ Error kirim notifikasi tagihan:`,
                  notifError.message
                );
              }
            });
          }
          // ========== END KIRIM NOTIFIKASI ==========
        }
      }
    }

    await connection.end();
    console.log("Generate tagihan otomatis selesai");
  } catch (error) {
    console.error("ERROR GENERATE TAGIHAN:", error.message);
    if (connection) await connection.end();
  }
}

// Get tagihan untuk wali murid
app.get("/api/tagihan/wali", authenticateTokenAndSchool, async (req, res) => {
  try {
    console.log("Mengambil data tagihan untuk wali murid:", req.user.id);

    const connection = await getConnection();

    const [tagihan] = await connection.execute(
      `SELECT 
        t.*,
        jp.nama as jenis_pembayaran_nama,
        jp.deskripsi as jenis_pembayaran_deskripsi,
        s.nama as siswa_nama,
        s.nis,
        k.nama as kelas_nama,
        p.id as pembayaran_id,
        p.status as pembayaran_status,
        p.tanggal_bayar,
        p.bukti_bayar,
        p.admin_notes
       FROM tagihan t
       JOIN jenis_pembayaran jp ON t.jenis_pembayaran_id = jp.id
       JOIN siswa s ON t.siswa_id = s.id
       JOIN kelas k ON s.kelas_id = k.id
       LEFT JOIN pembayaran p ON t.id = p.tagihan_id
       WHERE s.sekolah_id = ? AND EXISTS (
         SELECT 1 FROM users u 
         WHERE u.siswa_id = s.id AND u.id = ? AND u.role = 'wali'
       )
       ORDER BY t.jatuh_tempo DESC`,
      [req.sekolah_id, req.user.id]
    );

    await connection.end();
    console.log("Berhasil mengambil data tagihan, jumlah:", tagihan.length);
    res.json(tagihan);
  } catch (error) {
    console.error("ERROR GET TAGIHAN WALI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data tagihan" });
  }
});

// Get semua tagihan untuk admin
app.get("/api/tagihan", authenticateTokenAndSchool, async (req, res) => {
  try {
    const { status, siswa_id, jenis_pembayaran_id } = req.query;
    console.log("Mengambil data tagihan untuk admin:", req.sekolah_id);

    let query = `
      SELECT 
        t.*,
        jp.nama as jenis_pembayaran_nama,
        s.nama as siswa_nama,
        s.nis,
        k.nama as kelas_nama,
        p.id as pembayaran_id,
        p.status as pembayaran_status,
        p.tanggal_bayar,
        p.bukti_bayar
      FROM tagihan t
      JOIN jenis_pembayaran jp ON t.jenis_pembayaran_id = jp.id
      JOIN siswa s ON t.siswa_id = s.id
      JOIN kelas k ON s.kelas_id = k.id
      LEFT JOIN pembayaran p ON t.id = p.tagihan_id
      WHERE s.sekolah_id = ?
    `;

    let params = [req.sekolah_id];

    if (status) {
      query += " AND t.status = ?";
      params.push(status);
    }

    if (siswa_id) {
      query += " AND t.siswa_id = ?";
      params.push(siswa_id);
    }

    if (jenis_pembayaran_id) {
      query += " AND t.jenis_pembayaran_id = ?";
      params.push(jenis_pembayaran_id);
    }

    query += " ORDER BY t.jatuh_tempo DESC";
    const connection = await getConnection();

    // Pagination support: if page is provided, return paginated response with metadata
    const { page, limit } = req.query;
    if (page) {
      const pg = buildPaginationQuery(page, limit || 10);

      // Count total
      const countQuery = `SELECT COUNT(*) as total FROM (${query}) as sub`;
      const [countRows] = await connection.execute(countQuery, params);
      const totalItems =
        countRows[0] && countRows[0].total
          ? parseInt(countRows[0].total, 10)
          : 0;

      const paginatedQuery = `${query} ${pg.limitClause}`;
      const [tagihan] = await connection.execute(paginatedQuery, params);

      const pagination = calculatePaginationMeta(
        totalItems,
        pg.currentPage,
        pg.perPage
      );

      await connection.end();

      console.log(
        "Berhasil mengambil data tagihan (paginated), jumlah:",
        tagihan.length
      );
      return res.json({ success: true, data: tagihan, pagination });
    }

    const [tagihan] = await connection.execute(query, params);
    await connection.end();
    console.log("Berhasil mengambil data tagihan, jumlah:", tagihan.length);
    res.json(tagihan);
  } catch (error) {
    console.error("ERROR GET TAGIHAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data tagihan" });
  }
});

// Helper function untuk format rupiah
function formatRupiah(amount) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

// Helper function untuk format tanggal Indonesia
function formatTanggalIndonesia(dateString) {
  const date = new Date(dateString);
  const options = { day: "numeric", month: "long", year: "numeric" };
  return date.toLocaleDateString("id-ID", options);
}

// Helper function: Kirim notifikasi tagihan ke wali murid
async function sendTagihanNotification(tagihanData, authHeader) {
  try {
    const {
      tagihan_id,
      siswa_id,
      siswa_nama,
      jenis_pembayaran_nama,
      jumlah,
      jatuh_tempo,
      sekolah_id,
    } = tagihanData;

    console.log(`💰 Mengirim notifikasi tagihan untuk siswa: ${siswa_nama}`);

    const connection = await getConnection();

    // Query wali murid yang terkait dengan siswa ini
    const [waliList] = await connection.execute(
      `SELECT u.id as user_id, u.nama as user_nama, u.role
       FROM users u
       WHERE u.siswa_id = ? AND u.role = 'wali' AND u.sekolah_id = ?`,
      [siswa_id, sekolah_id]
    );

    if (waliList.length === 0) {
      await connection.end();
      console.log(`⚠️  Tidak ada wali murid untuk siswa: ${siswa_nama}`);
      return { success: false, sent_count: 0 };
    }

    console.log(`📊 Target: ${waliList.length} wali murid`);

    let successCount = 0;
    let failCount = 0;

    for (const wali of waliList) {
      try {
        // Ambil FCM tokens untuk wali ini
        const [tokens] = await connection.execute(
          `SELECT token FROM fcm_tokens 
           WHERE user_id = ? AND is_active = TRUE`,
          [wali.user_id]
        );

        if (tokens.length === 0) {
          console.log(
            `⚠️  Tidak ada token aktif untuk wali: ${wali.user_nama}`
          );
          continue;
        }

        const tokenList = tokens.map((t) => t.token);

        // Siapkan data notifikasi
        const title = `💰 Tagihan Baru: ${jenis_pembayaran_nama}`;
        const body = `Tagihan ${jenis_pembayaran_nama} untuk ${siswa_nama} sebesar ${formatRupiah(
          jumlah
        )}. Jatuh tempo: ${formatTanggalIndonesia(jatuh_tempo)}`;

        const fcmData = {
          type: "tagihan",
          tagihan_id: tagihan_id,
          siswa_id: siswa_id,
          siswa_nama: siswa_nama,
          jenis_pembayaran_nama: jenis_pembayaran_nama,
          jumlah: jumlah.toString(),
          jatuh_tempo: jatuh_tempo,
          sekolah_id: sekolah_id,
          timestamp: new Date().toISOString(),
        };

        // Kirim notifikasi
        const sendResult = await sendNotificationToMultiple(
          tokenList,
          title,
          body,
          fcmData
        );

        if (sendResult.success) {
          // Simpan ke tabel notifications
          try {
            const notifId = crypto.randomUUID();
            await connection.execute(
              `INSERT INTO notifications (id, user_id, title, body, type, data, created_at)
               VALUES (?, ?, ?, ?, 'tagihan', ?, NOW())`,
              [notifId, wali.user_id, title, body, JSON.stringify(fcmData)]
            );

            console.log(`✅ Tagihan terkirim ke wali: ${wali.user_nama}`);
            successCount++;
          } catch (dbError) {
            console.error(`❌ Error save notification to DB:`, dbError.message);
          }
        } else {
          failCount++;
        }
      } catch (error) {
        console.error(
          `❌ Error mengirim tagihan ke ${wali.user_nama}:`,
          error.message
        );
        failCount++;
        continue;
      }
    }

    await connection.end();
    console.log(
      `📊 Tagihan: ${successCount} berhasil, ${failCount} gagal dari ${waliList.length} target`
    );

    return {
      success: successCount > 0,
      sent_count: successCount,
      failed_count: failCount,
      total_targets: waliList.length,
    };
  } catch (error) {
    console.error("❌ Error sending tagihan notification:", error.message);
    return { success: false, sent_count: 0 };
  }
}

// ====================END NOTIFICATION HELPERS====================

// Upload bukti pembayaran (Wali Murid)
app.post(
  "/api/pembayaran/upload",
  authenticateTokenAndSchool,
  buktiUploadMiddleware,
  async (req, res) => {
    try {
      console.log("Upload bukti pembayaran:", req.body);
      const { tagihan_id, metode_bayar, jumlah_bayar, tanggal_bayar } =
        req.body;

      if (!req.file) {
        return res
          .status(400)
          .json({ error: "Bukti pembayaran harus diupload" });
      }

      const connection = await getConnection();

      // Cek tagihan dan akses wali murid
      const [tagihanCheck] = await connection.execute(
        `SELECT t.*, s.id as siswa_id 
       FROM tagihan t
       JOIN siswa s ON t.siswa_id = s.id
       JOIN users u ON u.siswa_id = s.id
       WHERE t.id = ? AND u.id = ? AND u.role = 'wali' AND s.sekolah_id = ?`,
        [tagihan_id, req.user.id, req.sekolah_id]
      );

      if (tagihanCheck.length === 0) {
        await connection.end();
        return res
          .status(404)
          .json({ error: "Tagihan tidak ditemukan atau tidak memiliki akses" });
      }

      const tagihan = tagihanCheck[0];

      // Cek apakah sudah ada pembayaran untuk tagihan ini
      const [existingPembayaran] = await connection.execute(
        "SELECT id FROM pembayaran WHERE tagihan_id = ?",
        [tagihan_id]
      );

      let pembayaranId;

      if (existingPembayaran.length > 0) {
        // Update pembayaran yang sudah ada
        pembayaranId = existingPembayaran[0].id;
        await connection.execute(
          "UPDATE pembayaran SET metode_bayar = ?, jumlah_bayar = ?, tanggal_bayar = ?, bukti_bayar = ?, status = 'pending', admin_notes = NULL WHERE id = ?",
          [
            metode_bayar,
            jumlah_bayar,
            tanggal_bayar,
            req.file.filename,
            pembayaranId,
          ]
        );
      } else {
        // Buat pembayaran baru
        pembayaranId = crypto.randomUUID();
        await connection.execute(
          "INSERT INTO pembayaran (id, tagihan_id, metode_bayar, jumlah_bayar, tanggal_bayar, bukti_bayar, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
          [
            pembayaranId,
            tagihan_id,
            metode_bayar,
            jumlah_bayar,
            tanggal_bayar,
            req.file.filename,
          ]
        );
      }

      // Update status tagihan
      await connection.execute(
        "UPDATE tagihan SET status = 'pending' WHERE id = ?",
        [tagihan_id]
      );

      // Buat notifikasi untuk admin
      const notifId = crypto.randomUUID();
      await connection.execute(
        "INSERT INTO notifikasi (id, user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?, ?)",
        [
          notifId,
          req.user.id,
          "Pembayaran Baru",
          `Pembayaran tagihan ${tagihan.jenis_pembayaran_nama} menunggu verifikasi`,
          "verifikasi",
          pembayaranId,
        ]
      );

      await connection.end();

      console.log("Bukti pembayaran berhasil diupload:", pembayaranId);
      res.json({
        message: "Bukti pembayaran berhasil diupload dan menunggu verifikasi",
        id: pembayaranId,
      });
    } catch (error) {
      console.error("ERROR UPLOAD PEMBAYARAN:", error.message);
      res.status(500).json({ error: "Gagal mengupload bukti pembayaran" });
    }
  }
);

// Input pembayaran manual (Admin - untuk bayar offline)
app.post(
  "/api/pembayaran/manual",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Input pembayaran manual:", req.body);
      const { tagihan_id, metode_bayar, jumlah_bayar, tanggal_bayar } =
        req.body;

      const connection = await getConnection();

      // Cek tagihan
      const [tagihanCheck] = await connection.execute(
        `SELECT t.*, s.sekolah_id 
       FROM tagihan t
       JOIN siswa s ON t.siswa_id = s.id
       WHERE t.id = ? AND s.sekolah_id = ?`,
        [tagihan_id, req.sekolah_id]
      );

      if (tagihanCheck.length === 0) {
        await connection.end();
        return res.status(404).json({ error: "Tagihan tidak ditemukan" });
      }

      const pembayaranId = crypto.randomUUID();

      // Buat pembayaran dengan status verified langsung
      await connection.execute(
        "INSERT INTO pembayaran (id, tagihan_id, metode_bayar, jumlah_bayar, tanggal_bayar, status, verified_by, verified_at) VALUES (?, ?, ?, ?, ?, 'verified', ?, NOW())",
        [
          pembayaranId,
          tagihan_id,
          metode_bayar,
          jumlah_bayar,
          tanggal_bayar,
          req.user.id,
        ]
      );

      // Update status tagihan
      await connection.execute(
        "UPDATE tagihan SET status = 'verified' WHERE id = ?",
        [tagihan_id]
      );

      await connection.end();

      console.log("Pembayaran manual berhasil diinput:", pembayaranId);
      res.json({
        message: "Pembayaran manual berhasil dicatat",
        id: pembayaranId,
      });
    } catch (error) {
      console.error("ERROR INPUT PEMBAYARAN MANUAL:", error.message);
      res.status(500).json({ error: "Gagal mencatat pembayaran manual" });
    }
  }
);

// ==================== VERIFIKASI PEMBAYARAN (ADMIN) ====================

// Get pembayaran pending untuk verifikasi
app.get(
  "/api/pembayaran/pending",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log("Mengambil data pembayaran pending untuk verifikasi");

      const connection = await getConnection();

      const [pembayaran] = await connection.execute(
        `SELECT 
        p.*,
        t.jumlah as jumlah_tagihan,
        jp.nama as jenis_pembayaran_nama,
        s.nama as siswa_nama,
        s.nis,
        k.nama as kelas_nama,
        u.nama as wali_nama
       FROM pembayaran p
       JOIN tagihan t ON p.tagihan_id = t.id
       JOIN jenis_pembayaran jp ON t.jenis_pembayaran_id = jp.id
       JOIN siswa s ON t.siswa_id = s.id
       JOIN kelas k ON s.kelas_id = k.id
       JOIN users u ON u.siswa_id = s.id AND u.role = 'wali'
       WHERE p.status = 'pending' AND s.sekolah_id = ?
       ORDER BY p.created_at DESC`,
        [req.sekolah_id]
      );

      await connection.end();
      console.log(
        "Berhasil mengambil data pembayaran pending, jumlah:",
        pembayaran.length
      );
      res.json(pembayaran);
    } catch (error) {
      console.error("ERROR GET PEMBAYARAN PENDING:", error.message);
      res
        .status(500)
        .json({ error: "Gagal mengambil data pembayaran pending" });
    }
  }
);

// Verifikasi pembayaran (terima/tolak)
app.put(
  "/api/pembayaran/:id/verify",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, admin_notes } = req.body;

      console.log("Verifikasi pembayaran:", id, status);

      if (!["verified", "rejected"].includes(status)) {
        return res
          .status(400)
          .json({ error: "Status harus 'verified' atau 'rejected'" });
      }

      const connection = await getConnection();

      // Cek pembayaran
      const [pembayaranCheck] = await connection.execute(
        `SELECT p.*, t.id as tagihan_id, t.siswa_id, s.sekolah_id
       FROM pembayaran p
       JOIN tagihan t ON p.tagihan_id = t.id
       JOIN siswa s ON t.siswa_id = s.id
       WHERE p.id = ? AND s.sekolah_id = ?`,
        [id, req.sekolah_id]
      );

      if (pembayaranCheck.length === 0) {
        await connection.end();
        return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
      }

      const pembayaran = pembayaranCheck[0];

      // Update pembayaran
      await connection.execute(
        "UPDATE pembayaran SET status = ?, admin_notes = ?, verified_by = ?, verified_at = NOW() WHERE id = ?",
        [status, admin_notes || null, req.user.id, id]
      );

      // Update status tagihan
      await connection.execute("UPDATE tagihan SET status = ? WHERE id = ?", [
        status,
        pembayaran.tagihan_id,
      ]);

      // Buat notifikasi untuk wali murid
      const notifId = crypto.randomUUID();
      const title =
        status === "verified" ? "Pembayaran Diterima" : "Pembayaran Ditolak";
      const message =
        status === "verified"
          ? "Pembayaran Anda telah diverifikasi dan diterima"
          : `Pembayaran Anda ditolak: ${
              admin_notes || "Silakan hubungi admin"
            }`;

      // Cari user_id wali murid
      const [waliUser] = await connection.execute(
        "SELECT id FROM users WHERE siswa_id = ? AND role = 'wali'",
        [pembayaran.siswa_id]
      );

      if (waliUser.length > 0) {
        await connection.execute(
          "INSERT INTO notifikasi (id, user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?, ?)",
          [notifId, waliUser[0].id, title, message, "verifikasi", id]
        );
      }

      await connection.end();

      console.log("Pembayaran berhasil diverifikasi:", id);
      res.json({
        message: `Pembayaran berhasil ${
          status === "verified" ? "diverifikasi" : "ditolak"
        }`,
      });
    } catch (error) {
      console.error("ERROR VERIFY PEMBAYARAN:", error.message);
      res.status(500).json({ error: "Gagal memverifikasi pembayaran" });
    }
  }
);

// ==================== NOTIFIKASI ====================

// Get notifikasi user
app.get("/api/notifikasi", authenticateTokenAndSchool, async (req, res) => {
  try {
    console.log("Mengambil data notifikasi untuk user:", req.user.id);

    const connection = await getConnection();

    const [notifikasi] = await connection.execute(
      "SELECT * FROM notifikasi WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
      [req.user.id]
    );

    await connection.end();
    console.log(
      "Berhasil mengambil data notifikasi, jumlah:",
      notifikasi.length
    );
    res.json(notifikasi);
  } catch (error) {
    console.error("ERROR GET NOTIFIKASI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data notifikasi" });
  }
});

// Mark notifikasi sebagai read
app.put(
  "/api/notifikasi/:id/read",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log("Mark notifikasi sebagai read:", id);

      const connection = await getConnection();

      await connection.execute(
        "UPDATE notifikasi SET is_read = TRUE WHERE id = ? AND user_id = ?",
        [id, req.user.id]
      );

      await connection.end();

      console.log("Notifikasi berhasil di-mark sebagai read:", id);
      res.json({ message: "Notifikasi telah dibaca" });
    } catch (error) {
      console.error("ERROR MARK NOTIFIKASI READ:", error.message);
      res.status(500).json({ error: "Gagal mengupdate notifikasi" });
    }
  }
);

// Mark all notifikasi sebagai read
app.put(
  "/api/notifikasi/read-all",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log(
        "Mark semua notifikasi sebagai read untuk user:",
        req.user.id
      );

      const connection = await getConnection();

      await connection.execute(
        "UPDATE notifikasi SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE",
        [req.user.id]
      );

      await connection.end();

      console.log("Semua notifikasi berhasil di-mark sebagai read");
      res.json({ message: "Semua notifikasi telah dibaca" });
    } catch (error) {
      console.error("ERROR MARK ALL NOTIFIKASI READ:", error.message);
      res.status(500).json({ error: "Gagal mengupdate notifikasi" });
    }
  }
);

// ==================== LAPORAN KEUANGAN (ADMIN) ====================

// Get laporan keuangan
app.get(
  "/api/laporan-keuangan",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      const { start_date, end_date, jenis_pembayaran_id } = req.query;
      console.log("Mengambil laporan keuangan:", {
        start_date,
        end_date,
        jenis_pembayaran_id,
      });

      let query = `
      SELECT 
        p.*,
        t.jumlah as jumlah_tagihan,
        jp.nama as jenis_pembayaran_nama,
        s.nama as siswa_nama,
        s.nis,
        k.nama as kelas_nama,
        u_verifier.nama as verifier_nama
      FROM pembayaran p
      JOIN tagihan t ON p.tagihan_id = t.id
      JOIN jenis_pembayaran jp ON t.jenis_pembayaran_id = jp.id
      JOIN siswa s ON t.siswa_id = s.id
      JOIN kelas k ON s.kelas_id = k.id
      LEFT JOIN users u_verifier ON p.verified_by = u_verifier.id
      WHERE p.status = 'verified' AND s.sekolah_id = ?
    `;

      let params = [req.sekolah_id];

      if (start_date) {
        query += " AND DATE(p.tanggal_bayar) >= ?";
        params.push(start_date);
      }

      if (end_date) {
        query += " AND DATE(p.tanggal_bayar) <= ?";
        params.push(end_date);
      }

      if (jenis_pembayaran_id) {
        query += " AND jp.id = ?";
        params.push(jenis_pembayaran_id);
      }

      query += " ORDER BY p.tanggal_bayar DESC";

      const connection = await getConnection();
      const [laporan] = await connection.execute(query, params);

      // Hitung total
      const totalPendapatan = laporan.reduce(
        (sum, item) => sum + parseFloat(item.jumlah_bayar),
        0
      );

      await connection.end();

      console.log(
        "Berhasil mengambil laporan keuangan, total records:",
        laporan.length
      );
      res.json({
        data: laporan,
        summary: {
          total_pendapatan: totalPendapatan,
          total_transaksi: laporan.length,
        },
      });
    } catch (error) {
      console.error("ERROR GET LAPORAN KEUANGAN:", error.message);
      res.status(500).json({ error: "Gagal mengambil laporan keuangan" });
    }
  }
);

// Dashboard statistik keuangan
app.get(
  "/api/dashboard-keuangan",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      console.log(
        "Mengambil dashboard keuangan untuk sekolah:",
        req.sekolah_id
      );

      const connection = await getConnection();

      // Total pendapatan bulan ini
      const [pendapatanBulanIni] = await connection.execute(
        `SELECT COALESCE(SUM(p.jumlah_bayar), 0) as total
       FROM pembayaran p
       JOIN tagihan t ON p.tagihan_id = t.id
       JOIN siswa s ON t.siswa_id = s.id
       WHERE p.status = 'verified' AND s.sekolah_id = ? 
       AND MONTH(p.tanggal_bayar) = MONTH(CURRENT_DATE()) 
       AND YEAR(p.tanggal_bayar) = YEAR(CURRENT_DATE())`,
        [req.sekolah_id]
      );

      // Total tagihan belum dibayar
      const [tagihanBelumDibayar] = await connection.execute(
        `SELECT COUNT(*) as total
       FROM tagihan t
       JOIN siswa s ON t.siswa_id = s.id
       WHERE t.status = 'unpaid' AND s.sekolah_id = ?`,
        [req.sekolah_id]
      );

      // Pembayaran pending verifikasi
      const [pembayaranPending] = await connection.execute(
        `SELECT COUNT(*) as total
       FROM pembayaran p
       JOIN tagihan t ON p.tagihan_id = t.id
       JOIN siswa s ON t.siswa_id = s.id
       WHERE p.status = 'pending' AND s.sekolah_id = ?`,
        [req.sekolah_id]
      );

      // Chart data - pendapatan per bulan (6 bulan terakhir)
      const [chartData] = await connection.execute(
        `SELECT 
        DATE_FORMAT(p.tanggal_bayar, '%Y-%m') as bulan,
        SUM(p.jumlah_bayar) as total
       FROM pembayaran p
       JOIN tagihan t ON p.tagihan_id = t.id
       JOIN siswa s ON t.siswa_id = s.id
       WHERE p.status = 'verified' AND s.sekolah_id = ?
       AND p.tanggal_bayar >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(p.tanggal_bayar, '%Y-%m')
       ORDER BY bulan`,
        [req.sekolah_id]
      );

      await connection.end();

      const dashboardData = {
        pendapatan_bulan_ini: pendapatanBulanIni[0].total,
        tagihan_belum_dibayar: tagihanBelumDibayar[0].total,
        pembayaran_pending: pembayaranPending[0].total,
        chart_data: chartData,
      };

      console.log("Berhasil mengambil dashboard keuangan");
      res.json(dashboardData);
    } catch (error) {
      console.error("ERROR GET DASHBOARD KEUANGAN:", error.message);
      res.status(500).json({ error: "Gagal mengambil dashboard keuangan" });
    }
  }
);

// ==================== UTILITY FUNCTIONS ====================

// Fungsi untuk generate tagihan bulanan (bisa dijadikan cron job)
app.post(
  "/api/generate-tagihan",
  authenticateTokenAndSchool,
  async (req, res) => {
    try {
      if (req.user.role !== "admin") {
        return res
          .status(403)
          .json({ error: "Hanya admin yang dapat generate tagihan" });
      }

      await generateTagihanOtomatis();
      res.json({ message: "Generate tagihan selesai" });
    } catch (error) {
      console.error("ERROR GENERATE TAGIHAN:", error.message);
      res.status(500).json({ error: "Gagal generate tagihan" });
    }
  }
);

// Serve static files untuk bukti pembayaran
app.use(
  "/uploads/bukti-pembayaran",
  express.static(path.join(__dirname, "uploads/bukti-pembayaran"))
);

// Serve static files untuk uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// Endpoint untuk mengecek koneksi database
app.get("/api/health", async (req, res) => {
  try {
    const connection = await getConnection();
    const [result] = await connection.execute("SELECT 1 as test");
    await connection.end();
    res.json({
      status: "OK",
      database: "Connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("HEALTH CHECK ERROR:", error.message);
    res.status(500).json({
      status: "ERROR",
      database: "Disconnected",
      error: error.message,
    });
  }
});

// Endpoint untuk melihat daftar tabel yang ada
app.get("/api/debug/tables", async (req, res) => {
  try {
    const connection = await getConnection();
    const [tables] = await connection.execute("SHOW TABLES");
    await connection.end();
    res.json({ tables });
  } catch (error) {
    console.error("DEBUG TABLES ERROR:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// PERBAIKAN: Handle 404 yang benar
app.use((req, res, next) => {
  console.log("404 Not Found:", req.originalUrl);
  res.status(404).json({ error: "Endpoint tidak ditemukan" });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("UNHANDLED ERROR:", error.message);
  console.error(error.stack);
  res
    .status(500)
    .json({ error: "Terjadi kesalahan server yang tidak terduga" });
});

// async function buatHash(pw) {
//   const saltRounds = 10;
//   const hash = await bcrypt.hash(pw, saltRounds);
//   console.log("Hash baru:", hash);
// }

// buatHash("password123");
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`Database: ${dbConfig.host}/${dbConfig.database}`);

  // Test connection on startup
  getConnection()
    .then((conn) => {
      console.log("Koneksi database berhasil pada startup");
      return conn.end();
    })
    .catch((err) => {
      console.error("Koneksi database gagal pada startup:", err.message);
    });
});
