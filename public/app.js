/**
 * ═══════════════════════════════════════════════════════════
 *  AI Character Chat — Frontend Application
 * ═══════════════════════════════════════════════════════════
 */

// ── State ────────────────────────────────────────────────
let state = {
    characters: [],
    currentCharacterId: null,
    currentChatId: null,
    chats: [],
    memory: null,
    sending: false,
    config: {}
};

// ── DOM Refs ─────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Avatar Helper ────────────────────────────────────────
function getAvatarInnerHtml(avatar, name) {
    if (avatar && avatar.startsWith('data:')) {
        return `<img src="${avatar}" alt="${escapeHtml(name || 'avatar')}">`;
    }
    return avatar || (name ? name.charAt(0).toUpperCase() : 'A');
}

function updateAvatarPreview(avatarData) {
    const preview = $('#avatar-preview');
    const removeBtn = $('#avatar-remove-btn');
    if (!preview || !removeBtn) return;
    if (avatarData && avatarData.startsWith('data:')) {
        preview.innerHTML = `<img src="${avatarData}" alt="avatar">`;
        preview.classList.add('has-image');
        removeBtn.style.display = 'flex';
    } else {
        preview.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>Upload</span>`;
        preview.classList.remove('has-image');
        removeBtn.style.display = 'none';
    }
}

// ── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    await loadCharacters();
    testConnection();
    bindEvents();
});

// ══════════════════════════════════════════════════════════
//  API Helpers
// ══════════════════════════════════════════════════════════

async function api(method, url, body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    return res.json();
}

// ══════════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════════

async function loadConfig() {
    state.config = await api('GET', '/api/config');
    $('#cfg-base-url').value = state.config.baseUrl || '';
    $('#cfg-api-key').value = state.config.apiKey || 'sk-colab-local';
    $('#cfg-model').value = state.config.modelName || 'character1';
}

async function saveConfig() {
    const baseUrl = $('#cfg-base-url').value.trim();
    const apiKey = $('#cfg-api-key').value.trim();
    const modelName = $('#cfg-model').value;

    await api('POST', '/api/config', { baseUrl, apiKey, modelName });
    state.config = { baseUrl, apiKey, modelName };
    toast('Settings saved!', 'success');
    closeModal('modal-settings');
    testConnection();
}

async function testConnection() {
    const result = await api('GET', '/api/test-connection');
    const statusDot = $('.status-dot');
    const statusText = $('.status-text');
    const resultEl = $('#connection-result');

    if (result.ok) {
        statusDot.className = 'status-dot online';
        statusText.textContent = 'Connected to Colab';
        if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.className = 'connection-result success';
            resultEl.textContent = '✅ Connection successful! Server is healthy.';
        }
    } else {
        statusDot.className = 'status-dot offline';
        statusText.textContent = result.error || 'Disconnected';
        if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.className = 'connection-result error';
            resultEl.textContent = `❌ ${result.error || 'Connection failed'}`;
        }
    }
}

// ══════════════════════════════════════════════════════════
//  CHARACTERS
// ══════════════════════════════════════════════════════════

async function loadCharacters() {
    state.characters = await api('GET', '/api/characters');
    renderCharacterList();
}

function renderCharacterList() {
    const list = $('#character-list');
    if (state.characters.length === 0) {
        list.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
                Belum ada karakter.<br>Buat karakter pertama mu! ✨
            </div>`;
        return;
    }

    list.innerHTML = state.characters.map(c => `
        <div class="character-item ${c.id === state.currentCharacterId ? 'active' : ''}"
             data-id="${c.id}" onclick="selectCharacter('${c.id}')">
            <div class="character-item-avatar">${getAvatarInnerHtml(c.avatar, c.name)}</div>
            <div class="character-item-info">
                <div class="character-item-name">${escapeHtml(c.name)}</div>
                <div class="character-item-desc">${escapeHtml((c.personality || '').substring(0, 50))}</div>
            </div>
        </div>
    `).join('');
}

