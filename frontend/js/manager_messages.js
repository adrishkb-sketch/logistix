// Dedicated script for manager_messages.html

let selectedDriverChatId = null;
let mainChatMediaData = null;
let mainChatMediaRecorder = null;
let mainChatRecording = false;

function isUnread(driverId, conv) {
    if (selectedDriverChatId === driverId) return false;
    if (!conv.lastMessage) return false;
    if (conv.lastMessage.sender_type !== 'driver') return false;
    const lastSeenCount = parseInt(localStorage.getItem(`last_seen_msg_count_${driverId}`) || '0');
    return conv.messages.length > lastSeenCount;
}

async function loadMessages() {
    try {
        const mId = localStorage.getItem('manager_id');
        const msgs = (await apiCall(`/tracking/messages/${mId}?company_id=${mId}`)) || [];
        window.globalDrivers = await apiCall(`/manager/drivers?company_id=${mId}`);
        
        // Ensure globalDrivers is an array and filter out invalid/null elements
        window.globalDrivers = (window.globalDrivers || []).filter(d => d && d.id && d.name);

        // Clear the new messages badge and bold styling since we are on the messages page
        lastMsgCount = msgs.length;
        localStorage.setItem('last_seen_msg_count', lastMsgCount);
        const badge = document.getElementById('msg-badge');
        if (badge) badge.style.display = 'none';
        const link = document.getElementById('nav-link-messages');
        if (link) {
            link.classList.remove('has-notif');
            link.style.fontWeight = '';
            link.style.color = '';
        }
        
        const searchInputEl = document.getElementById('driver-chat-search');
        const searchQuery = (searchInputEl ? searchInputEl.value : '').toLowerCase();
        
        // Only verified drivers should appear in the messages list
        const verifiedDrivers = window.globalDrivers.filter(d => d.verification_status === "verified");
        const filteredDrivers = verifiedDrivers.filter(d => d.name && typeof d.name === 'string' && d.name.toLowerCase().includes(searchQuery));
        
        const driverListContainer = document.getElementById('chat-driver-list');
        if (!driverListContainer) return;
        
        // Group messages by driver
        const conversations = {};
        
        window.globalDrivers.forEach(d => {
            const dMsgs = msgs.filter(m => m && (m.sender_id === d.id || m.receiver_id === d.id));
            dMsgs.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
            
            conversations[d.id] = {
                driver: d,
                messages: dMsgs,
                lastMessage: dMsgs.length > 0 ? dMsgs[dMsgs.length - 1] : null
            };
        });

        // If a driver is currently selected, mark their messages as read
        if (selectedDriverChatId && conversations[selectedDriverChatId]) {
            localStorage.setItem(`last_seen_msg_count_${selectedDriverChatId}`, conversations[selectedDriverChatId].messages.length);
        }

        // Set select_driver_msg placeholder text appropriately
        const selectDriverMsgEl = document.querySelector('[data-i18n="select_driver_msg"]');
        if (selectDriverMsgEl) {
            if (verifiedDrivers.length === 0) {
                selectDriverMsgEl.innerText = "no verified drivers";
            } else {
                selectDriverMsgEl.innerText = "Select a driver from the left to view messages";
            }
        }

        // Sort: Unread first (newest unread first), then rest (newest first), then alphabetical
        filteredDrivers.sort((a, b) => {
            const convA = conversations[a.id] || { messages: [], lastMessage: null };
            const convB = conversations[b.id] || { messages: [], lastMessage: null };
            
            const unreadA = isUnread(a.id, convA);
            const unreadB = isUnread(b.id, convB);
            
            if (unreadA && !unreadB) return -1;
            if (!unreadA && unreadB) return 1;
            
            const timeA = convA.lastMessage ? new Date(convA.lastMessage.created_at).getTime() : 0;
            const timeB = convB.lastMessage ? new Date(convB.lastMessage.created_at).getTime() : 0;
            
            if (timeA !== timeB) {
                return timeB - timeA;
            }
            return a.name.localeCompare(b.name);
        });

        // Render Sidebar (filtered)
        if (filteredDrivers.length === 0) {
            if (verifiedDrivers.length === 0) {
                driverListContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: var(--muted); font-size: 0.95rem;">
                        no verified drivers
                    </div>
                `;
            } else {
                driverListContainer.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted); font-size:0.85rem;">No drivers match the search query.</div>`;
            }
        } else {
            driverListContainer.innerHTML = filteredDrivers.map(d => {
                const conv = conversations[d.id] || { messages: [], lastMessage: null };
                const isSelected = selectedDriverChatId === d.id;
                const lastText = conv.lastMessage ? (conv.lastMessage.content || "[Media]") : "No messages yet";
                
                let lastTime = "";
                if (conv.lastMessage && conv.lastMessage.created_at) {
                    try {
                        const parsedDate = new Date(conv.lastMessage.created_at);
                        if (!isNaN(parsedDate.getTime())) {
                            lastTime = parsedDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                        }
                    } catch (timeErr) {
                        console.warn("Error parsing message timestamp:", timeErr);
                    }
                }
                
                const unread = isUnread(d.id, conv);
                
                return `
                    <div class="chat-driver-item ${isSelected ? 'active' : ''}" 
                          onclick="selectDriverChat('${d.id}')"
                          style="padding:16px 24px; cursor:pointer; border-bottom:1px solid var(--border); transition:0.2s; background:${isSelected ? 'rgba(79, 140, 255, 0.1)' : 'transparent'};">
                         <div style="display:flex; gap:12px; align-items:center;">
                            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(d.name)}" style="width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.1);">
                            <div style="flex:1; overflow:hidden;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                                    <b style="font-size:0.9rem; font-weight:${unread ? '800' : '500'}; color:${unread ? 'var(--text)' : (isSelected ? 'var(--primary)' : 'var(--text)')}">${d.name}</b>
                                    <span style="font-size:0.65rem; color:var(--muted); font-weight:${unread ? '800' : 'normal'};">${lastTime}</span>
                                </div>
                                <p style="margin:0; font-size:0.75rem; color:${unread ? 'var(--text)' : 'var(--muted)'}; font-weight:${unread ? '800' : 'normal'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${lastText}</p>
                            </div>
                            ${unread ? `<span style="width: 8px; height: 8px; background: var(--danger); border-radius: 50%; flex-shrink: 0; margin-left: 6px;"></span>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        if (selectedDriverChatId) {
            const stillVerified = verifiedDrivers.some(d => d.id === selectedDriverChatId);
            if (!stillVerified) {
                selectedDriverChatId = null;
                closeMobileChat();
            } else {
                renderChatWindow(conversations[selectedDriverChatId]);
            }
        } else {
            const placeholder = document.getElementById('chat-placeholder');
            if (placeholder) placeholder.style.display = 'flex';
            const header = document.getElementById('chat-header');
            if (header) header.style.display = 'none';
            const msgContainer = document.getElementById('chat-messages-container');
            if (msgContainer) msgContainer.style.display = 'none';
            const inputArea = document.getElementById('chat-input-area');
            if (inputArea) inputArea.style.display = 'none';
        }
    } catch(e) {
        console.error("Error loading messages:", e);
        const driverListContainer = document.getElementById('chat-driver-list');
        if (driverListContainer) {
            driverListContainer.innerHTML = `<div style="padding:20px; text-align:center; color:var(--danger); font-size:0.85rem;">⚠️ Failed to load drivers: ${e.message || e}</div>`;
        }
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
    
    const driver = window.globalDrivers.find(d => d.id === driverId);
    if (driver) {
        document.getElementById('chat-driver-avatar').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(driver.name)}`;
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
                mediaHtml = `<img src="${m.media_url}" style="max-width:100%;border-radius:10px;margin-top:8px;display:block;cursor:pointer;" onclick="window.zoomImage('${m.media_url}')" alt="photo">`;
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

// Bind all page events to window
window.filterDriverChatList = filterDriverChatList;
window.selectDriverChat = selectDriverChat;
window.closeMobileChat = closeMobileChat;
window.sendMessageToSelectedDriver = sendMessageToSelectedDriver;
window.mainChatPickPhoto = mainChatPickPhoto;
window.mainChatHandlePhoto = mainChatHandlePhoto;
window.mainChatClearMedia = mainChatClearMedia;
window.mainChatToggleRecording = mainChatToggleRecording;
window.loadMessages = loadMessages;

async function initPage() {
    loadMessages();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
} else {
    initPage();
}