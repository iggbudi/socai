import { escapeHtml } from '../html.js';
import { sidebarHTML } from './layout.js';
import { HAMBURGER_BIND_JS } from './pageInit.js';

export function asistenPage(username, csrfToken, { nonce = '' } = {}) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Asisten Automation — Batik Bakaran</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --sidebar-w: 260px;
      --bg: #f1f5f9;
      --sidebar-bg: #1e293b;
      --sidebar-text: #cbd5e1;
      --sidebar-hover: #334155;
      --sidebar-active: #4f46e5;
      --content-bg: #fff;
    }
    html, body { height: 100%; }
    body {
      display: flex;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #172033;
      background: var(--bg);
    }

    /* Sidebar */
    .sidebar {
      width: var(--sidebar-w);
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      display: flex; flex-direction: column; flex-shrink: 0;
      height: 100vh;
      position: fixed; left: 0; top: 0; bottom: 0;
      z-index: 100; overflow-y: auto;
    }
    .sidebar-brand {
      padding: 24px 20px 20px;
      font-size: 20px; font-weight: 700; color: #fff;
      border-bottom: 1px solid rgba(255,255,255,.08);
      display: flex; align-items: center; gap: 10px;
    }
    .sidebar-brand span { font-size: 18px; }
    .sidebar-nav { flex: 1; padding: 12px 0; }
    .sidebar-nav a {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px; color: var(--sidebar-text);
      text-decoration: none; font-size: 14px; font-weight: 500;
      transition: background .15s, color .15s;
      border-left: 3px solid transparent;
    }
    .sidebar-nav a:hover { background: var(--sidebar-hover); color: #fff; }
    .sidebar-nav a.active { background: rgba(79,70,229,.15); color: #fff; border-left-color: var(--sidebar-active); }
    .sidebar-nav a .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-footer { border-top: 1px solid rgba(255,255,255,.08); padding: 12px 0; }
    .sidebar-footer a {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px; color: #ef4444;
      text-decoration: none; font-size: 14px; font-weight: 500;
      transition: background .15s, color .15s;
    }
    .sidebar-footer a:hover { background: rgba(239,68,68,.1); color: #f87171; }
    .logout-form { margin: 0; width: 100%; }
    .logout-btn {
      width: 100%;
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      color: #ef4444;
      background: none; border: none;
      font-size: 14px; font-weight: 500;
      cursor: pointer;
      transition: background .15s, color .15s;
      text-align: left; font-family: inherit;
    }
    .logout-btn:hover { background: rgba(239,68,68,.1); color: #f87171; }
    .logout-btn .icon { font-size: 18px; width: 24px; text-align: center; }
    .sidebar-user {
      padding: 16px 20px;
      border-top: 1px solid rgba(255,255,255,.08);
      display: flex; align-items: center; gap: 10px; font-size: 13px;
    }
    .sidebar-user .avatar {
      width: 34px; height: 34px; border-radius: 50%;
      background: var(--sidebar-active); color: #fff;
      display: grid; place-items: center;
      font-weight: 700; font-size: 14px; flex-shrink: 0;
    }
    .sidebar-user .info .name { color: #fff; font-weight: 600; }
    .sidebar-user .info .role { color: #94a3b8; font-size: 12px; }

    /* Main */
    .main {
      flex: 1; margin-left: var(--sidebar-w);
      min-height: 100vh; display: flex; flex-direction: column;
    }
    .topbar {
      background: var(--content-bg);
      padding: 16px 28px;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 50;
    }
    .topbar h2 { font-size: 18px; font-weight: 600; }
    .topbar .breadcrumb { color: #6b7280; font-size: 13px; }

    /* Chat area */
    .content {
      flex: 1; display: flex; flex-direction: column;
      padding: 0; overflow: hidden;
    }
    .chat-messages {
      flex: 1; overflow-y: auto; padding: 24px 28px;
      display: flex; flex-direction: column; gap: 16px;
    }
    .chat-bubble {
      max-width: 80%; padding: 14px 18px;
      border-radius: 14px; font-size: 14px; line-height: 1.6;
      white-space: pre-wrap; word-break: break-word;
    }
    .chat-bubble.user {
      align-self: flex-end;
      background: #4f46e5; color: #fff;
      border-bottom-right-radius: 4px;
    }
    .chat-bubble.assistant {
      align-self: flex-start;
      background: var(--content-bg); color: #172033;
      border: 1px solid #e2e8f0;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,.04);
    }
    .chat-typing {
      align-self: flex-start;
      padding: 14px 18px; font-size: 14px; color: #6b7280;
      display: flex; gap: 4px;
    }
    .chat-typing span {
      width: 8px; height: 8px; border-radius: 50%;
      background: #94a3b8; animation: bounce 1.4s infinite;
    }
    .chat-typing span:nth-child(2) { animation-delay: .2s; }
    .chat-typing span:nth-child(3) { animation-delay: .4s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-8px); }
    }

    /* Chat input */
    .chat-input-area {
      padding: 16px 28px 24px;
      background: var(--content-bg);
      border-top: 1px solid #e2e8f0;
    }
    .chat-input-wrap {
      display: flex; gap: 10px;
      background: #f1f5f9; border-radius: 12px;
      padding: 8px 8px 8px 16px; align-items: flex-end;
      border: 1px solid #e2e8f0; transition: border-color .2s;
    }
    .chat-input-wrap:focus-within { border-color: #4f46e5; }
    .chat-input-wrap textarea {
      flex: 1; border: none; background: transparent;
      font-size: 14px; font-family: inherit; resize: none;
      outline: none; min-height: 24px; max-height: 120px;
      padding: 4px 0;
    }
    .chat-input-wrap button {
      width: 40px; height: 40px; border-radius: 10px;
      background: #4f46e5; color: #fff; border: none;
      font-size: 18px; cursor: pointer; flex-shrink: 0;
      transition: background .15s;
    }
    .chat-input-wrap button:hover { background: #4338ca; }
    .chat-input-wrap button:disabled { background: #94a3b8; cursor: not-allowed; }

    /* Welcome message */
    .welcome {
      text-align: center; padding: 40px 20px; color: #6b7280;
    }
    .welcome h3 { font-size: 20px; margin-bottom: 8px; color: #172033; }
    .suggestions {
      display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 16px;
    }
    .suggestion-chip {
      padding: 8px 16px; border-radius: 20px;
      background: #f1f5f9; border: 1px solid #e2e8f0;
      font-size: 13px; cursor: pointer; color: #374151;
      transition: background .15s;
    }
    .suggestion-chip:hover { background: #e2e8f0; }

    .hamburger { display: none; background: none; border: none; font-size: 24px; cursor: pointer; color: #172033; padding: 4px; }

    @media (max-width: 768px) {
      .sidebar { transform: translateX(-100%); transition: transform .25s; }
      .sidebar.open { transform: translateX(0); }
      .main { margin-left: 0; }
      .hamburger { display: block; }
      .chat-bubble { max-width: 92%; }
    }

    @media (prefers-color-scheme: dark) {
      :root { --bg: #0f172a; --content-bg: #1e293b; }
      body { color: #f2f5f8; }
      .chat-bubble.assistant { color: #f2f5f8; border-color: #334155; }
      .chat-input-area { border-top-color: #334155; }
      .chat-input-wrap { background: #0f172a; border-color: #334155; }
      .chat-input-wrap textarea { color: #f2f5f8; }
      .suggestion-chip { background: #1a2332; border-color: #334155; color: #cbd5e1; }
      .suggestion-chip:hover { background: #334155; }
      .welcome h3 { color: #f2f5f8; }
      .topbar { box-shadow: 0 1px 3px rgba(0,0,0,.3); }
    }

    /* Save plan button */
    .save-plan-btn {
      display: inline-flex; align-items: center; gap: 6px;
      margin-top: 10px; padding: 8px 16px;
      background: #10b981; color: #fff; border: none;
      border-radius: 8px; font-size: 13px; font-weight: 500;
      cursor: pointer; transition: background .15s;
    }
    .save-plan-btn:hover { background: #059669; }
    .save-plan-btn:disabled { background: #94a3b8; cursor: not-allowed; }
    .save-plan-btn.saved { background: #6b7280; cursor: default; }
  </style>
</head>
<body>

${sidebarHTML('asisten', username, csrfToken)}

<main class="main">
  <header class="topbar">
    <div>
      <h2>🤖 Asisten Automation</h2>
      <span class="breadcrumb">Home / Asisten AI</span>
    </div>
    <button class="hamburger" type="button">☰</button>
  </header>

  <div class="content">
    <div class="chat-messages" id="chat-messages">
      <div class="welcome">
        <h3>🤖 Asisten Pemasaran Batik Bakaran</h3>
        <p>Aku bisa bantu kamu merencanakan konten pemasaran berdasarkan data produk.</p>
        <div class="suggestions">
          <span class="suggestion-chip">Tampilkan semua produk</span>
          <span class="suggestion-chip">Buat konten Threads untuk 3 produk terlaris</span>
          <span class="suggestion-chip">Buat rencana konten Threads 1 minggu lanjutan, cek jadwal pemasaran dulu</span>
          <span class="suggestion-chip">Analisis stok dan rekomendasi promosi</span>
        </div>
      </div>
    </div>

    <div class="chat-input-area">
      <div class="chat-input-wrap">
        <textarea id="chat-input" rows="1" placeholder="Ketik pesan..."></textarea>
        <button id="send-btn" type="button">➤</button>
      </div>
    </div>
  </div>
</main>

<script nonce="${nonce}">
let streaming = false;

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function sendSuggestion(text) {
  document.getElementById('chat-input').value = text;
  sendMessage();
}

async function sendMessage() {
  if (streaming) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  const container = document.getElementById('chat-messages');

  // Hapus welcome message jika masih ada
  const welcome = container.querySelector('.welcome');
  if (welcome) welcome.remove();

  // Tambah bubble user
  const userBubble = document.createElement('div');
  userBubble.className = 'chat-bubble user';
  userBubble.textContent = text;
  container.appendChild(userBubble);

  // Typing indicator
  const typing = document.createElement('div');
  typing.className = 'chat-typing';
  typing.id = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  container.appendChild(typing);

  // Scroll
  container.scrollTop = container.scrollHeight;

  input.value = '';
  input.style.height = 'auto';
  streaming = true;
  document.getElementById('send-btn').disabled = true;

  // Buat bubble assistant
  const assistantBubble = document.createElement('div');
  assistantBubble.className = 'chat-bubble assistant';
  assistantBubble.textContent = '';

  try {
    const res = await fetch('/api/asisten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });

    if (!res.ok) {
      let errMsg = 'Gagal menghubungi AI (HTTP ' + res.status + ')';
      const errText = await res.text();
      if (errText) {
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error || errJson.message || errMsg;
        } catch (_) {
          errMsg = errText.slice(0, 200);
        }
      }
      throw new Error(errMsg);
    }

    if (!res.body) {
      throw new Error('Response stream tidak tersedia.');
    }

    // Hapus typing
    typing.remove();
    container.appendChild(assistantBubble);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'text') {
              assistantBubble.textContent += data.text;
            } else if (data.type === 'done') {
              // Parse JSON rencana dari response
              const fullText = assistantBubble.textContent;
              const marker = '\`\`\`json';
              const startIdx = fullText.lastIndexOf(marker);
              if (startIdx !== -1) {
                const afterMarker = fullText.slice(startIdx + marker.length);
                const endIdx = afterMarker.indexOf('\`\`\`');
                if (endIdx !== -1) {
                  const jsonStr = afterMarker.slice(0, endIdx).trim();
                  try {
                    const planData = JSON.parse(jsonStr);
                    const saveBtn = document.createElement('button');
                    saveBtn.className = 'save-plan-btn';
                    saveBtn.innerHTML = '📋 Simpan Rencana';
                    saveBtn.onclick = async () => {
                      saveBtn.disabled = true;
                      saveBtn.textContent = '⏳ Menyimpan...';
                      try {
                        const res = await fetch('/api/pemasaran', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(planData),
                        });
                          if (res.ok) {
                          let savedText = '✅ Tersimpan';
                          try {
                            const savedData = await res.json();
                            if (savedData.count) savedText = '✅ ' + savedData.count + ' rencana tersimpan';
                          } catch (_) {}
                          saveBtn.innerHTML = savedText;
                          saveBtn.classList.add('saved');
                        } else {
                          let errMsg = 'Gagal menyimpan';
                          try {
                            const errData = await res.json();
                            errMsg = errData.error || errMsg;
                          } catch (_) {}
                          throw new Error(errMsg);
                        }
                      } catch (err) {
                        saveBtn.innerHTML = '❌ ' + err.message;
                        saveBtn.title = err.message;
                        saveBtn.disabled = false;
                      }
                    };
                    assistantBubble.appendChild(saveBtn);
                  } catch (e) {}
                }
              }
            } else if (data.type === 'error') {
              assistantBubble.textContent += '\\n❌ ' + data.text;
            }
          } catch(e) {}
        }
      }
      container.scrollTop = container.scrollHeight;
    }
  } catch(e) {
    typing.remove();
    const errBubble = document.createElement('div');
    errBubble.className = 'chat-bubble assistant';
    errBubble.textContent = '❌ Gagal menghubungi AI: ' + e.message;
    container.appendChild(errBubble);
  }

  streaming = false;
  document.getElementById('send-btn').disabled = false;
  container.scrollTop = container.scrollHeight;
}

// Auto-resize textarea
document.getElementById('chat-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

document.getElementById('chat-input').addEventListener('keydown', handleKey);
document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('chat-messages').addEventListener('click', (e) => {
  const chip = e.target.closest('.suggestion-chip');
  if (chip) sendSuggestion(chip.textContent);
});
${HAMBURGER_BIND_JS}
</script>

</body>
</html>`;
}
