require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs-extra');
const { startSession } = require('./index');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;
const SESSIONS_FILE = './sessions.json';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || 'password';

app.use(express.static('frontend'));
app.use(express.json());

async function getSessions() {
    try {
        const data = await fs.readFile(SESSIONS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

async function saveSessions(sessions) {
    await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === LOGIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: 'Incorrect password' });
    }
});

app.get('/api/sessions', async (req, res) => {
    const sessions = await getSessions();
    res.json(sessions);
});

app.post('/api/sessions', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    const sessionId = `session_${phoneNumber}`;
    const sessions = await getSessions();

    if (sessions.find(s => s.id === sessionId)) {
        return res.status(400).json({ error: 'Session already exists for this number' });
    }

    try {
        const bot = await startSession(sessionId, phoneNumber, true);

        bot.ev.on('qr', (qr) => {
            io.emit('qr', { sessionId, qr });
        });

        bot.ev.on('pairing-code', (code) => {
            io.emit('pairing-code', { sessionId, code });
        });

        sessions.push({ id: sessionId, number: phoneNumber });
        await saveSessions(sessions);

        res.status(201).json({ id: sessionId, number: phoneNumber });
    } catch (error) {
        console.error('Error starting bot session:', error);
        res.status(500).json({ error: 'Failed to start bot session' });
    }
});

app.delete('/api/sessions/:id', async (req, res) => {
    const { id } = req.params;
    let sessions = await getSessions();
    const sessionIndex = sessions.findIndex(s => s.id === id);

    if (sessionIndex !== -1) {
        if (global.sessions[id]) {
            global.sessions[id].bot.end('Session deleted');
            delete global.sessions[id];
        }
        sessions.splice(sessionIndex, 1);
        await saveSessions(sessions);
        res.status(204).send();
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

async function restartSessions() {
    const sessions = await getSessions();
    for (const session of sessions) {
        console.log(`Restarting session for ${session.number}`);
        await startSession(session.id, session.number, false);
    }
}

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    restartSessions();
});