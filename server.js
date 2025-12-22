const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Railway/Render (needed for secure cookies behind HTTPS proxy)
app.set('trust proxy', 1);

// Middleware
app.use(cors({ credentials: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'payroll-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Database setup
const db = new Database('payroll.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS weeks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    start_date TEXT,
    hourly_rate REAL DEFAULT 45,
    overtime_multiplier REAL DEFAULT 1.5,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    label TEXT,
    start_date TEXT,
    hourly_rate REAL DEFAULT 45,
    overtime_multiplier REAL DEFAULT 1.5,
    times TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Please log in' });
  }
}

// Serve static files (but protect main pages)
app.use('/login.html', express.static(path.join(__dirname, 'public', 'login.html')));
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));

// Auth routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashedPassword);

    req.session.userId = result.lastInsertRowid;
    req.session.username = username;

    res.json({ success: true, username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({ success: true, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({ loggedIn: true, username: req.session.username });
  } else {
    res.json({ loggedIn: false });
  }
});

// Protected API Routes

// Get all saved weeks for current user
app.get('/api/weeks', requireAuth, (req, res) => {
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
      WHERE w.user_id = ?
      ORDER BY w.created_at DESC
    `).all(req.session.userId);

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
app.post('/api/weeks', requireAuth, (req, res) => {
  try {
    const { label, data } = req.body;

    const result = db.prepare(`
      INSERT INTO weeks (user_id, label, start_date, hourly_rate, overtime_multiplier)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.session.userId, label, data.startDate, data.hourlyRate, data.overtimeMultiplier);

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
app.delete('/api/weeks/:id', requireAuth, (req, res) => {
  try {
    // Verify ownership
    const week = db.prepare('SELECT user_id FROM weeks WHERE id = ?').get(req.params.id);
    if (!week || week.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    db.prepare('DELETE FROM time_entries WHERE week_id = ?').run(req.params.id);
    db.prepare('DELETE FROM weeks WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get autosave for current user
app.get('/api/autosave', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM autosave WHERE user_id = ?').get(req.session.userId);
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

// Save autosave for current user
app.post('/api/autosave', requireAuth, (req, res) => {
  try {
    const { weekLabel, startDate, hourlyRate, overtimeMultiplier, times } = req.body;

    const existing = db.prepare('SELECT id FROM autosave WHERE user_id = ?').get(req.session.userId);

    if (existing) {
      db.prepare(`
        UPDATE autosave SET label = ?, start_date = ?, hourly_rate = ?, overtime_multiplier = ?, times = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(weekLabel, startDate, hourlyRate, overtimeMultiplier, JSON.stringify(times), req.session.userId);
    } else {
      db.prepare(`
        INSERT INTO autosave (user_id, label, start_date, hourly_rate, overtime_multiplier, times)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(req.session.userId, weekLabel, startDate, hourlyRate, overtimeMultiplier, JSON.stringify(times));
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear autosave for current user
app.delete('/api/autosave', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM autosave WHERE user_id = ?').run(req.session.userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Protected page routes
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.redirect('/login.html');
  }
});

app.get('/history.html', (req, res) => {
  if (req.session && req.session.userId) {
    res.sendFile(path.join(__dirname, 'public', 'history.html'));
  } else {
    res.redirect('/login.html');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Payroll app running at http://localhost:${PORT}`);
});