async function selectCharacter(id) {
    state.currentCharacterId = id;
    state.currentChatId = null;
    renderCharacterList();

    // Load chats for this character
    state.chats = await api('GET', `/api/chats/${id}`);
    renderChatList();

    const char = state.characters.find(c => c.id === id);
    if (!char) return;

    // Update chat header
    $('#chat-header-name').textContent = char.name;
    $('#chat-header-avatar').innerHTML = getAvatarInnerHtml(char.avatar, char.name);

    // If there are existing chats, load the most recent one
    if (state.chats.length > 0) {
        await loadChat(state.chats[0].id);
    } else {
        // Start a new chat automatically
        await startNewChat();
    }

    // Switch to chat view
    showView('view-chat');
    closeSidebarOnMobile();
}

// ── Character CRUD ──

function openCharacterEditor(editId = null) {
    const char = editId ? state.characters.find(c => c.id === editId) : null;

    $('#char-modal-title').textContent = char ? '✏️ Edit Karakter' : '✨ Buat Karakter Baru';
    $('#char-edit-id').value = editId || '';
    $('#char-name').value = char ? char.name : '';
    $('#char-avatar').value = char ? (char.avatar || '') : '';
    // Update avatar preview after modal opens
    setTimeout(() => updateAvatarPreview($('#char-avatar').value), 50);
    $('#char-personality').value = char ? (char.personality || '') : '';
    $('#char-scenario').value = char ? (char.scenario || '') : '';
    $('#char-first-message').value = char ? (char.firstMessage || '') : '';
    $('#char-example').value = char ? (char.exampleDialogue || '') : '';
    $('#char-system').value = char ? (char.systemPrompt || '') : '';
    $('#btn-delete-character').style.display = char ? 'flex' : 'none';

    openModal('modal-character');
    closeSidebarOnMobile();
}

async function saveCharacter() {
    const editId = $('#char-edit-id').value;
    const data = {
        name: $('#char-name').value.trim() || 'Unnamed',
        avatar: $('#char-avatar').value.trim(),
        personality: $('#char-personality').value.trim(),
        scenario: $('#char-scenario').value.trim(),
        firstMessage: $('#char-first-message').value.trim(),
        exampleDialogue: $('#char-example').value.trim(),
        systemPrompt: $('#char-system').value.trim()
    };

    if (editId) {
        await api('PUT', `/api/characters/${editId}`, data);
        toast('Character updated!', 'success');
    } else {
        const newChar = await api('POST', '/api/characters', data);
        toast('Character created!', 'success');
        state.currentCharacterId = newChar.id;
    }

    closeModal('modal-character');
    await loadCharacters();

    if (state.currentCharacterId) {
        selectCharacter(state.currentCharacterId);
    }
}

async function deleteCharacter() {
    const editId = $('#char-edit-id').value;
    if (!editId) return;
    if (!confirm('Hapus karakter ini beserta semua chat dan memory?')) return;

    await api('DELETE', `/api/characters/${editId}`);
    toast('Character deleted', 'success');
    closeModal('modal-character');

    state.currentCharacterId = null;
    state.currentChatId = null;
    await loadCharacters();
    showView('view-welcome');
}

// ══════════════════════════════════════════════════════════
//  CHATS
// ══════════════════════════════════════════════════════════

