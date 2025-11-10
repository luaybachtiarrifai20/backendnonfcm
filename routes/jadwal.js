const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { excelUploadMiddleware } = require("../middleware/upload");
const { generateId } = require("../utils/helpers");
const XLSX = require("xlsx");

// Get all jadwal mengajar
router.get("/mengajar", authenticateToken, async (req, res) => {
  try {
    const { guru_id, kelas_id, hari_id, semester_id, tahun_ajaran } = req.query;
    console.log("Mengambil data jadwal mengajar");

    let query = `
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
      JOIN users u ON jm.guru_id = u.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id
      JOIN kelas k ON jm.kelas_id = k.id
      JOIN hari h ON jm.hari_id = h.id
      JOIN semester s ON jm.semester_id = s.id
      JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
      WHERE 1=1
    `;
    let params = [];

    if (guru_id) {
      query += " AND jm.guru_id = ?";
      params.push(guru_id);
    }

    if (kelas_id) {
      query += " AND jm.kelas_id = ?";
      params.push(kelas_id);
    }

    if (hari_id) {
      query += " AND jm.hari_id = ?";
      params.push(hari_id);
    }

    if (semester_id) {
      query += " AND jm.semester_id = ?";
      params.push(semester_id);
    }

    if (tahun_ajaran) {
      query += " AND jm.tahun_ajaran = ?";
      params.push(tahun_ajaran);
    }

    query += " ORDER BY h.urutan, jp.jam_ke";

    const connection = await getConnection();
    const [jadwal] = await connection.execute(query, params);
    await connection.end();

    console.log(
      "Berhasil mengambil data jadwal mengajar, jumlah:",
      jadwal.length
    );
    res.json(jadwal);
  } catch (error) {
    console.error("ERROR GET JADWAL MENGAJAR:", error.message);
    res.status(500).json({ error: "Gagal mengambil data jadwal mengajar" });
  }
});

// Get jadwal mengajar current user
router.get("/mengajar/current", authenticateToken, async (req, res) => {
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
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id
      JOIN kelas k ON jm.kelas_id = k.id
      JOIN hari h ON jm.hari_id = h.id
      JOIN semester s ON jm.semester_id = s.id
      JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
      WHERE jm.guru_id = ?
    `;

    let params = [userId];

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

    console.log("Executing query:", query);
    console.log("With params:", params);

    const connection = await getConnection();
    const [jadwal] = await connection.execute(query, params);
    await connection.end();

    console.log("Jadwal ditemukan setelah filter:", jadwal.length);
    res.json(jadwal);
  } catch (error) {
    console.error("ERROR GET JADWAL MENGAJAR CURRENT:", error.message);
    res.status(500).json({ error: "Gagal mengambil jadwal mengajar" });
  }
});

// Create jadwal mengajar
router.post("/mengajar", authenticateToken, async (req, res) => {
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

    const id = generateId();

    const connection = await getConnection();

    // Cek konflik jadwal - guru
    const [konflikGuru] = await connection.execute(
      `SELECT jm.*, u.nama as guru_nama, jp.jam_ke 
       FROM jadwal_mengajar jm
       JOIN users u ON jm.guru_id = u.id
       JOIN jam_pelajaran jp ON jm.jam_pelajaran_id = jp.id
       WHERE jm.guru_id = ? AND jm.hari_id = ? AND jm.semester_id = ? AND jm.tahun_ajaran = ? AND jm.jam_pelajaran_id = ?`,
      [guru_id, hari_id, semester_id, tahun_ajaran, jam_pelajaran_id]
    );

    if (konflikGuru.length > 0) {
      await connection.end();
      return res.status(400).json({
        error: `Guru sudah memiliki jadwal di jam ke-${konflikGuru[0].jam_ke} pada hari yang sama`,
      });
    }

    // Cek konflik jadwal - kelas
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
      "INSERT INTO jadwal_mengajar (id, guru_id, mata_pelajaran_id, kelas_id, hari_id, jam_pelajaran_id, semester_id, tahun_ajaran) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        guru_id,
        mata_pelajaran_id,
        kelas_id,
        hari_id,
        jam_pelajaran_id,
        semester_id,
        tahun_ajaran,
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
});

// Update jadwal mengajar
router.put("/mengajar/:id", authenticateToken, async (req, res) => {
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
      "UPDATE jadwal_mengajar SET guru_id = ?, mata_pelajaran_id = ?, kelas_id = ?, hari_id = ?, jam_pelajaran_id = ?, semester_id = ?, tahun_ajaran = ? WHERE id = ?",
      [
        guru_id,
        mata_pelajaran_id,
        kelas_id,
        hari_id,
        jam_pelajaran_id,
        semester_id,
        tahun_ajaran,
        id,
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
});

// Delete jadwal mengajar
router.delete("/mengajar/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete jadwal mengajar:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM jadwal_mengajar WHERE id = ?", [id]);
    await connection.end();

    console.log("Jadwal mengajar berhasil dihapus:", id);
    res.json({ message: "Jadwal mengajar berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE JADWAL MENGAJAR:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus jadwal mengajar" });
  }
});

// Get jadwal mengajar by guru ID
router.get("/mengajar/guru/:guruId", authenticateToken, async (req, res) => {
  try {
    const { guruId } = req.params;
    const { semester_id, tahun_ajaran, hari_id } = req.query;

    console.log("Mengambil jadwal mengajar untuk guru:", guruId);

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

    let params = [guruId];

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

    const connection = await getConnection();
    const [jadwal] = await connection.execute(query, params);
    await connection.end();

    console.log("Berhasil mengambil jadwal guru, jumlah:", jadwal.length);
    res.json(jadwal);
  } catch (error) {
    console.error("ERROR GET JADWAL MENGAJAR BY GURU:", error.message);
    res.status(500).json({ error: "Gagal mengambil jadwal mengajar guru" });
  }
});

// Import jadwal mengajar dari Excel
router.post("/mengajar/import", authenticateToken, excelUploadMiddleware, async (req, res) => {
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
});

// Fungsi untuk membaca Excel jadwal mengajar dari buffer
async function readExcelSchedulesFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const data = XLSX.utils.sheet_to_json(worksheet);
  console.log("Raw Excel schedule data from buffer:", data);

  const schedules = [];

  data.forEach((row, index) => {
    try {
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
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing schedule row ${rowNumber}:`, normalizedRow);

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

        await connection.beginTransaction();

        try {
          const scheduleId = generateId();

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

          await connection.commit();
          results.success++;
        } catch (transactionError) {
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

module.exports = router;