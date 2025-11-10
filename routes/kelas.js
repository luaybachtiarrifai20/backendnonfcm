const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { excelUploadMiddleware } = require("../middleware/upload");
const { generateId } = require("../utils/helpers");
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");

// Get all kelas
router.get("/", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data kelas");
    const connection = await getConnection();
    const [kelas] = await connection.execute(`
      SELECT 
        k.*, 
        u.nama as wali_kelas_nama,
        (SELECT COUNT(*) FROM siswa s WHERE s.kelas_id = k.id) as jumlah_siswa
      FROM kelas k 
      LEFT JOIN users u ON k.wali_kelas_id = u.id
    `);
    await connection.end();
    console.log("Berhasil mengambil data kelas, jumlah:", kelas.length);
    res.json(kelas);
  } catch (error) {
    console.error("ERROR GET KELAS:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kelas" });
  }
});

// Get kelas by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data kelas by ID:", id);

    const connection = await getConnection();
    const [kelas] = await connection.execute(
      "SELECT k.*, u.nama as wali_kelas_nama FROM kelas k LEFT JOIN users u ON k.wali_kelas_id = u.id WHERE k.id = ?",
      [id]
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

// Create kelas
router.post("/", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah kelas baru:", req.body);
    const { nama, wali_kelas_id, grade_level } = req.body;
    const id = generateId();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO kelas (id, nama, wali_kelas_id, grade_level) VALUES (?, ?, ?, ?)",
      [id, nama, wali_kelas_id, grade_level]
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

// Update kelas
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update kelas:", id, req.body);
    const { nama, wali_kelas_id, grade_level } = req.body;

    const connection = await getConnection();
    await connection.execute(
      "UPDATE kelas SET nama = ?, wali_kelas_id = ?, grade_level = ? WHERE id = ?",
      [nama, wali_kelas_id, grade_level, id]
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

// Delete kelas
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete kelas:", id);

    const connection = await getConnection();

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

    await connection.execute("DELETE FROM kelas WHERE id = ?", [id]);
    await connection.end();

    console.log("Kelas berhasil dihapus:", id);
    res.json({ message: "Kelas berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE KELAS:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus kelas" });
  }
});

// Import kelas dari Excel
router.post("/import", authenticateToken, excelUploadMiddleware, async (req, res) => {
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
    const result = await processClassImport(importedClasses, teacherList);

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
});

// Fungsi untuk membaca Excel kelas dari buffer
async function readExcelClassesFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const data = XLSX.utils.sheet_to_json(worksheet);
  console.log("Raw Excel data from buffer:", data);

  const classes = [];

  data.forEach((row, index) => {
    try {
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
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

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

  if (!nama || !gradeLevel) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      nama,
      gradeLevel,
    });
    return null;
  }

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
async function processClassImport(importedClasses, teacherList) {
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
        if (!classData.nama || !classData.grade_level) {
          results.failed++;
          results.errors.push(
            `Baris ${classData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

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

        await connection.beginTransaction();

        try {
          const classId = generateId();

          await connection.execute(
            "INSERT INTO kelas (id, nama, grade_level, wali_kelas_id) VALUES (?, ?, ?, ?)",
            [classId, classData.nama, classData.grade_level, waliKelasId]
          );

          await connection.commit();
          results.success++;
        } catch (transactionError) {
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

module.exports = router;