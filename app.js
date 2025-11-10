require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));


const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306, // default value jika tidak ada
};

const JWT_SECRET = "secret_key_yang_aman_dan_unik";

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

// Serve static files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Buat direktori uploads jika belum ada
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log("Created uploads directory:", uploadDir);
}

// Import routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const kelasRoutes = require("./routes/kelas");
const siswaRoutes = require("./routes/siswa");
const guruRoutes = require("./routes/guru");
const mataPelajaranRoutes = require("./routes/mata-pelajaran");
const absensiRoutes = require("./routes/absensi");
const nilaiRoutes = require("./routes/nilai");
const jadwalRoutes = require("./routes/jadwal");
const materiRoutes = require("./routes/materi");
const rppRoutes = require("./routes/rpp");
const kegiatanRoutes = require("./routes/kegiatan");
const pengumumanRoutes = require("./routes/pengumuman");
const exportRoutes = require("./routes/export");
const { authenticateToken } = require("./middleware/auth");

// Use routes
app.use("/api/", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/kelas", kelasRoutes);
app.use("/api/siswa", siswaRoutes);
app.use("/api/guru", guruRoutes);
app.use("/api/mata-pelajaran", mataPelajaranRoutes);
app.use("/api/absensi", absensiRoutes);
app.use("/api/nilai", nilaiRoutes);
app.use("/api/jadwal", jadwalRoutes);
app.use("/api/materi", materiRoutes);
app.use("/api/rpp", rppRoutes);
app.use("/api/kegiatan", kegiatanRoutes);
app.use("/api/pengumuman", pengumumanRoutes);
app.use("/api/export", exportRoutes);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Sistem Manajemen Sekolah API",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      users: "/api/users",
      kelas: "/api/kelas",
      siswa: "/api/siswa",
      guru: "/api/guru",
      mataPelajaran: "/api/mata-pelajaran",
      absensi: "/api/absensi",
      nilai: "/api/nilai",
      jadwal: "/api/jadwal",
      materi: "/api/materi",
      rpp: "/api/rpp",
      kegiatan: "/api/kegiatan",
      pengumuman: "/api/pengumuman",
      export: "/api/export",
    },
  });
});

app.get("/api/kelas-by-mata-pelajaran", authenticateToken, async (req, res) => {
  try {
    const { mata_pelajaran_id } = req.query;
    console.log("Mengambil kelas untuk mata pelajaran:", mata_pelajaran_id);

    if (!mata_pelajaran_id) {
      return res
        .status(400)
        .json({ error: "Parameter mata_pelajaran_id diperlukan" });
    }

    const connection = await getConnection();

    const [kelas] = await connection.execute(
      `SELECT k.* 
       FROM kelas k
       JOIN mata_pelajaran_kelas mpk ON k.id = mpk.kelas_id
       WHERE mpk.mata_pelajaran_id = ?
       ORDER BY k.nama`,
      [mata_pelajaran_id]
    );

    await connection.end();

    console.log("Kelas ditemukan:", kelas.length);
    res.json(kelas);
  } catch (error) {
    console.error("ERROR GET KELAS BY MATA PELAJARAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kelas" });
  }
});

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


const PORT = process.env.PORT || 3000;


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

module.exports = app;