function renderChatList() {
    const listTitle = $('#chat-list-title');
    const list = $('#chat-list');

    if (!state.currentCharacterId || state.chats.length === 0) {
        listTitle.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    listTitle.style.display = 'block';
    list.innerHTML = state.chats.map(c => `
        <div class="chat-item ${c.id === state.currentChatId ? 'active' : ''}"
             data-id="${c.id}" onclick="loadChat('${c.id}')">
            <span class="chat-item-icon">💬</span>
            <span class="chat-item-title">${escapeHtml(c.title)}</span>
            <div class="chat-item-actions">
                <button class="chat-item-edit" onclick="event.stopPropagation(); startRenameChat('${c.id}')" title="Rename">✏️</button>
                <button class="chat-item-delete" onclick="event.stopPropagation(); deleteChat('${c.id}')" title="Delete">✕</button>
            </div>
        </div>
    `).join('');
}

async function startNewChat() {
    if (!state.currentCharacterId) return;

    const char = state.characters.find(c => c.id === state.currentCharacterId);
    const initialMessages = [];

    // Add first message if character has one
    if (char && char.firstMessage) {
        initialMessages.push({
            role: 'assistant',
            content: char.firstMessage,
            timestamp: new Date().toISOString()
        });
    }

    const chat = await api('POST', '/api/chats', {
        characterId: state.currentCharacterId,
        title: 'New Chat',
        messages: initialMessages
    });

    state.currentChatId = chat.id;

    // Reload chat list
    state.chats = await api('GET', `/api/chats/${state.currentCharacterId}`);
    renderChatList();
    renderMessages(chat.messages || []);
    showView('view-chat');
    closeSidebarOnMobile();
}

async function loadChat(chatId) {
    const chat = await api('GET', `/api/chat/${chatId}`);
    if (!chat || chat.error) return;

    state.currentChatId = chatId;
    renderChatList();
    renderMessages(chat.messages || []);
    closeSidebarOnMobile();
}

async function deleteChat(chatId) {
    if (!confirm('Hapus chat ini?')) return;
    await api('DELETE', `/api/chat/${chatId}`);

    if (state.currentChatId === chatId) {
        state.currentChatId = null;
    }

    state.chats = await api('GET', `/api/chats/${state.currentCharacterId}`);
    renderChatList();

    if (state.chats.length > 0) {
        await loadChat(state.chats[0].id);
    } else {
        await startNewChat();
    }
}

// ══════════════════════════════════════════════════════════
//  MESSAGES
// ══════════════════════════════════════════════════════════

function renderMessages(messages) {
    const container = $('#chat-messages');
    const char = state.characters.find(c => c.id === state.currentCharacterId);
    const charAvatar = char ? getAvatarInnerHtml(char.avatar, char.name) : 'A';

    if (!messages || messages.length === 0) {
        container.innerHTML = `
            <div class="empty-chat">
                <div class="empty-chat-icon">💬</div>
                <p>Mulai percakapan...</p>
            </div>`;
        return;
    }

    container.innerHTML = messages.map((m, index) => {
        const time = m.timestamp ? formatTime(m.timestamp) : '';
        const avatar = m.role === 'user' ? '👤' : charAvatar;
        const isLastAssistant = m.role === 'assistant' && index === messages.length - 1;

        let contentHtml = formatMessageContent(m.content);
        let alternatesHtml = '';

        if (m.alternates && m.alternates.length > 1) {
            const total = m.alternates.length;
            const current = (m.selectedAlternate || 0) + 1;
            alternatesHtml = `
                <div class="alternate-nav">
                    <button onclick="changeAlternate(${index}, -1)">&lt;</button>
                    <span>${current}/${total}</span>
                    <button onclick="changeAlternate(${index}, 1)">&gt;</button>
                </div>
            `;
            const selIdx = m.selectedAlternate || 0;
            contentHtml = formatMessageContent(m.alternates[selIdx] || m.content);
        }

        const regenerateBtn = isLastAssistant ? `<button class="regenerate-btn" onclick="regenerateLastMessage()" title="Regenerate">🔄</button>` : '';
        const touchEvents = isLastAssistant ? 'ontouchstart="handleTouchStart(event)" ontouchend="handleTouchEnd(event, this)"' : '';

        return `
            <div class="message ${m.role}" data-index="${index}">
                <div class="message-avatar">${avatar}</div>
                <div style="flex:1; min-width:0;">
                    <div class="message-bubble-container" ${touchEvents}>
                        <div class="message-bubble" style="width:100%">${contentHtml}</div>
                        ${regenerateBtn}
                    </div>
                    ${alternatesHtml}
                    <div class="message-meta">
                        ${time ? `<span class="message-time">${time}</span>` : ''}
                        <button class="message-action-btn" onclick="editMessage(${index})" title="Edit">✏️</button>
                    </div>
                </div>
            </div>`;
    }).join('');

    scrollToBottom();
}

function appendMessage(role, content, isLastAssistant = false) {
    const container = $('#chat-messages');
    const char = state.characters.find(c => c.id === state.currentCharacterId);
    const charAvatar = char ? getAvatarInnerHtml(char.avatar, char.name) : 'A';

    const empty = container.querySelector('.empty-chat');
    if (empty) empty.remove();

    if (isLastAssistant) {
        $$('.regenerate-btn').forEach(btn => btn.remove());
        $$('.message-bubble-container').forEach(c => {
            c.removeAttribute('ontouchstart');
            c.removeAttribute('ontouchend');
            c.classList.remove('swiped-left');
        });
    }

    const avatar = role === 'user' ? '👤' : charAvatar;
    const time = formatTime(new Date().toISOString());
    const regenerateBtn = isLastAssistant ? `<button class="regenerate-btn" onclick="regenerateLastMessage()" title="Regenerate">🔄</button>` : '';
    const touchEvents = isLastAssistant ? 'ontouchstart="handleTouchStart(event)" ontouchend="handleTouchEnd(event, this)"' : '';

    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div style="flex:1; min-width:0;">
            <div class="message-bubble-container" ${touchEvents}>
                <div class="message-bubble" style="width:100%">${formatMessageContent(content)}</div>
                ${regenerateBtn}
            </div>
            <div class="message-meta">
                <span class="message-time">${time}</span>
                <button class="message-action-btn" onclick="editMessage(${document.querySelectorAll('#chat-messages .message').length})" title="Edit">✏️</button>
            </div>
        </div>`;
    container.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    const container = $('#chat-messages');
    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
    });
}

// ══════════════════════════════════════════════════════════
//  SEND MESSAGE
// ══════════════════════════════════════════════════════════

async function sendMessage() {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text || state.sending) return;
    if (!state.currentCharacterId || !state.currentChatId) return;

    state.sending = true;
    input.value = '';
    autoResizeInput();

    // Show user message immediately
    appendMessage('user', text);

    // Show typing indicator
    $('#typing-indicator').style.display = 'flex';
    $('#btn-send').disabled = true;

    try {
        const result = await api('POST', '/api/chat/send', {
            characterId: state.currentCharacterId,
            chatId: state.currentChatId,
            userMessage: text
        });

        $('#typing-indicator').style.display = 'none';

        if (result.error) {
            toast(result.error, 'error');
            return;
        }

        // Show assistant response
        appendMessage('assistant', result.content, true);

        // Refresh chat list (title might have changed)
        state.chats = await api('GET', `/api/chats/${state.currentCharacterId}`);
        renderChatList();

    } catch (err) {
        $('#typing-indicator').style.display = 'none';
        toast(`Error: ${err.message}`, 'error');
    } finally {
        state.sending = false;
        $('#btn-send').disabled = false;
        input.focus();
    }
}

// ══════════════════════════════════════════════════════════
//  REGENERATE & ALTERNATES
// ══════════════════════════════════════════════════════════

let touchStartX = 0;
window.handleTouchStart = function (e) {
    touchStartX = e.changedTouches[0].screenX;
};
window.handleTouchEnd = function (e, element) {
    let touchEndX = e.changedTouches[0].screenX;
    if (touchStartX - touchEndX > 40) {
        element.classList.add('swiped-left');
    } else if (touchEndX - touchStartX > 40) {
        element.classList.remove('swiped-left');
    }
};

window.regenerateLastMessage = async function () {
    if (!state.currentCharacterId || !state.currentChatId || state.sending) return;

    state.sending = true;
    const btn = document.querySelector('.regenerate-btn');
    if (btn) btn.innerHTML = '<span class="spinner"></span>';

    try {
        const result = await api('POST', '/api/chat/regenerate', {
            characterId: state.currentCharacterId,
            chatId: state.currentChatId
        });

        if (result.error) {
            toast(result.error, 'error');
            return;
        }

        const chat = await api('GET', `/api/chat/${state.currentChatId}`);
        if (chat && !chat.error) {
            renderMessages(chat.messages || []);
        }
    } catch (err) {
        toast(`Error: ${err.message}`, 'error');
    } finally {
        state.sending = false;
        if (btn) btn.innerHTML = '🔄';
    }
};

window.changeAlternate = async function (msgIndex, delta) {
    const chat = await api('GET', `/api/chat/${state.currentChatId}`);
    if (!chat || chat.error) return;
    const msg = chat.messages[msgIndex];
    if (!msg || !msg.alternates) return;

    let sel = msg.selectedAlternate || 0;
    sel += delta;
    if (sel < 0) sel = 0;
    if (sel >= msg.alternates.length) sel = msg.alternates.length - 1;

    msg.selectedAlternate = sel;

    // Optimistic re-render
    renderMessages(chat.messages);

    await api('PUT', `/api/chat/${state.currentChatId}/alternate`, {
        messageIndex: msgIndex,
        selectedAlternate: sel
    });
};

window.editMessage = async function (index) {
    const chat = await api('GET', `/api/chat/${state.currentChatId}`);
    if (!chat || chat.error) return;
    const msg = chat.messages[index];
    if (!msg) return;

    const messageDiv = document.querySelector(`.message[data-index="${index}"]`);
    if (!messageDiv) return;

    const msgEl = messageDiv.querySelector('.message-bubble-container');
    const metaEl = messageDiv.querySelector('.message-meta');
    const alternatesEl = messageDiv.querySelector('.alternate-nav');

    const originalContent = msg.alternates ? (msg.alternates[msg.selectedAlternate || 0] || msg.content) : msg.content;

    if (msgEl) msgEl.style.display = 'none';
    if (metaEl) metaEl.style.display = 'none';
    if (alternatesEl) alternatesEl.style.display = 'none';

    const editContainer = document.createElement('div');
    editContainer.className = 'message-edit-container';
    editContainer.id = `edit-container-${index}`;
    editContainer.innerHTML = `
        <textarea class="message-edit-textarea" id="edit-textarea-${index}">${escapeHtml(originalContent)}</textarea>
        <div class="message-edit-actions">
            <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.85rem;" onclick="cancelEdit(${index})">Batal</button>
            <button class="btn-primary" style="padding: 6px 12px; font-size: 0.85rem;" onclick="saveEdit(${index})">Simpan</button>
        </div>
    `;

    msgEl.parentNode.insertBefore(editContainer, msgEl);

    messageDiv.classList.add('is-editing');

    const textarea = document.getElementById(`edit-textarea-${index}`);
    const resizeTextarea = () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.max(120, textarea.scrollHeight) + 'px';
    };
    textarea.addEventListener('input', resizeTextarea);
    setTimeout(resizeTextarea, 0);
};

window.cancelEdit = function (index) {
    const editContainer = document.getElementById(`edit-container-${index}`);
    if (editContainer) editContainer.remove();

    const messageDiv = document.querySelector(`.message[data-index="${index}"]`);
    if (!messageDiv) return;

    const msgEl = messageDiv.querySelector('.message-bubble-container');
    const metaEl = messageDiv.querySelector('.message-meta');
    const alternatesEl = messageDiv.querySelector('.alternate-nav');

    if (msgEl) msgEl.style.display = '';
    if (metaEl) metaEl.style.display = 'flex';
    if (alternatesEl) alternatesEl.style.display = 'flex';

    messageDiv.classList.remove('is-editing');
};

window.saveEdit = async function (index) {
    const textarea = document.getElementById(`edit-textarea-${index}`);
    if (!textarea) return;

    const newContent = textarea.value.trim();
    if (!newContent) return cancelEdit(index);

    const btn = textarea.nextElementSibling.querySelector('.btn-primary');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const result = await api('PUT', `/api/chat/${state.currentChatId}/message`, {
            messageIndex: index,
            content: newContent
        });

        if (result.error) {
            toast(result.error, 'error');
            btn.disabled = false;
            btn.textContent = 'Simpan';
            return;
        }

        await loadChat(state.currentChatId);
    } catch (err) {
        toast(`Error: ${err.message}`, 'error');
        btn.disabled = false;
        btn.textContent = 'Simpan';
    }
};

// ══════════════════════════════════════════════════════════
//  MEMORY
// ══════════════════════════════════════════════════════════

async function openMemoryViewer() {
    if (!state.currentCharacterId) return;

    const char = state.characters.find(c => c.id === state.currentCharacterId);
    $('#memory-char-name').textContent = char ? char.name : 'Character';

    state.memory = await api('GET', `/api/memory/${state.currentCharacterId}`);
    renderMemory();
    openModal('modal-memory');
    closeSidebarOnMobile();
}

function renderMemory() {
    const mem = state.memory;
    if (!mem) return;

    // Facts
    const factsEl = $('#memory-facts');
    factsEl.innerHTML = (mem.facts || []).map((f, i) => `
        <div class="memory-item">
            <span class="memory-item-text">${escapeHtml(f)}</span>
            <button class="memory-item-delete" onclick="removeMemoryItem('facts', ${i})">✕</button>
        </div>
    `).join('') || '<div style="color:var(--text-muted); font-size:0.8rem; padding:8px">Belum ada fakta tersimpan</div>';

    // User preferences
    const prefsEl = $('#memory-user-prefs');
    const prefs = mem.userPreferences || {};
    prefsEl.innerHTML = Object.entries(prefs).map(([k, v]) => `
        <div class="memory-item">
            <span class="memory-item-key">${escapeHtml(k)}</span>
            <span class="memory-item-text">${escapeHtml(v)}</span>
            <button class="memory-item-delete" onclick="removeMemoryPref('${escapeHtml(k)}')">✕</button>
        </div>
    `).join('') || '<div style="color:var(--text-muted); font-size:0.8rem; padding:8px">Belum ada info user</div>';

    // Events
    const eventsEl = $('#memory-events');
    eventsEl.innerHTML = (mem.importantEvents || []).map((e, i) => `
        <div class="memory-item">
            <span class="memory-item-key">${e.date || ''}</span>
            <span class="memory-item-text">${escapeHtml(e.description)}</span>
            <button class="memory-item-delete" onclick="removeMemoryItem('importantEvents', ${i})">✕</button>
        </div>
    `).join('') || '<div style="color:var(--text-muted); font-size:0.8rem; padding:8px">Belum ada event</div>';

    // Summaries
    const summariesEl = $('#memory-summaries');
    summariesEl.innerHTML = (mem.summaries || []).map((s, i) => `
        <div class="memory-item">
            <span class="memory-item-text">${escapeHtml(s)}</span>
            <button class="memory-item-delete" onclick="removeMemoryItem('summaries', ${i})">✕</button>
        </div>
    `).join('') || '<div style="color:var(--text-muted); font-size:0.8rem; padding:8px">Belum ada ringkasan</div>';
}

function removeMemoryItem(key, index) {
    if (!state.memory) return;
    state.memory[key].splice(index, 1);
    renderMemory();
}

function removeMemoryPref(key) {
    if (!state.memory) return;
    delete state.memory.userPreferences[key];
    renderMemory();
}

function addMemoryFact() {
    const input = $('#memory-new-fact');
    const val = input.value.trim();
    if (!val || !state.memory) return;
    state.memory.facts = state.memory.facts || [];
    state.memory.facts.push(val);
    input.value = '';
    renderMemory();
}

function addMemoryPref() {
    const keyInput = $('#memory-new-pref-key');
    const valInput = $('#memory-new-pref-val');
    const key = keyInput.value.trim();
    const val = valInput.value.trim();
    if (!key || !val || !state.memory) return;
    state.memory.userPreferences = state.memory.userPreferences || {};
    state.memory.userPreferences[key] = val;
    keyInput.value = '';
    valInput.value = '';
    renderMemory();
}

function addMemoryEvent() {
    const input = $('#memory-new-event');
    const val = input.value.trim();
    if (!val || !state.memory) return;
    state.memory.importantEvents = state.memory.importantEvents || [];
    state.memory.importantEvents.push({
        description: val,
        date: new Date().toISOString().split('T')[0]
    });
    input.value = '';
    renderMemory();
}

async function saveMemory() {
    if (!state.currentCharacterId || !state.memory) return;
    await api('PUT', `/api/memory/${state.currentCharacterId}`, state.memory);
    toast('Memory saved!', 'success');
    closeModal('modal-memory');
}

async function summarizeMemory() {
    if (!state.currentCharacterId || !state.currentChatId) {
        toast('Pilih chat terlebih dahulu', 'error');
        return;
    }

    const btn = $('#btn-summarize-memory');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Summarizing...';

    try {
        const result = await api('POST', `/api/memory/${state.currentCharacterId}/summarize`, {
            chatId: state.currentChatId
        });

        if (result.error) {
            toast(result.error, 'error');
        } else {
            state.memory = result.memory;
            renderMemory();
            toast('Memory summarized by AI!', 'success');
        }
    } catch (err) {
        toast(`Error: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '🤖 AI Summarize Chat';
    }
}

