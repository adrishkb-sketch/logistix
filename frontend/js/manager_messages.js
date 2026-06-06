// Dedicated script for manager_messages.html

let selectedDriverChatId = null; let lastMsgCount = -1;

async function loadMessages() {
    try {
        const mId = localStorage.getItem('manager_id');
        const msgs = await apiCall(`/tracking/messages/${mId}?company_id=${mId}`);
        globalDrivers = await apiCall(`/manager/drivers?company_id=${mId}`);
        
        const searchQuery = document.getElementById('driver-chat-search').value.toLowerCase();
        const filteredDrivers = globalDrivers.filter(d => d.name.toLowerCase().includes(searchQuery));
        
        const driverListContainer = document.getElementById('chat-driver-list');
        
        // Group messages by driver
        const conversations = {};
        
        globalDrivers.forEach(d => {
            conversations[d.id] = {
                driver: d,
                messages: msgs.filter(m => m.sender_id === d.id || m.receiver_id === d.id).sort((a,b) => new Date(a.created_at) - new Date(b.created_at)),
                lastMessage: null
            };
            if (conversations[d.id].messages.length > 0) {
                conversations[d.id].lastMessage = conversations[d.id].messages[conversations[d.id].messages.length - 1];
            }
        });

        // Render Sidebar (filtered)
        driverListContainer.innerHTML = filteredDrivers.map(d => {
            const conv = conversations[d.id];
            const isSelected = selectedDriverChatId === d.id;
            const lastText = conv.lastMessage ? conv.lastMessage.content : "No messages yet";
            const lastTime = conv.lastMessage ? new Date(conv.lastMessage.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "";
            
            return `
                <div class="chat-driver-item ${isSelected ? 'active' : ''}" 
                     onclick="selectDriverChat('${d.id}')"
                     style="padding:16px 24px; cursor:pointer; border-bottom:1px solid var(--border); transition:0.2s; background:${isSelected ? 'rgba(79, 140, 255, 0.1)' : 'transparent'};">
                    <div style="display:flex; gap:12px; align-items:center;">
                        <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${d.name}" style="width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.1);">
                        <div style="flex:1; overflow:hidden;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                                <b style="font-size:0.9rem; color:${isSelected ? 'var(--primary)' : 'var(--text)'}">${d.name}</b>
                                <span style="font-size:0.65rem; color:var(--muted);">${lastTime}</span>
                            </div>
                            <p style="margin:0; font-size:0.75rem; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${lastText}</p>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        if (selectedDriverChatId) {
            renderChatWindow(conversations[selectedDriverChatId]);
        }
    } catch(e) {
        console.error("Error loading messages:", e);
    }
}

function filterDriverChatList() {
    loadMessages(); // Just re-run with current search query
}

function selectDriverChat(driverId) {
    selectedDriverChatId = driverId;
    
    // UI Updates
    document.getElementById('chat-placeholder').style.display = 'none';
    document.getElementById('chat-header').style.display = 'flex';
    document.getElementById('chat-messages-container').style.display = 'block';
    document.getElementById('chat-input-area').style.display = 'block';
    
    const driver = globalDrivers.find(d => d.id === driverId);
    if (driver) {
        document.getElementById('chat-driver-avatar').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.name}`;
    }

    // Mobile: slide to chat panel
    const shell = document.querySelector('.chat-shell');
    if (shell) shell.classList.add('chat-open');
    
    loadMessages();
}

function closeMobileChat() {
    // Mobile back button — slide back to driver list
    const shell = document.querySelector('.chat-shell');
    if (shell) shell.classList.remove('chat-open');
    selectedDriverChatId = null;
    document.getElementById('chat-placeholder').style.display = 'flex';
    document.getElementById('chat-header').style.display = 'none';
    document.getElementById('chat-messages-container').style.display = 'none';
    document.getElementById('chat-input-area').style.display = 'none';
}

function renderChatWindow(conv) {
    const container = document.getElementById('chat-messages-container');
    const headerName = document.getElementById('chat-driver-name');
    headerName.innerText = conv.driver.name;

    if (conv.messages.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--muted);">No conversation history with this driver. Start the chat below.</div>';
    } else {
        container.innerHTML = conv.messages.map(m => {
            const isMe = m.sender_type === 'manager';
            let mediaHtml = '';
            if (m.media_type === 'image' && m.media_url) {
                mediaHtml = `<img src="${m.media_url}" style="max-width:100%;border-radius:10px;margin-top:8px;display:block;cursor:pointer;" onclick="window.open('${m.media_url}')" alt="photo">`;
            } else if (m.media_type === 'audio' && m.media_url) {
                mediaHtml = `<div class="audio-placeholder" data-src="${m.media_url}" data-accent="${isMe ? 'rgba(255,255,255,0.25)' : 'rgba(79,140,255,0.4)'}"></div>`;
            }
            return `
                <div style="display:flex; justify-content:${isMe ? 'flex-end' : 'flex-start'}; margin-bottom:16px;">
                    <div style="max-width:72%; padding:12px 16px; border-radius:16px;
                                background:${isMe ? 'var(--primary)' : 'rgba(255,255,255,0.05)'};
                                color:${isMe ? '#fff' : 'var(--text)'};
                                border-bottom-${isMe ? 'right' : 'left'}-radius:2px;
                                border: 1px solid ${isMe ? 'transparent' : 'var(--border)'};
                                box-shadow:0 2px 8px rgba(0,0,0,0.15);">
                        ${m.content && m.content !== '[Media]' ? `<div style="font-size:0.95rem; line-height:1.4;">${m.content}</div>` : ''}
                        ${mediaHtml}
                        <div style="font-size:0.65rem; margin-top:4px; text-align:right; opacity:0.7;">
                            ${new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
    container.scrollTop = container.scrollHeight;
    container.querySelectorAll('.audio-placeholder').forEach(ph => {
        ph.replaceWith(buildAudioPlayer(ph.dataset.src, ph.dataset.accent));
    });
}

async function sendMessageToSelectedDriver() {
    const input = document.getElementById('manager-chat-input');
    const content = (input.value || '').trim();
    if (!content && !mainChatMediaData) return;
    if (!selectedDriverChatId) return;

    try {
        const mId = localStorage.getItem('manager_id');
        await apiCall('/tracking/messages', 'POST', {
            company_id: mId,
            sender_id: mId,
            receiver_id: selectedDriverChatId,
            content: content || (mainChatMediaData ? '[Media]' : ''),
            sender_type: 'manager',
            media_url: mainChatMediaData ? mainChatMediaData.url : null,
            media_type: mainChatMediaData ? mainChatMediaData.type : null
        });
        input.value = '';
        mainChatMediaData = null;
        const preview = document.getElementById('main-chat-media-preview');
        if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }

        const msgs = await apiCall(`/tracking/messages/${mId}?company_id=${mId}`);
        lastMsgCount = msgs.length;
        localStorage.setItem('last_seen_msg_count', lastMsgCount);

        loadMessages();
    } catch(e) {
        showNotification(getTranslation('msg_failed'), 'error');
    }
}

function mainChatPickPhoto() {
    document.getElementById('main-chat-photo-input').click();
}

function mainChatHandlePhoto(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        mainChatMediaData = { type: 'image', url: e.target.result };
        const preview = document.getElementById('main-chat-media-preview');
        preview.style.display = 'flex';
        preview.innerHTML = `<img src="${e.target.result}" style="height:56px;border-radius:8px;border:1px solid var(--border);"><span style="font-size:0.8rem;color:var(--muted);flex:1;">Photo attached</span><button onclick="mainChatClearMedia()" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1.1rem;">✕</button>`;
    };
    reader.readAsDataURL(file);
    input.value = '';
}

function mainChatClearMedia() {
    mainChatMediaData = null;
    const preview = document.getElementById('main-chat-media-preview');
    if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
}

async function mainChatToggleRecording() {
    const btn = document.getElementById('main-chat-voice-btn');
    if (!mainChatRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const chunks = [];
            mainChatMediaRecorder = new MediaRecorder(stream);
            mainChatMediaRecorder.ondataavailable = e => chunks.push(e.data);
            mainChatMediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onload = (ev) => {
                    mainChatMediaData = { type: 'audio', url: ev.target.result };
                    const preview = document.getElementById('main-chat-media-preview');
                    preview.style.display = 'flex';
                    preview.innerHTML = `<button onclick="mainChatClearMedia()" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1.1rem;flex-shrink:0;">✕</button>`;
                    const player = buildAudioPlayer(ev.target.result, 'rgba(79,140,255,0.4)');
                    preview.insertBefore(player, preview.firstChild);
                };
                reader.readAsDataURL(blob);
                stream.getTracks().forEach(t => t.stop());
            };
            mainChatMediaRecorder.start();
            mainChatRecording = true;
            btn.innerText = '⏹️';
            btn.style.background = 'rgba(229,62,62,0.2)';
            btn.style.color = 'var(--danger)';
        } catch(e) {
            alert('Microphone access denied.');
        }
    } else {
        mainChatMediaRecorder.stop();
        mainChatRecording = false;
        btn.innerText = '🎙️';
        btn.style.background = 'rgba(255,255,255,0.08)';
        btn.style.color = 'var(--text)';
    }
}

async function initPage() {
    loadMessages();
}

document.addEventListener('DOMContentLoaded', initPage);