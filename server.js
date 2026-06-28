/**
 * ═══════════════════════════════════════════════════════════
 *  AI Character Chat — Local Server
 *  Connects to Google Colab LLM via Cloudflare Tunnel
 * ═══════════════════════════════════════════════════════════
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Data directories ────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const CHARACTERS_DIR = path.join(DATA_DIR, 'characters');
const CHATS_DIR = path.join(DATA_DIR, 'chats');
const MEMORY_DIR = path.join(DATA_DIR, 'memory');

[DATA_DIR, CHARACTERS_DIR, CHATS_DIR, MEMORY_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Middleware ───────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Helper: read/write JSON ─────────────────────────────────
function readJSON(filePath, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ══════════════════════════════════════════════════════════════
//  CONFIG API — read/update .env settings
// ══════════════════════════════════════════════════════════════

app.get('/api/config', (req, res) => {
    res.json({
        baseUrl: process.env.BASE_URL || '',
        apiKey: process.env.API_KEY || 'sk-colab-local',
        modelName: process.env.MODEL_NAME || 'character1',
        port: process.env.PORT || 3000
    });
});

app.post('/api/config', (req, res) => {
    const { baseUrl, apiKey, modelName } = req.body;
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    try { envContent = fs.readFileSync(envPath, 'utf8'); } catch { }

    const updates = {};
    if (baseUrl !== undefined) updates.BASE_URL = baseUrl;
    if (apiKey !== undefined) updates.API_KEY = apiKey;
    if (modelName !== undefined) updates.MODEL_NAME = modelName;

    for (const [key, val] of Object.entries(updates)) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) {
            envContent = envContent.replace(regex, `${key}=${val}`);
        } else {
            envContent += `\n${key}=${val}`;
        }
        process.env[key] = val;
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  CHARACTER API — CRUD for character profiles
// ══════════════════════════════════════════════════════════════

app.get('/api/characters', (req, res) => {
    const files = fs.readdirSync(CHARACTERS_DIR).filter(f => f.endsWith('.json'));
    const chars = files.map(f => readJSON(path.join(CHARACTERS_DIR, f))).filter(Boolean);
    chars.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.json(chars);
});

app.get('/api/characters/:id', (req, res) => {
    const fp = path.join(CHARACTERS_DIR, `${req.params.id}.json`);
    const char = readJSON(fp);
    if (!char) return res.status(404).json({ error: 'Character not found' });
    res.json(char);
});

app.post('/api/characters', (req, res) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    const char = {
        id,
        name: req.body.name || 'Unnamed',
        avatar: req.body.avatar || '',
        personality: req.body.personality || '',
        scenario: req.body.scenario || '',
        firstMessage: req.body.firstMessage || '',
        exampleDialogue: req.body.exampleDialogue || '',
        systemPrompt: req.body.systemPrompt || '',
        tags: req.body.tags || [],
        createdAt: now,
        updatedAt: now
    };
    writeJSON(path.join(CHARACTERS_DIR, `${id}.json`), char);

    // Initialize memory for this character
    writeJSON(path.join(MEMORY_DIR, `${id}.json`), {
        characterId: id,
        facts: [],
        summaries: [],
        importantEvents: [],
        userPreferences: {},
        lastUpdated: now
    });

    res.json(char);
});

app.put('/api/characters/:id', (req, res) => {
    const fp = path.join(CHARACTERS_DIR, `${req.params.id}.json`);
    const existing = readJSON(fp);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const updated = {
        ...existing,
        name: req.body.name ?? existing.name,
        avatar: req.body.avatar ?? existing.avatar,
        personality: req.body.personality ?? existing.personality,
        scenario: req.body.scenario ?? existing.scenario,
        firstMessage: req.body.firstMessage ?? existing.firstMessage,
        exampleDialogue: req.body.exampleDialogue ?? existing.exampleDialogue,
        systemPrompt: req.body.systemPrompt ?? existing.systemPrompt,
        tags: req.body.tags ?? existing.tags,
        updatedAt: new Date().toISOString()
    };
    writeJSON(fp, updated);
    res.json(updated);
});

app.delete('/api/characters/:id', (req, res) => {
    const fp = path.join(CHARACTERS_DIR, `${req.params.id}.json`);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    // Also delete associated memory
    const memFp = path.join(MEMORY_DIR, `${req.params.id}.json`);
    if (fs.existsSync(memFp)) fs.unlinkSync(memFp);
    // Delete all chats for this character
    const chatFiles = fs.readdirSync(CHATS_DIR).filter(f => f.endsWith('.json'));
    chatFiles.forEach(f => {
        const chat = readJSON(path.join(CHATS_DIR, f));
        if (chat && chat.characterId === req.params.id) {
            fs.unlinkSync(path.join(CHATS_DIR, f));
        }
    });
    res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  CHAT HISTORY API
// ══════════════════════════════════════════════════════════════

// List all chats for a character
app.get('/api/chats/:characterId', (req, res) => {
    const files = fs.readdirSync(CHATS_DIR).filter(f => f.endsWith('.json'));
    const chats = files
        .map(f => readJSON(path.join(CHATS_DIR, f)))
        .filter(c => c && c.characterId === req.params.characterId)
        .map(c => ({
            id: c.id,
            characterId: c.characterId,
            title: c.title || 'Untitled Chat',
            messageCount: (c.messages || []).length,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt
        }));
    chats.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.json(chats);
});

// Get full chat
app.get('/api/chat/:chatId', (req, res) => {
    const fp = path.join(CHATS_DIR, `${req.params.chatId}.json`);
    const chat = readJSON(fp);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
});

// Create new chat
app.post('/api/chats', (req, res) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    const chat = {
        id,
        characterId: req.body.characterId,
        title: req.body.title || 'New Chat',
        messages: req.body.messages || [],
        createdAt: now,
        updatedAt: now
    };
    writeJSON(path.join(CHATS_DIR, `${id}.json`), chat);
    res.json(chat);
});

// Update chat (add messages, rename, etc.)
app.put('/api/chat/:chatId', (req, res) => {
    const fp = path.join(CHATS_DIR, `${req.params.chatId}.json`);
    const existing = readJSON(fp);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const updated = {
        ...existing,
        title: req.body.title ?? existing.title,
        messages: req.body.messages ?? existing.messages,
        updatedAt: new Date().toISOString()
    };
    writeJSON(fp, updated);
    res.json(updated);
});

// Delete chat
app.delete('/api/chat/:chatId', (req, res) => {
    const fp = path.join(CHATS_DIR, `${req.params.chatId}.json`);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  MEMORY API — Persistent memory for each character
// ══════════════════════════════════════════════════════════════

app.get('/api/memory/:characterId', (req, res) => {
    const fp = path.join(MEMORY_DIR, `${req.params.characterId}.json`);
    const mem = readJSON(fp, {
        characterId: req.params.characterId,
        facts: [],
        summaries: [],
        importantEvents: [],
        userPreferences: {},
        lastUpdated: new Date().toISOString()
    });
    res.json(mem);
});

app.put('/api/memory/:characterId', (req, res) => {
    const fp = path.join(MEMORY_DIR, `${req.params.characterId}.json`);
    const existing = readJSON(fp, { characterId: req.params.characterId, facts: [], summaries: [], importantEvents: [], userPreferences: {} });
    const updated = {
        ...existing,
        facts: req.body.facts ?? existing.facts,
        summaries: req.body.summaries ?? existing.summaries,
        importantEvents: req.body.importantEvents ?? existing.importantEvents,
        userPreferences: req.body.userPreferences ?? existing.userPreferences,
        lastUpdated: new Date().toISOString()
    };
    writeJSON(fp, updated);
    res.json(updated);
});

// ══════════════════════════════════════════════════════════════
//  FETCH WITH RETRY — handles Cloudflare 524 timeout errors
// ══════════════════════════════════════════════════════════════

/**
 * Fetch with automatic retry for Cloudflare transient errors.
 * Cloudflare free tunnels timeout at ~100s (error 524).
 * This retries up to maxRetries times with increasing wait.
 */
