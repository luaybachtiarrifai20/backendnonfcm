const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { generateId } = require("../utils/helpers");

// Get all pengumuman
router.get("/", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data pengumuman");
    const connection = await getConnection();

    const [pengumuman] = await connection.execute(`
      SELECT 
        p.*,
        u.nama as pembuat_nama,
        k.nama as kelas_nama,
        u.role as pembuat_role
      FROM pengumuman p
      JOIN users u ON p.pembuat_id = u.id
      LEFT JOIN kelas k ON p.kelas_id = k.id
      ORDER BY 
        CASE WHEN p.prioritas = 'penting' THEN 1 ELSE 2 END,
        p.created_at DESC
    `);

    await connection.end();
    console.log(
      "Berhasil mengambil data pengumuman, jumlah:",
      pengumuman.length
    );
    res.json(pengumuman);
  } catch (error) {
    console.error("ERROR GET PENGUMUMAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data pengumuman" });
  }
});

// Get pengumuman by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data pengumuman by ID:", id);

    const connection = await getConnection();
    const [pengumuman] = await connection.execute(
      `SELECT 
        p.*,
        u.nama as pembuat_nama,
        k.nama as kelas_nama,
        u.role as pembuat_role
      FROM pengumuman p
      JOIN users u ON p.pembuat_id = u.id
      LEFT JOIN kelas k ON p.kelas_id = k.id
      WHERE p.id = ?`,
      [id]
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

// Create pengumuman
router.post("/", authenticateToken, async (req, res) => {
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

    const id = generateId();
    const pembuat_id = req.user.id; // ID user yang login

    const connection = await getConnection();

    await connection.execute(
      `INSERT INTO pengumuman 
        (id, judul, konten, kelas_id, role_target, pembuat_id, prioritas, tanggal_awal, tanggal_akhir) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ]
    );

    await connection.end();

    console.log("Pengumuman berhasil ditambahkan:", id);
    res.json({
      message: "Pengumuman berhasil ditambahkan",
      id,
    });
  } catch (error) {
    console.error("ERROR POST PENGUMUMAN:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah pengumuman" });
  }
});

// Update pengumuman
router.put("/:id", authenticateToken, async (req, res) => {
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

    await connection.execute(
      `UPDATE pengumuman 
       SET judul = ?, konten = ?, kelas_id = ?, role_target = ?, 
           prioritas = ?, tanggal_awal = ?, tanggal_akhir = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        judul,
        konten,
        kelas_id || null,
        role_target || "all",
        prioritas || "biasa",
        tanggal_awal || null,
        tanggal_akhir || null,
        id,
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
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete pengumuman:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM pengumuman WHERE id = ?", [id]);
    await connection.end();

    console.log("Pengumuman berhasil dihapus:", id);
    res.json({ message: "Pengumuman berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE PENGUMUMAN:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus pengumuman" });
  }
});

// Get pengumuman untuk user berdasarkan role dan kelas
router.get("/user/current", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    console.log(
      "Mengambil pengumuman untuk user:",
      user.id,
      "role:",
      user.role
    );

    const connection = await getConnection();

    let query = `
      SELECT 
        p.*,
        u.nama as pembuat_nama,
        k.nama as kelas_nama,
        u.role as pembuat_role
      FROM pengumuman p
      JOIN users u ON p.pembuat_id = u.id
      LEFT JOIN kelas k ON p.kelas_id = k.id
      WHERE 1=1
        AND (p.tanggal_awal IS NULL OR p.tanggal_awal <= CURDATE())
        AND (p.tanggal_akhir IS NULL OR p.tanggal_akhir >= CURDATE())
    `;

    let params = [];

    // Filter berdasarkan role user
    if (user.role === "siswa") {
      // Untuk siswa: ambil pengumuman untuk role 'all', 'siswa', atau kelas siswa
      const [siswaData] = await connection.execute(
        "SELECT kelas_id FROM siswa WHERE id = ?",
        [user.id]
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
        OR (p.kelas_id IN (SELECT kelas_id FROM jadwal_mengajar WHERE guru_id = ?))
      )`;
      params.push(user.id);
    } else if (user.role === "wali") {
      // Untuk wali: ambil pengumuman untuk role 'all', 'wali', atau kelas anaknya
      const [siswaData] = await connection.execute(
        "SELECT kelas_id FROM siswa WHERE id IN (SELECT siswa_id FROM users WHERE id = ?)",
        [user.id]
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
      // Admin bisa melihat semua pengumuman
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
});

// Backup endpoint untuk pengumuman
router.get("/fallback/current", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    console.log("Mengambil pengumuman fallback untuk:", user.role);

    const connection = await getConnection();

    // Query sederhana sebagai fallback
    let query = `
      SELECT 
        p.*,
        u.nama as pembuat_nama,
        k.nama as kelas_nama
      FROM pengumuman p
      JOIN users u ON p.pembuat_id = u.id
      LEFT JOIN kelas k ON p.kelas_id = k.id
      WHERE p.role_target IN ('all', ?)
        AND (p.tanggal_awal IS NULL OR p.tanggal_awal <= CURDATE())
        AND (p.tanggal_akhir IS NULL OR p.tanggal_akhir >= CURDATE())
      ORDER BY 
        CASE WHEN p.prioritas = 'penting' THEN 1 ELSE 2 END,
        p.created_at DESC
      LIMIT 50
    `;

    const [pengumuman] = await connection.execute(query, [user.role]);
    await connection.end();

    console.log("Pengumuman fallback ditemukan:", pengumuman.length);
    res.json(pengumuman);
  } catch (error) {
    console.error("ERROR GET PENGUMUMAN FALLBACK:", error.message);
    res.status(500).json({ error: "Gagal mengambil data pengumuman fallback" });
  }
});

module.exports = router;