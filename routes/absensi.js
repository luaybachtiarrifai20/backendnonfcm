const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { generateId } = require("../utils/helpers");

// Get all absensi
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { guru_id, tanggal, mata_pelajaran_id, siswa_id } = req.query;
    console.log("Mengambil data absensi");

    let query = `
      SELECT a.*, s.nama as siswa_nama, s.nis, k.nama as kelas_nama, mp.nama as mata_pelajaran_nama
      FROM absensi a
      JOIN siswa s ON a.siswa_id = s.id
      JOIN kelas k ON s.kelas_id = k.id
      JOIN mata_pelajaran mp ON a.mata_pelajaran_id = mp.id
      WHERE 1=1
    `;
    let params = [];

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

    const connection = await getConnection();
    const [absensi] = await connection.execute(query, params);
    await connection.end();

    console.log("Berhasil mengambil data absensi, jumlah:", absensi.length);
    res.json(absensi);
  } catch (error) {
    console.error("ERROR GET ABSENSI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data absensi" });
  }
});

// Create absensi
router.post("/", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah absensi:", req.body);
    const {
      siswa_id,
      guru_id,
      mata_pelajaran_id,
      tanggal,
      status,
      keterangan,
    } = req.body;

    // Validasi data required
    const missingFields = [];
    if (!siswa_id) missingFields.push("siswa_id");
    if (!guru_id) missingFields.push("guru_id");
    if (!mata_pelajaran_id) missingFields.push("mata_pelajaran_id");
    if (!tanggal) missingFields.push("tanggal");
    if (!status) missingFields.push("status");

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: "Data tidak lengkap",
        missing_fields: missingFields,
        received_data: {
          siswa_id: !!siswa_id,
          guru_id: !!guru_id,
          mata_pelajaran_id: !!mata_pelajaran_id,
          tanggal: !!tanggal,
          status: !!status,
        },
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

    const id = generateId();

    const connection = await getConnection();

    // Cek apakah absensi sudah ada untuk kombinasi yang sama
    const [existing] = await connection.execute(
      "SELECT id FROM absensi WHERE siswa_id = ? AND mata_pelajaran_id = ? AND tanggal = ? AND guru_id = ?",
      [siswa_id, mata_pelajaran_id, tanggal, guru_id]
    );

    if (existing.length > 0) {
      // Update jika sudah ada
      await connection.execute(
        "UPDATE absensi SET status = ?, keterangan = ?, updated_at = NOW() WHERE id = ?",
        [status, keterangan || "", existing[0].id]
      );
      await connection.end();
      console.log("Absensi berhasil diupdate:", existing[0].id);
      return res.json({
        message: "Absensi berhasil diupdate",
        id: existing[0].id,
        action: "updated",
      });
    } else {
      // Insert baru
      await connection.execute(
        "INSERT INTO absensi (id, siswa_id, guru_id, mata_pelajaran_id, tanggal, status, keterangan) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          siswa_id,
          guru_id,
          mata_pelajaran_id,
          tanggal,
          status,
          keterangan || "",
        ]
      );
      await connection.end();
      console.log("Absensi berhasil ditambahkan:", id);
      return res.json({
        message: "Absensi berhasil ditambahkan",
        id,
        action: "created",
      });
    }
  } catch (error) {
    console.error("ERROR POST ABSENSI:", error.message);
    console.error("SQL Error code:", error.code);
    console.error("Error details:", error);

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

// Get absensi by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data absensi by ID:", id);

    const connection = await getConnection();
    const [absensi] = await connection.execute(
      `SELECT a.*, s.nama as siswa_nama, s.nis, k.nama as kelas_nama, 
              mp.nama as mata_pelajaran_nama, u.nama as guru_nama
       FROM absensi a
       JOIN siswa s ON a.siswa_id = s.id
       JOIN kelas k ON s.kelas_id = k.id
       JOIN mata_pelajaran mp ON a.mata_pelajaran_id = mp.id
       JOIN users u ON a.guru_id = u.id
       WHERE a.id = ?`,
      [id]
    );
    await connection.end();

    if (absensi.length === 0) {
      return res.status(404).json({ error: "Absensi tidak ditemukan" });
    }

    console.log("Berhasil mengambil data absensi:", id);
    res.json(absensi[0]);
  } catch (error) {
    console.error("ERROR GET ABSENSI BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data absensi" });
  }
});

// Update absensi
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update absensi:", id, req.body);
    const { status, keterangan } = req.body;

    // Validasi status
    const allowedStatus = ["hadir", "terlambat", "izin", "sakit", "alpha"];
    if (status && !allowedStatus.includes(status)) {
      return res.status(400).json({
        error: "Status tidak valid",
        allowed: allowedStatus,
        received: status,
      });
    }

    const connection = await getConnection();

    const updateFields = [];
    const updateValues = [];

    if (status) {
      updateFields.push("status = ?");
      updateValues.push(status);
    }

    if (keterangan !== undefined) {
      updateFields.push("keterangan = ?");
      updateValues.push(keterangan);
    }

    updateFields.push("updated_at = NOW()");
    updateValues.push(id);

    if (updateFields.length === 0) {
      await connection.end();
      return res.status(400).json({ error: "Tidak ada data yang diupdate" });
    }

    const query = `UPDATE absensi SET ${updateFields.join(", ")} WHERE id = ?`;

    await connection.execute(query, updateValues);
    await connection.end();

    console.log("Absensi berhasil diupdate:", id);
    res.json({ message: "Absensi berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT ABSENSI:", error.message);
    res.status(500).json({ error: "Gagal mengupdate absensi" });
  }
});

// Delete absensi
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete absensi:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM absensi WHERE id = ?", [id]);
    await connection.end();

    console.log("Absensi berhasil dihapus:", id);
    res.json({ message: "Absensi berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE ABSENSI:", error.message);
    res.status(500).json({ error: "Gagal menghapus absensi" });
  }
});

// Get rekap absensi
router.get("/rekap/:kelasId", authenticateToken, async (req, res) => {
  try {
    const { kelasId } = req.params;
    const { bulan, tahun } = req.query;

    console.log("Mengambil rekap absensi untuk kelas:", kelasId);

    let query = `
      SELECT 
        s.id as siswa_id,
        s.nis,
        s.nama as siswa_nama,
        COUNT(CASE WHEN a.status = 'hadir' THEN 1 END) as hadir,
        COUNT(CASE WHEN a.status = 'terlambat' THEN 1 END) as terlambat,
        COUNT(CASE WHEN a.status = 'izin' THEN 1 END) as izin,
        COUNT(CASE WHEN a.status = 'sakit' THEN 1 END) as sakit,
        COUNT(CASE WHEN a.status = 'alpha' THEN 1 END) as alpha,
        COUNT(a.id) as total
      FROM siswa s
      LEFT JOIN absensi a ON s.id = a.siswa_id
      WHERE s.kelas_id = ?
    `;

    let params = [kelasId];

    if (bulan && tahun) {
      query += " AND MONTH(a.tanggal) = ? AND YEAR(a.tanggal) = ?";
      params.push(parseInt(bulan), parseInt(tahun));
    }

    query += " GROUP BY s.id, s.nis, s.nama ORDER BY s.nama";

    const connection = await getConnection();
    const [rekap] = await connection.execute(query, params);
    await connection.end();

    console.log("Rekap absensi ditemukan:", rekap.length);
    res.json(rekap);
  } catch (error) {
    console.error("ERROR GET REKAP ABSENSI:", error.message);
    res.status(500).json({ error: "Gagal mengambil rekap absensi" });
  }
});

module.exports = router;