async function fetchWithRetry(url, options, maxRetries = 2) {
    const TIMEOUT_MS = 120000; // 120 seconds per attempt
    const RETRYABLE_CODES = [524, 502, 503, 504, 408];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // If retryable error and not last attempt, retry
            if (RETRYABLE_CODES.includes(response.status) && attempt < maxRetries) {
                const waitSec = (attempt + 1) * 5;
                console.log(`⚠️  Got ${response.status}, retrying in ${waitSec}s... (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                continue;
            }

            return response;

        } catch (err) {
            if (err.name === 'AbortError' && attempt < maxRetries) {
                const waitSec = (attempt + 1) * 5;
                console.log(`⚠️  Request timed out, retrying in ${waitSec}s... (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                continue;
            }
            throw err;
        }
    }
}

/**
 * Parse error response — strips HTML and returns clean message
 */
function parseErrorResponse(status, text) {
    // Cloudflare error pages are HTML — extract the useful part
    if (text.includes('trycloudflare.com') || text.includes('cloudflare')) {
        if (status === 524) return 'Colab server timeout (524). Model mungkin sedang warm-up atau overloaded. Coba lagi dalam 30 detik.';
        if (status === 502) return 'Colab server down (502). Pastikan notebook Colab masih berjalan.';
        if (status === 503) return 'Colab server unavailable (503). Cek notebook Colab.';
        if (status === 504) return 'Gateway timeout (504). Model terlalu lama merespons.';
        return `Cloudflare error ${status}. Cek apakah Colab notebook masih aktif.`;
    }
    // Truncate if too long
    if (text.length > 300) return text.substring(0, 300) + '...';
    return text;
}