// ══════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════

function showView(viewId) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#${viewId}`).classList.add('active');
}

function openModal(id) {
    $(`#${id}`).classList.add('show');
}

function closeModal(id) {
    $(`#${id}`).classList.remove('show');
}

function toast(message, type = 'info') {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    document.body.appendChild(el);

    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'all 0.3s ease';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMessageContent(content) {
    if (!content) return '';
    // Basic markdown-like formatting
    let html = escapeHtml(content);
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Action text *action*
    html = html.replace(/(?:^|\n)\*(.+?)\*(?:\n|$)/g, '<em style="color:var(--text-secondary)">*$1*</em>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
}

function formatTime(isoString) {
    try {
        const d = new Date(isoString);
        return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
}

function autoResizeInput() {
    const input = $('#chat-input');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
}

// ══════════════════════════════════════════════════════════
//  EVENT BINDINGS
// ══════════════════════════════════════════════════════════

function bindEvents() {
    // Settings
    $('#btn-settings').addEventListener('click', () => {
        openModal('modal-settings');
        closeSidebarOnMobile();
    });
    $('#btn-save-settings').addEventListener('click', saveConfig);
    $('#btn-test-connection').addEventListener('click', async () => {
        const btn = $('#btn-test-connection');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Testing...';
        // First save config so the test uses the latest values
        const baseUrl = $('#cfg-base-url').value.trim();
        const apiKey = $('#cfg-api-key').value.trim();
        const modelName = $('#cfg-model').value;
        await api('POST', '/api/config', { baseUrl, apiKey, modelName });
        state.config = { baseUrl, apiKey, modelName };
        await testConnection();
        btn.disabled = false;
        btn.innerHTML = '🔌 Test Connection';
    });

    // Character
    $('#btn-new-character').addEventListener('click', () => openCharacterEditor());
    $('#btn-save-character').addEventListener('click', saveCharacter);
    $('#btn-delete-character').addEventListener('click', deleteCharacter);

    // Avatar upload
    $('#avatar-preview').addEventListener('click', () => {
        $('#char-avatar-file').click();
    });
    $('#char-avatar-file').addEventListener('change', handleAvatarUpload);
    $('#avatar-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        removeAvatar();
    });
    $('#btn-edit-character').addEventListener('click', () => {
        if (state.currentCharacterId) openCharacterEditor(state.currentCharacterId);
    });

    // Chat
    $('#btn-new-chat').addEventListener('click', startNewChat);
    $('#chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
    });

    // Auto-resize textarea
    $('#chat-input').addEventListener('input', autoResizeInput);

    // Enter to send (Shift+Enter for newline, or mobile always newline)
    $('#chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            if (window.innerWidth <= 768) {
                // On mobile, Enter just creates a newline, don't send
                return;
            }
            e.preventDefault();
            sendMessage();
        }
    });

    // Memory
    $('#btn-memory-view').addEventListener('click', openMemoryViewer);
    $('#btn-save-memory').addEventListener('click', saveMemory);
    $('#btn-summarize-memory').addEventListener('click', summarizeMemory);
    $('#btn-add-fact').addEventListener('click', addMemoryFact);
    $('#btn-add-pref').addEventListener('click', addMemoryPref);
    $('#btn-add-event').addEventListener('click', addMemoryEvent);

    // Enter key in memory inputs
    $('#memory-new-fact').addEventListener('keydown', (e) => { if (e.key === 'Enter') addMemoryFact(); });
    $('#memory-new-event').addEventListener('keydown', (e) => { if (e.key === 'Enter') addMemoryEvent(); });
    $('#memory-new-pref-val').addEventListener('keydown', (e) => { if (e.key === 'Enter') addMemoryPref(); });

    // Sidebar toggle
    $$('.mobile-menu-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                $('#sidebar').classList.toggle('open');
            } else {
                $('#sidebar').classList.toggle('closed');
            }
        });
    });

    // Close sidebar on outside click (mobile)
    document.addEventListener('click', (e) => {
        const sidebar = $('#sidebar');
        if (sidebar.classList.contains('open') &&
            !sidebar.contains(e.target) &&
            !e.target.closest('.mobile-menu-btn')) {
            sidebar.classList.remove('open');
        }
    });

    // Close modals on overlay click
    $$('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('show');
            }
        });
    });

    // Escape key to close modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            $$('.modal-overlay.show').forEach(m => m.classList.remove('show'));
        }
    });
}

