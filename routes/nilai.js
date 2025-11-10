const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { generateId } = require("../utils/helpers");

// Get all nilai
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { siswa_id, guru_id, mata_pelajaran_id, jenis } = req.query;
    console.log("Mengambil data nilai");

    let query = `
      SELECT n.*, s.nama as siswa_nama, s.nis, mp.nama as mata_pelajaran_nama
      FROM nilai n
      JOIN siswa s ON n.siswa_id = s.id
      JOIN mata_pelajaran mp ON n.mata_pelajaran_id = mp.id
      WHERE 1=1
    `;
    let params = [];

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

// Create nilai
router.post("/", authenticateToken, async (req, res) => {
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
    const id = generateId();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO nilai (id, siswa_id, guru_id, mata_pelajaran_id, jenis, nilai, deskripsi, tanggal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        siswa_id,
        guru_id,
        mata_pelajaran_id,
        jenis,
        nilaiValue,
        deskripsi,
        tanggal,
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

// Get nilai by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data nilai by ID:", id);

    const connection = await getConnection();
    const [nilai] = await connection.execute(
      "SELECT n.*, s.nama as siswa_nama, s.nis, mp.nama as mata_pelajaran_nama FROM nilai n JOIN siswa s ON n.siswa_id = s.id JOIN mata_pelajaran mp ON n.mata_pelajaran_id = mp.id WHERE n.id = ?",
      [id]
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

// Update nilai
router.put("/:id", authenticateToken, async (req, res) => {
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

// Delete nilai
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete nilai:", id);

    const connection = await getConnection();
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

// Get rekap nilai siswa
router.get("/siswa/:siswaId/rekap", authenticateToken, async (req, res) => {
  try {
    const { siswaId } = req.params;
    const { semester, tahun_ajaran } = req.query;

    console.log("Mengambil rekap nilai untuk siswa:", siswaId);

    let query = `
      SELECT 
        mp.nama as mata_pelajaran,
        mp.kode,
        AVG(CASE WHEN n.jenis = 'harian' THEN n.nilai END) as rata_harian,
        AVG(CASE WHEN n.jenis = 'tugas' THEN n.nilai END) as rata_tugas,
        AVG(CASE WHEN n.jenis = 'ulangan' THEN n.nilai END) as rata_ulangan,
        AVG(CASE WHEN n.jenis = 'uts' THEN n.nilai END) as nilai_uts,
        AVG(CASE WHEN n.jenis = 'uas' THEN n.nilai END) as nilai_uas,
        AVG(n.nilai) as rata_rata,
        COUNT(n.id) as total_nilai
      FROM nilai n
      JOIN mata_pelajaran mp ON n.mata_pelajaran_id = mp.id
      WHERE n.siswa_id = ?
    `;

    let params = [siswaId];

    if (semester && tahun_ajaran) {
      // Asumsi ada kolom semester dan tahun_ajaran di tabel nilai
      query += " AND n.semester = ? AND n.tahun_ajaran = ?";
      params.push(semester, tahun_ajaran);
    }

    query += " GROUP BY mp.id, mp.nama, mp.kode ORDER BY mp.nama";

    const connection = await getConnection();
    const [rekap] = await connection.execute(query, params);
    await connection.end();

    console.log("Rekap nilai ditemukan:", rekap.length);
    res.json(rekap);
  } catch (error) {
    console.error("ERROR GET REKAP NILAI:", error.message);
    res.status(500).json({ error: "Gagal mengambil rekap nilai" });
  }
});

// Get nilai by siswa dan mata pelajaran
router.get("/siswa/:siswaId/mapel/:mataPelajaranId", authenticateToken, async (req, res) => {
  try {
    const { siswaId, mataPelajaranId } = req.params;
    console.log("Mengambil nilai siswa:", siswaId, "mapel:", mataPelajaranId);

    const connection = await getConnection();
    const [nilai] = await connection.execute(
      `SELECT n.*, mp.nama as mata_pelajaran_nama, s.nama as siswa_nama
       FROM nilai n
       JOIN mata_pelajaran mp ON n.mata_pelajaran_id = mp.id
       JOIN siswa s ON n.siswa_id = s.id
       WHERE n.siswa_id = ? AND n.mata_pelajaran_id = ?
       ORDER BY n.jenis, n.tanggal`,
      [siswaId, mataPelajaranId]
    );

    await connection.end();

    console.log("Nilai ditemukan:", nilai.length);
    res.json(nilai);
  } catch (error) {
    console.error("ERROR GET NILAI SISWA MAPEL:", error.message);
    res.status(500).json({ error: "Gagal mengambil data nilai" });
  }
});

module.exports = router;