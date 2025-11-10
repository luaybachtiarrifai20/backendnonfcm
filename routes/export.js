const express = require("express");
const router = express.Router();
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

// Helper functions
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

function isValidTahunAjaran(tahunAjaran) {
  const pattern = /^\d{4}\/\d{4}$/;
  if (!pattern.test(tahunAjaran)) return false;

  const [start, end] = tahunAjaran.split("/");
  return parseInt(end) - parseInt(start) === 1;
}

// Export data absensi
router.post("/presence", authenticateToken, async (req, res) => {
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

    // Prepare data for Excel
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
      // Data rows
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
          presence.guru_nama || "",
          presence.jam_pelajaran || "",
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

// Export data nilai
router.post("/nilai", authenticateToken, async (req, res) => {
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

// Export data kelas
router.post("/classes", async (req, res) => {
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
      ["Nama Kelas", "Grade Level", "Wali Kelas", "Jumlah Siswa", "Status"],
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

router.get("/download-class-template", async (req, res) => {
  try {
    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare template data
    const templateData = [
      // Header row
      ["Nama Kelas", "Grade Level", "Wali Kelas"],
      // Example data
      ["7A", "7", "Budi Santoso"],
      ["7B", "7", "Siti Rahayu"],
      ["7B", "7", "Ahmad Wijaya"],
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

// Export data mata pelajaran
router.post("/subjects", authenticateToken, async (req, res) => {
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

    // Prepare data for Excel
    const excelData = [
      // Header row
      ["Kode*", "Nama*", "Deskripsi", "Kelas", "Status"],
      // Data rows
      ...subjects.map((subject) => [
        subject.kode || "",
        subject.nama || "",
        subject.deskripsi || "",
        getClassNames(subject),
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

// Export data RPP
router.post("/rpp", authenticateToken, async (req, res) => {
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

// Export data kegiatan kelas
router.post("/class-activities", authenticateToken, async (req, res) => {
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
});

// Export data jadwal mengajar
router.post("/schedules", authenticateToken, async (req, res) => {
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

// Helper function untuk getDayName
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

// Helper function untuk getClassNames
function getClassNames(subject) {
  if (subject.kelas_names) {
    return subject.kelas_names;
  }

  if (subject.kelas_list && Array.isArray(subject.kelas_list)) {
    return subject.kelas_list.map((kelas) => kelas.nama || "").join(", ");
  }

  return "";
}

module.exports = router;