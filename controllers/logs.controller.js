const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const fs = require("fs");
const path = require("path");
const { getLogFilePath } = require("../writeLog");

// Get list of all log files
const listLogs = asyncHandler(async (req, res) => {
    try {
        const logsDir = path.join(__dirname, "..", "logs");

        // Check if logs directory exists
        if (!fs.existsSync(logsDir)) {
            return res.status(200).json({
                status: 200,
                message: "No logs available",
                data: [],
            });
        }

        // Read all files in logs directory
        const files = fs.readdirSync(logsDir);

        // Get base URL for download links
        const protocol = req.protocol;
        const host = req.get("host");
        const baseUrl = `${protocol}://${host}/api/v1/logs`;

        // Filter only .txt files and get their stats
        const logFiles = files
            .filter((file) => file.endsWith(".txt"))
            .map((file) => {
                const filePath = path.join(logsDir, file);
                const stats = fs.statSync(filePath);
                const date = file.replace(".txt", "");
                return {
                    filename: file,
                    date: date,
                    sizeInKB: (stats.size / 1024).toFixed(2),
                    modifiedAt: moment(stats.mtime)
                        .tz("Asia/Kolkata")
                        .format("DD-MM-YYYY HH:mm:ss"),
                    viewLink: `${baseUrl}/view/${date}`,
                    downloadLink: `${baseUrl}/download/${date}`,
                };
            })
            .sort((a, b) => new Date(b.modifiedAt.split(" ").reverse().join(" ")) - new Date(a.modifiedAt.split(" ").reverse().join(" "))); // Sort by most recent first

        res.status(200).json({
            status: 200,
            message: "Logs retrieved successfully",
            data: logFiles,
            count: logFiles.length,
        });
    } catch (error) {
        console.error("List Logs Error:", error.message);
        res.status(500).json({
            status: 500,
            message: "Failed to retrieve logs",
            error: error.message,
        });
    }
});

// Download a specific log file by date
const downloadLog = asyncHandler(async (req, res) => {
    try {
        const { date } = req.params;

        // Basic date validation format: YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({
                status: 400,
                message: "Invalid date format. Use YYYY-MM-DD",
            });
        }

        const filePath = getLogFilePath(date);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                status: 404,
                message: `Log file for date ${date} not found`,
            });
        }

        // Download the file
        res.download(filePath, `${date}_log.txt`, (err) => {
            if (err) {
                console.error("Download error:", err);
                if (!res.headersSent) {
                    return res.status(500).json({
                        status: 500,
                        message: "Failed to download log file",
                        error: err.message,
                    });
                }
            } else {
                console.log(`Log file ${date} downloaded successfully!`);
            }
        });
    } catch (error) {
        console.error("Download Log Error:", error.message);
        if (!res.headersSent) {
            res.status(500).json({
                status: 500,
                message: "Failed to download log file",
                error: error.message,
            });
        }
    }
});

// View a specific log file in browser
const viewLog = asyncHandler(async (req, res) => {
    try {
        const { date } = req.params;

        // Basic date validation format: YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({
                status: 400,
                message: "Invalid date format. Use YYYY-MM-DD",
            });
        }

        const filePath = getLogFilePath(date);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                status: 404,
                message: `Log file for date ${date} not found`,
            });
        }

        // Read the file content
        const logContent = fs.readFileSync(filePath, "utf8");

        // Set content type to plain text so browser displays it
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.send(logContent);
    } catch (error) {
        console.error("View Log Error:", error.message);
        if (!res.headersSent) {
            res.status(500).json({
                status: 500,
                message: "Failed to view log file",
                error: error.message,
            });
        }
    }
});

module.exports = {
    listLogs,
    downloadLog,
    viewLog,
};
