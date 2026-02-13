const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3004;

// セキュリティヘッダー
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "unpkg.com", "places.googleapis.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "unpkg.com"],
            imgSrc: ["'self'", "data:", "*.tile.openstreetmap.org", "unpkg.com"],
            connectSrc: ["'self'", "nominatim.openstreetmap.org", "places.googleapis.com"],
            fontSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// レート制限
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});

const syncLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many sync requests.' }
});

// JSONボディを解析（サイズ制限付き）
app.use(express.json({ limit: '1mb' }));

// 静的ファイルを提供
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true
}));

// SQLiteデータベース初期化
const dbPath = path.join(__dirname, 'data', 'travel-map.db');
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// WALモードでパフォーマンス向上
db.pragma('journal_mode = WAL');

// テーブル作成
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        paris_data TEXT,
        london_data TEXT,
        updated_at TEXT
    )
`);

// ユーザーデータを取得
app.get('/api/sync/:userId', syncLimiter, (req, res) => {
    const userId = req.params.userId.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!userId || userId.length < 3 || userId.length > 30) {
        return res.status(400).json({ error: 'Invalid user ID' });
    }

    try {
        const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);

        if (row) {
            const data = {
                paris: row.paris_data ? JSON.parse(row.paris_data) : null,
                london: row.london_data ? JSON.parse(row.london_data) : null,
                updatedAt: row.updated_at
            };
            res.json({ success: true, data });
        } else {
            res.json({ success: true, data: null });
        }
    } catch (e) {
        console.error('Database read error:', e);
        res.status(500).json({ error: 'Database error' });
    }
});

// ユーザーデータを保存
app.post('/api/sync/:userId', syncLimiter, (req, res) => {
    const userId = req.params.userId.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!userId || userId.length < 3 || userId.length > 30) {
        return res.status(400).json({ error: 'Invalid user ID' });
    }

    const updatedAt = new Date().toISOString();
    const parisData = req.body.paris ? JSON.stringify(req.body.paris) : null;
    const londonData = req.body.london ? JSON.stringify(req.body.london) : null;

    try {
        const stmt = db.prepare(`
            INSERT INTO users (user_id, paris_data, london_data, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                paris_data = excluded.paris_data,
                london_data = excluded.london_data,
                updated_at = excluded.updated_at
        `);

        stmt.run(userId, parisData, londonData, updatedAt);
        console.log(`Data saved for user: ${userId}`);

        res.json({ success: true, updatedAt });
    } catch (e) {
        console.error('Database write error:', e);
        res.status(500).json({ error: 'Failed to save data' });
    }
});

// 管理用：ユーザー数確認（IP制限つき）
app.get('/api/admin/stats', apiLimiter, (req, res) => {
    try {
        const count = db.prepare('SELECT COUNT(*) as count FROM users').get();
        res.json({ userCount: count.count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// メインページ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404ハンドラー
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// エラーハンドラー
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 終了時にデータベースを閉じる
process.on('SIGINT', () => {
    db.close();
    process.exit();
});

process.on('SIGTERM', () => {
    db.close();
    process.exit();
});

app.listen(PORT, () => {
    console.log(`Europe Travel Map is running on port ${PORT}`);
    console.log(`Database: ${dbPath}`);
});