// ══════════════════════════════════════════════════════════════
//  CHAT COMPLETION PROXY — Forward to Colab LLM with memory
// ══════════════════════════════════════════════════════════════

app.post('/api/chat/send', async (req, res) => {
    const { characterId, chatId, userMessage } = req.body;

    if (!characterId || !chatId || !userMessage) {
        return res.status(400).json({ error: 'Missing characterId, chatId, or userMessage' });
    }

    const baseUrl = process.env.BASE_URL;
    const apiKey = process.env.API_KEY || 'sk-colab-local';
    const modelName = process.env.MODEL_NAME || 'character1';

    if (!baseUrl || baseUrl.includes('your-colab-url')) {
        return res.status(400).json({ error: 'Please configure your Colab BASE_URL in Settings first.' });
    }

    // Load character
    const char = readJSON(path.join(CHARACTERS_DIR, `${characterId}.json`));
    if (!char) return res.status(404).json({ error: 'Character not found' });

    // Load memory
    const memory = readJSON(path.join(MEMORY_DIR, `${characterId}.json`), {
        facts: [], summaries: [], importantEvents: [], userPreferences: {}
    });

    // Load chat history
    const chatFp = path.join(CHATS_DIR, `${chatId}.json`);
    const chat = readJSON(chatFp);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    // ── Build system prompt with memory ──
    let systemParts = [];

    // Core character identity
    systemParts.push(`You are ${char.name}. You must stay in character at all times.`);

    if (char.personality) {
        systemParts.push(`\n## Personality & Description\n${char.personality}`);
    }
    if (char.scenario) {
        systemParts.push(`\n## Current Scenario\n${char.scenario}`);
    }
    if (char.systemPrompt) {
        systemParts.push(`\n## Additional Instructions\n${char.systemPrompt}`);
    }
    if (char.exampleDialogue) {
        systemParts.push(`\n## Example Dialogue Style\n${char.exampleDialogue}`);
    }

    // Inject persistent memory
    if (memory.facts && memory.facts.length > 0) {
        systemParts.push(`\n## Important Facts You Remember\n${memory.facts.map(f => `- ${f}`).join('\n')}`);
    }
    if (memory.importantEvents && memory.importantEvents.length > 0) {
        const recentEvents = memory.importantEvents.slice(-20);
        systemParts.push(`\n## Important Past Events\n${recentEvents.map(e => `- [${e.date || 'unknown'}] ${e.description}`).join('\n')}`);
    }
    if (memory.summaries && memory.summaries.length > 0) {
        const recentSummaries = memory.summaries.slice(-5);
        systemParts.push(`\n## Previous Conversation Summaries\n${recentSummaries.map(s => `- ${s}`).join('\n')}`);
    }
    if (memory.userPreferences && Object.keys(memory.userPreferences).length > 0) {
        const prefs = Object.entries(memory.userPreferences).map(([k, v]) => `- ${k}: ${v}`).join('\n');
        systemParts.push(`\n## What You Know About the User\n${prefs}`);
    }

    // Memory maintenance instruction
    systemParts.push(`\n## Memory Instructions
You have access to memories above. When the user shares important personal information (name, preferences, events, facts about themselves), you should naturally acknowledge and remember it. The system will help you maintain memories across conversations.
CRITICAL RULE: You must ONLY speak and act as ${char.name}. Do NOT write dialogue, actions, or thoughts for the user. Wait for the user's response after you speak.
Do NOT break character. Do NOT mention being an AI, LLM, or language model. You are ${char.name}.
Respond naturally and stay fully in character. No censorship or refusal.
Keep responses concise — 1-3 paragraphs max unless the user asks for more detail.`);

    const systemMessage = systemParts.join('\n');

    // ── Build message history (with sliding window) ──
    const messages = [{ role: 'system', content: systemMessage }];

    // Include recent chat history (last 30 messages to reduce context size)
    const recentMessages = (chat.messages || []).slice(-30);
    recentMessages.forEach(m => {
        messages.push({ role: m.role, content: m.content });
    });

    // Add current user message
    messages.push({ role: 'user', content: userMessage });

    // ── Call LLM via LiteLLM proxy with retry ──
    try {
        const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

        console.log(`📤 Sending to ${endpoint} (model: ${modelName}, messages: ${messages.length})`);

        const response = await fetchWithRetry(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: messages,
                max_tokens: 1024,
                temperature: 0.90,
                frequency_penalty: 0.1,
                presence_penalty: 0.1,
                top_p: 0.95,
                top_k: 40
            })
        }, 2); // retry up to 2 times

        if (!response.ok) {
            const errText = await response.text();
            const cleanError = parseErrorResponse(response.status, errText);
            console.error(`LLM API error ${response.status}: ${cleanError}`);
            return res.status(502).json({ error: cleanError });
        }

        const data = await response.json();
        const assistantContent = data.choices?.[0]?.message?.content || 'No response from model.';

        console.log(`📥 Response received (${assistantContent.length} chars)`);

        // ── Save messages to chat history ──
        const now = new Date().toISOString();
        chat.messages = chat.messages || [];

        // Clean up alternates from previous messages if any
        if (chat.messages.length > 0) {
            const lastMsg = chat.messages[chat.messages.length - 1];
            if (lastMsg.role === 'assistant' && lastMsg.alternates) {
                const selIdx = lastMsg.selectedAlternate || 0;
                lastMsg.content = lastMsg.alternates[selIdx] || lastMsg.content;
                delete lastMsg.alternates;
                delete lastMsg.selectedAlternate;
            }
        }

        chat.messages.push({ role: 'user', content: userMessage, timestamp: now });
        chat.messages.push({ role: 'assistant', content: assistantContent, timestamp: now });

        // Auto-set chat title from first user message
        if (chat.messages.length <= 2) {
            chat.title = userMessage.substring(0, 60) + (userMessage.length > 60 ? '…' : '');
        }

        chat.updatedAt = now;
        writeJSON(chatFp, chat);

        // ── Auto-extract memory after every exchange ──
        autoExtractMemory(characterId, userMessage, assistantContent, memory);

        res.json({
            content: assistantContent,
            chatId: chat.id,
            messageIndex: chat.messages.length - 1
        });

    } catch (err) {
        console.error('Fetch error:', err);
        const msg = err.name === 'AbortError'
            ? 'Request timed out setelah 120 detik. Model Colab mungkin overloaded. Coba kirim pesan yang lebih pendek atau tunggu 1 menit.'
            : `Connection failed: ${err.message}. Cek BASE_URL dan pastikan Colab masih running.`;
        res.status(500).json({ error: msg });
    }
});

