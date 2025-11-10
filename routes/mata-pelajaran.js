const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { excelUploadMiddleware } = require("../middleware/upload");
const { generateId } = require("../utils/helpers");
const XLSX = require("xlsx");

// Get all mata pelajaran
router.get("/", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data mata pelajaran");
    const connection = await getConnection();
    const [mataPelajaran] = await connection.execute(
      "SELECT * FROM mata_pelajaran ORDER BY nama"
    );
    await connection.end();
    console.log(
      "Berhasil mengambil data mata pelajaran, jumlah:",
      mataPelajaran.length
    );
    res.json(mataPelajaran);
  } catch (error) {
    console.error("ERROR GET MATA PELAJARAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data mata pelajaran" });
  }
});

// Get mata pelajaran with kelas
router.get("/with-kelas", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil mata pelajaran dengan data kelas");

    const connection = await getConnection();

    const [mataPelajaran] = await connection.execute(`
      SELECT 
        mp.*,
        GROUP_CONCAT(DISTINCT k.nama) as kelas_names,
        GROUP_CONCAT(DISTINCT k.id) as kelas_ids,
        COUNT(DISTINCT k.id) as jumlah_kelas
      FROM mata_pelajaran mp
      LEFT JOIN mata_pelajaran_kelas mpk ON mp.id = mpk.mata_pelajaran_id
      LEFT JOIN kelas k ON mpk.kelas_id = k.id
      GROUP BY mp.id
      ORDER BY mp.nama
    `);

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
});

// Get mata pelajaran by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data mata pelajaran by ID:", id);

    const connection = await getConnection();
    const [mataPelajaran] = await connection.execute(
      "SELECT * FROM mata_pelajaran WHERE id = ?",
      [id]
    );
    await connection.end();

    if (mataPelajaran.length === 0) {
      return res.status(404).json({ error: "Mata pelajaran tidak ditemukan" });
    }

    console.log("Berhasil mengambil data mata pelajaran:", id);
    res.json(mataPelajaran[0]);
  } catch (error) {
    console.error("ERROR GET MATA PELAJARAN BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data mata pelajaran" });
  }
});

// Create mata pelajaran
router.post("/", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah mata pelajaran baru:", req.body);
    const { kode, nama, deskripsi } = req.body;
    const id = generateId();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO mata_pelajaran (id, kode, nama, deskripsi) VALUES (?, ?, ?, ?)",
      [id, kode, nama, deskripsi]
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
});

// Update mata pelajaran
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update mata pelajaran:", id, req.body);
    const { kode, nama, deskripsi } = req.body;

    const connection = await getConnection();
    await connection.execute(
      "UPDATE mata_pelajaran SET kode = ?, nama = ?, deskripsi = ? WHERE id = ?",
      [kode, nama, deskripsi, id]
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
});

// Delete mata pelajaran
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete mata pelajaran:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM mata_pelajaran WHERE id = ?", [id]);
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
});

// Get kelas by mata pelajaran
router.get("/:id/kelas", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil kelas untuk mata pelajaran:", id);

    const connection = await getConnection();

    const [kelas] = await connection.execute(
      `SELECT k.* 
       FROM kelas k
       JOIN mata_pelajaran_kelas mpk ON k.id = mpk.kelas_id
       WHERE mpk.mata_pelajaran_id = ?
       ORDER BY k.nama`,
      [id]
    );

    await connection.end();

    console.log("Kelas ditemukan:", kelas.length);
    res.json(kelas);
  } catch (error) {
    console.error("ERROR GET KELAS BY MATA PELAJARAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kelas" });
  }
});

// Add kelas to mata pelajaran
router.post("/:id/kelas", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { kelas_id } = req.body;
    console.log("Menambah kelas ke mata pelajaran:", {
      id,
      kelas_id,
    });

    if (!kelas_id) {
      return res
        .status(400)
        .json({ error: "kelas_id diperlukan" });
    }

    const connection = await getConnection();

    // Check if relationship already exists
    const [existing] = await connection.execute(
      "SELECT * FROM mata_pelajaran_kelas WHERE mata_pelajaran_id = ? AND kelas_id = ?",
      [id, kelas_id]
    );

    if (existing.length > 0) {
      await connection.end();
      return res
        .status(400)
        .json({ error: "Relasi mata pelajaran-kelas sudah ada" });
    }

    const relationId = generateId();
    await connection.execute(
      "INSERT INTO mata_pelajaran_kelas (id, mata_pelajaran_id, kelas_id) VALUES (?, ?, ?)",
      [relationId, id, kelas_id]
    );

    await connection.end();

    console.log("Relasi mata pelajaran-kelas berhasil ditambahkan:", relationId);
    res.json({ message: "Relasi berhasil ditambahkan", id: relationId });
  } catch (error) {
    console.error("ERROR ADD MATA PELAJARAN KELAS:", error.message);
    res
      .status(500)
      .json({ error: "Gagal menambah relasi mata pelajaran-kelas" });
  }
});

// Remove kelas from mata pelajaran
router.delete("/:id/kelas/:kelasId", authenticateToken, async (req, res) => {
  try {
    const { id, kelasId } = req.params;
    console.log("Menghapus kelas dari mata pelajaran:", {
      id,
      kelasId,
    });

    const connection = await getConnection();

    await connection.execute(
      "DELETE FROM mata_pelajaran_kelas WHERE mata_pelajaran_id = ? AND kelas_id = ?",
      [id, kelasId]
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
});

// Import mata pelajaran dari Excel
router.post("/import", authenticateToken, excelUploadMiddleware, async (req, res) => {
  let connection;
  try {
    console.log("Import mata pelajaran dari Excel (memory storage)");

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

    // Ambil data kelas untuk mapping
    connection = await getConnection();
    const [classList] = await connection.execute(
      "SELECT id, nama FROM kelas"
    );
    await connection.end();

    // Proses import
    const result = await processSubjectImport(importedSubjects, classList);

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
});

// Fungsi untuk membaca Excel mata pelajaran dari buffer
async function readExcelSubjectsFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const data = XLSX.utils.sheet_to_json(worksheet);
  console.log("Raw Excel data from buffer:", data);

  const subjects = [];

  data.forEach((row, index) => {
    try {
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
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

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

  if (!kode || !nama) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      kode,
      nama,
    });
    return null;
  }

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
async function processSubjectImport(importedSubjects, classList) {
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
        if (!subjectData.kode || !subjectData.nama) {
          results.failed++;
          results.errors.push(
            `Baris ${subjectData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        const [existingKode] = await connection.execute(
          "SELECT id FROM mata_pelajaran WHERE kode = ?",
          [subjectData.kode]
        );

        if (existingKode.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${subjectData.row_number}: Kode '${subjectData.kode}' sudah terdaftar`
          );
          continue;
        }

        await connection.beginTransaction();

        try {
          const subjectId = generateId();
          const createdAt = new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " ");
          const updatedAt = createdAt;

          await connection.execute(
            "INSERT INTO mata_pelajaran (id, kode, nama, deskripsi, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [
              subjectId,
              subjectData.kode,
              subjectData.nama,
              subjectData.deskripsi,
              createdAt,
              updatedAt,
            ]
          );

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
                const relationId = generateId();
                await connection.execute(
                  "INSERT INTO mata_pelajaran_kelas (id, mata_pelajaran_id, kelas_id) VALUES (?, ?, ?)",
                  [relationId, subjectId, classItem.id]
                );
              }
            }
          }

          await connection.commit();
          results.success++;
        } catch (transactionError) {
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

module.exports = router;