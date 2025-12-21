const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database setup
const db = new Database('payroll.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS weeks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    start_date TEXT,
    hourly_rate REAL DEFAULT 45,
    overtime_multiplier REAL DEFAULT 1.5,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_id INTEGER NOT NULL,
    day_index INTEGER NOT NULL,
    in1 TEXT,
    out1 TEXT,
    in2 TEXT,
    out2 TEXT,
    FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS autosave (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    label TEXT,
    start_date TEXT,
    hourly_rate REAL DEFAULT 45,
    overtime_multiplier REAL DEFAULT 1.5,
    times TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// API Routes

// Get all saved weeks
app.get('/api/weeks', (req, res) => {
  try {
    const weeks = db.prepare(`
      SELECT w.*,
        (SELECT json_group_array(json_object(
          'day_index', t.day_index,
          'in1', t.in1,
          'out1', t.out1,
          'in2', t.in2,
          'out2', t.out2
        )) FROM time_entries t WHERE t.week_id = w.id ORDER BY t.day_index) as times
      FROM weeks w
      ORDER BY w.created_at DESC
    `).all();

    const formatted = weeks.map(w => ({
      id: w.id,
      label: w.label,
      savedAt: w.created_at,
      data: {
        startDate: w.start_date,
        hourlyRate: w.hourly_rate,
        overtimeMultiplier: w.overtime_multiplier,
        times: JSON.parse(w.times || '[]').sort((a, b) => a.day_index - b.day_index)
      }
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save a new week
app.post('/api/weeks', (req, res) => {
  try {
    const { label, data } = req.body;

    const result = db.prepare(`
      INSERT INTO weeks (label, start_date, hourly_rate, overtime_multiplier)
      VALUES (?, ?, ?, ?)
    `).run(label, data.startDate, data.hourlyRate, data.overtimeMultiplier);

    const weekId = result.lastInsertRowid;

    const insertTime = db.prepare(`
      INSERT INTO time_entries (week_id, day_index, in1, out1, in2, out2)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    data.times.forEach((t, i) => {
      insertTime.run(weekId, i, t.in1 || null, t.out1 || null, t.in2 || null, t.out2 || null);
    });

    res.json({ success: true, id: weekId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a week
app.delete('/api/weeks/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM time_entries WHERE week_id = ?').run(req.params.id);
    db.prepare('DELETE FROM weeks WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get autosave
app.get('/api/autosave', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM autosave WHERE id = 1').get();
    if (row) {
      res.json({
        weekLabel: row.label,
        startDate: row.start_date,
        hourlyRate: row.hourly_rate,
        overtimeMultiplier: row.overtime_multiplier,
        times: JSON.parse(row.times || '[]')
      });
    } else {
      res.json(null);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save autosave
app.post('/api/autosave', (req, res) => {
  try {
    const { weekLabel, startDate, hourlyRate, overtimeMultiplier, times } = req.body;

    db.prepare(`
      INSERT OR REPLACE INTO autosave (id, label, start_date, hourly_rate, overtime_multiplier, times, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(weekLabel, startDate, hourlyRate, overtimeMultiplier, JSON.stringify(times));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear autosave
app.delete('/api/autosave', (req, res) => {
  try {
    db.prepare('DELETE FROM autosave WHERE id = 1').run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Payroll app running at http://localhost:${PORT}`);
});