// ══════════════════════════════════════════════════════════════
//  CHAT REGENERATE PROXY
// ══════════════════════════════════════════════════════════════

app.post('/api/chat/regenerate', async (req, res) => {
    const { characterId, chatId } = req.body;

    if (!characterId || !chatId) {
        return res.status(400).json({ error: 'Missing characterId or chatId' });
    }

    const baseUrl = process.env.BASE_URL;
    const apiKey = process.env.API_KEY || 'sk-colab-local';
    const modelName = process.env.MODEL_NAME || 'character1';

    if (!baseUrl || baseUrl.includes('your-colab-url')) {
        return res.status(400).json({ error: 'Please configure your Colab BASE_URL in Settings first.' });
    }

    const char = readJSON(path.join(CHARACTERS_DIR, `${characterId}.json`));
    const memory = readJSON(path.join(MEMORY_DIR, `${characterId}.json`), { facts: [], summaries: [], importantEvents: [], userPreferences: {} });
    const chatFp = path.join(CHATS_DIR, `${chatId}.json`);
    const chat = readJSON(chatFp);

    if (!char || !chat || !chat.messages || chat.messages.length === 0) {
        return res.status(404).json({ error: 'Not found or empty chat' });
    }

    const lastMsg = chat.messages[chat.messages.length - 1];
    if (lastMsg.role !== 'assistant') {
        return res.status(400).json({ error: 'Last message is not from assistant' });
    }

    let systemParts = [];
    systemParts.push(`You are ${char.name}. You must stay in character at all times.`);
    if (char.personality) systemParts.push(`\n## Personality & Description\n${char.personality}`);
    if (char.scenario) systemParts.push(`\n## Current Scenario\n${char.scenario}`);
    if (char.systemPrompt) systemParts.push(`\n## Additional Instructions\n${char.systemPrompt}`);
    if (char.exampleDialogue) systemParts.push(`\n## Example Dialogue Style\n${char.exampleDialogue}`);
    if (memory.facts && memory.facts.length > 0) systemParts.push(`\n## Important Facts You Remember\n${memory.facts.map(f => `- ${f}`).join('\n')}`);
    if (memory.importantEvents && memory.importantEvents.length > 0) systemParts.push(`\n## Important Past Events\n${memory.importantEvents.slice(-20).map(e => `- [${e.date || 'unknown'}] ${e.description}`).join('\n')}`);
    if (memory.summaries && memory.summaries.length > 0) systemParts.push(`\n## Previous Conversation Summaries\n${memory.summaries.slice(-5).map(s => `- ${s}`).join('\n')}`);
    if (memory.userPreferences && Object.keys(memory.userPreferences).length > 0) {
        systemParts.push(`\n## What You Know About the User\n${Object.entries(memory.userPreferences).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`);
    }
    systemParts.push(`\n## Memory Instructions\nYou have access to memories above. When the user shares important personal information, you should naturally acknowledge and remember it.\nCRITICAL RULE: You must ONLY speak and act as ${char.name}. Do NOT write dialogue, actions, or thoughts for the user. Wait for the user's response after you speak.\nDo NOT break character. You are ${char.name}.\nRespond naturally and stay fully in character.\nKeep responses concise — 1-3 paragraphs max unless the user asks for more detail.`);

    const systemMessage = systemParts.join('\n');
    const messages = [{ role: 'system', content: systemMessage }];

    // Include all but the last assistant message
    const recentMessages = chat.messages.slice(-30, -1);
    recentMessages.forEach(m => messages.push({ role: m.role, content: m.content }));

    try {
        const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
        const response = await fetchWithRetry(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: modelName,
                messages: messages,
                max_tokens: 1024,
                temperature: 0.90,
                frequency_penalty: 0.1,
                presence_penalty: 0.1,
                top_p: 0.95,
                top_k: 40
            })
        }, 2);

        if (!response.ok) {
            const errText = await response.text();
            return res.status(502).json({ error: parseErrorResponse(response.status, errText) });
        }

        const data = await response.json();
        const assistantContent = data.choices?.[0]?.message?.content || 'No response from model.';

        if (!lastMsg.alternates) {
            lastMsg.alternates = [lastMsg.content];
        }

        lastMsg.alternates.push(assistantContent);
        lastMsg.selectedAlternate = lastMsg.alternates.length - 1;
        chat.updatedAt = new Date().toISOString();
        writeJSON(chatFp, chat);

        res.json({
            content: assistantContent,
            alternates: lastMsg.alternates,
            selectedAlternate: lastMsg.selectedAlternate,
            chatId: chat.id,
            messageIndex: chat.messages.length - 1
        });
    } catch (err) {
        const msg = err.name === 'AbortError' ? 'Request timed out.' : `Connection failed: ${err.message}`;
        res.status(500).json({ error: msg });
    }
});