function closeSidebarOnMobile() {
    if (window.innerWidth <= 768) {
        $('#sidebar').classList.remove('open');
    }
}

// ══════════════════════════════════════════════════════════
//  AVATAR UPLOAD HANDLERS
// ══════════════════════════════════════════════════════════

function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        toast('Pilih file gambar (JPG, PNG, GIF, WebP)', 'error');
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        toast('Ukuran file maksimal 5MB', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 256;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_SIZE) {
                    height *= MAX_SIZE / width;
                    width = MAX_SIZE;
                }
            } else {
                if (height > MAX_SIZE) {
                    width *= MAX_SIZE / height;
                    height = MAX_SIZE;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/webp', 0.85);
            $('#char-avatar').value = dataUrl;
            updateAvatarPreview(dataUrl);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function removeAvatar() {
    $('#char-avatar').value = '';
    $('#char-avatar-file').value = '';
    updateAvatarPreview('');
}

// ══════════════════════════════════════════════════════════
//  CHAT RENAME
// ══════════════════════════════════════════════════════════

window.startRenameChat = function(chatId) {
    const chatItem = document.querySelector(`.chat-item[data-id="${chatId}"]`);
    if (!chatItem) return;

    const chat = state.chats.find(c => c.id === chatId);
    if (!chat) return;

    const currentTitle = chat.title || 'New Chat';

    chatItem.removeAttribute('onclick');
    chatItem.innerHTML = `
        <span class="chat-item-icon">💬</span>
        <div class="chat-item-rename-container">
            <input type="text" class="chat-item-rename-input" value="${escapeHtml(currentTitle)}"
                   data-chat-id="${chatId}" autocomplete="off">
            <div class="chat-item-rename-actions">
                <button class="chat-rename-save" onclick="event.stopPropagation(); saveRenameChat('${chatId}')" title="Simpan">✓</button>
                <button class="chat-rename-cancel" onclick="event.stopPropagation(); cancelRenameChat()" title="Batal">✕</button>
            </div>
        </div>
    `;

    const input = chatItem.querySelector('.chat-item-rename-input');
    input.focus();
    input.select();

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveRenameChat(chatId);
        } else if (e.key === 'Escape') {
            cancelRenameChat();
        }
    });
};

window.saveRenameChat = async function(chatId) {
    const input = document.querySelector(`.chat-item-rename-input[data-chat-id="${chatId}"]`);
    if (!input) return;

    const newTitle = input.value.trim();
    if (!newTitle) return cancelRenameChat();

    try {
        await api('PUT', `/api/chat/${chatId}`, { title: newTitle });

        const chat = state.chats.find(c => c.id === chatId);
        if (chat) chat.title = newTitle;

        renderChatList();
        toast('Chat renamed!', 'success');
    } catch (err) {
        toast(`Error: ${err.message}`, 'error');
        renderChatList();
    }
};

window.cancelRenameChat = function() {
    renderChatList();
};