// Set selected alternate
app.put('/api/chat/:chatId/alternate', (req, res) => {
    const { messageIndex, selectedAlternate } = req.body;
    const fp = path.join(CHATS_DIR, `${req.params.chatId}.json`);
    const chat = readJSON(fp);
    if (!chat || !chat.messages || !chat.messages[messageIndex]) return res.status(404).json({ error: 'Not found' });

    chat.messages[messageIndex].selectedAlternate = selectedAlternate;
    writeJSON(fp, chat);
    res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  EDIT MESSAGE
// ══════════════════════════════════════════════════════════════

app.put('/api/chat/:chatId/message', (req, res) => {
    const { messageIndex, content } = req.body;
    const fp = path.join(CHATS_DIR, `${req.params.chatId}.json`);
    const chat = readJSON(fp);
    
    if (!chat || !chat.messages || !chat.messages[messageIndex]) {
        return res.status(404).json({ error: 'Chat or message not found' });
    }

    // Update the specific message
    chat.messages[messageIndex].content = content;
    
    // Also clear alternates for this message since it was manually edited
    if (chat.messages[messageIndex].alternates) {
        delete chat.messages[messageIndex].alternates;
        delete chat.messages[messageIndex].selectedAlternate;
    }

    chat.updatedAt = new Date().toISOString();
    writeJSON(fp, chat);
    
    res.json({ ok: true });
});

/**
 * Auto-extract memory from conversations using keyword heuristics.
 * This runs after every exchange to pick up important facts.
 */
function autoExtractMemory(characterId, userMsg, assistantMsg, memory) {
    const fp = path.join(MEMORY_DIR, `${characterId}.json`);
    let changed = false;
    const lower = userMsg.toLowerCase();

    // Detect user sharing personal info
    const namePatterns = [
        /(?:nama\s+(?:ku|saya|aku|gue|gw)\s+(?:adalah\s+)?|my\s+name\s+is\s+|call\s+me\s+|panggil\s+(?:saya|aku|gue|gw)\s+)(\w+)/i
    ];
    for (const p of namePatterns) {
        const m = userMsg.match(p);
        if (m) {
            memory.userPreferences = memory.userPreferences || {};
            memory.userPreferences['nama'] = m[1];
            changed = true;
        }
    }

    // Detect age
    const ageMatch = userMsg.match(/(?:umur\s*(?:ku|saya|aku)\s*|(?:i\s+am|i'm)\s+)(\d{1,3})\s*(?:tahun|years?|th)?/i);
    if (ageMatch) {
        memory.userPreferences = memory.userPreferences || {};
        memory.userPreferences['umur'] = ageMatch[1];
        changed = true;
    }

    // Detect preferences (suka/like, tidak suka/dislike)
    const likeMatch = userMsg.match(/(?:aku|saya|gue|gw|i)\s+(?:suka|like|love|senang|hobby)\s+(.+)/i);
    if (likeMatch) {
        memory.facts = memory.facts || [];
        const fact = `User menyukai: ${likeMatch[1].trim()}`;
        if (!memory.facts.includes(fact)) {
            memory.facts.push(fact);
            changed = true;
        }
    }

    const dislikeMatch = userMsg.match(/(?:aku|saya|gue|gw|i)\s+(?:tidak suka|benci|hate|dislike|nggak suka|ga suka)\s+(.+)/i);
    if (dislikeMatch) {
        memory.facts = memory.facts || [];
        const fact = `User tidak suka: ${dislikeMatch[1].trim()}`;
        if (!memory.facts.includes(fact)) {
            memory.facts.push(fact);
            changed = true;
        }
    }

    // Keep memory size manageable
    if (memory.facts && memory.facts.length > 100) {
        memory.facts = memory.facts.slice(-100);
    }
    if (memory.importantEvents && memory.importantEvents.length > 50) {
        memory.importantEvents = memory.importantEvents.slice(-50);
    }

    if (changed) {
        memory.lastUpdated = new Date().toISOString();
        writeJSON(fp, memory);
    }
}

// ══════════════════════════════════════════════════════════════
//  AI-POWERED MEMORY SUMMARIZATION
// ══════════════════════════════════════════════════════════════

app.post('/api/memory/:characterId/summarize', async (req, res) => {
    const { chatId } = req.body;
    const characterId = req.params.characterId;

    const baseUrl = process.env.BASE_URL;
    const apiKey = process.env.API_KEY || 'sk-colab-local';
    const modelName = process.env.MODEL_NAME || 'character1';

    if (!baseUrl || baseUrl.includes('your-colab-url')) {
        return res.status(400).json({ error: 'Configure BASE_URL first' });
    }

    // Load chat
    const chat = readJSON(path.join(CHATS_DIR, `${chatId}.json`));
    if (!chat || !chat.messages || chat.messages.length < 4) {
        return res.status(400).json({ error: 'Not enough messages to summarize' });
    }

    // Ask LLM to extract memory
    const conversationText = chat.messages.map(m =>
        `${m.role === 'user' ? 'User' : 'Character'}: ${m.content}`
    ).join('\n');

    try {
        const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
        const response = await fetchWithRetry(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    {
                        role: 'system',
                        content: `You are a memory extraction assistant. Analyze the conversation below and extract:
1. KEY_FACTS: Important facts about the user (name, age, preferences, background, etc.) - one per line
2. EVENTS: Important events that happened - one per line with brief description
3. SUMMARY: A 2-3 sentence summary of this conversation

Output ONLY in this exact format:
KEY_FACTS:
- fact1
- fact2
EVENTS:
- event1
- event2
SUMMARY:
summary text here`
                    },
                    { role: 'user', content: conversationText }
                ],
                max_tokens: 1024,
                temperature: 0.3
            })
        }, 2);

        if (!response.ok) {
            return res.status(500).json({ error: 'LLM summarization failed' });
        }

        const data = await response.json();
        const result = data.choices?.[0]?.message?.content || '';

        // Parse extraction
        const memFp = path.join(MEMORY_DIR, `${characterId}.json`);
        const memory = readJSON(memFp, {
            characterId, facts: [], summaries: [],
            importantEvents: [], userPreferences: {}
        });

        // Extract facts
        const factsMatch = result.match(/KEY_FACTS:\s*\n([\s\S]*?)(?=EVENTS:|SUMMARY:|$)/);
        if (factsMatch) {
            const newFacts = factsMatch[1].split('\n')
                .map(l => l.replace(/^-\s*/, '').trim())
                .filter(l => l.length > 0);
            newFacts.forEach(f => {
                if (!memory.facts.includes(f)) memory.facts.push(f);
            });
        }

        // Extract events
        const eventsMatch = result.match(/EVENTS:\s*\n([\s\S]*?)(?=SUMMARY:|$)/);
        if (eventsMatch) {
            const newEvents = eventsMatch[1].split('\n')
                .map(l => l.replace(/^-\s*/, '').trim())
                .filter(l => l.length > 0)
                .map(e => ({ description: e, date: new Date().toISOString().split('T')[0] }));
            memory.importantEvents.push(...newEvents);
        }

        // Extract summary
        const summaryMatch = result.match(/SUMMARY:\s*\n?([\s\S]*?)$/);
        if (summaryMatch) {
            const summary = summaryMatch[1].trim();
            if (summary) memory.summaries.push(summary);
        }

        memory.lastUpdated = new Date().toISOString();
        writeJSON(memFp, memory);

        res.json({ ok: true, memory });
    } catch (err) {
        console.error('Summarize error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════
//  CONNECTION TEST
// ══════════════════════════════════════════════════════════════

app.get('/api/test-connection', async (req, res) => {
    const baseUrl = process.env.BASE_URL;
    const apiKey = process.env.API_KEY || 'sk-colab-local';

    if (!baseUrl || baseUrl.includes('your-colab-url')) {
        return res.json({ ok: false, error: 'BASE_URL not configured' });
    }

    try {
        const healthUrl = `${baseUrl.replace(/\/$/, '')}/health`;
        const response = await fetch(healthUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000)
        });
        if (response.ok) {
            const data = await response.json().catch(() => ({}));
            return res.json({ ok: true, status: response.status, data });
        }
        return res.json({ ok: false, status: response.status });
    } catch (err) {
        return res.json({ ok: false, error: err.message });
    }
});

// ── SPA fallback ────────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║   🌐  AI Character Chat — Running!                          ║`);
    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    console.log(`║   Local  : http://localhost:${PORT}                            ║`);
    console.log(`║   Network: http://0.0.0.0:${PORT}                             ║`);
    console.log(`║   Colab  : ${(process.env.BASE_URL || 'NOT SET').substring(0, 47).padEnd(47)}║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
});
