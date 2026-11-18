import UI from './app/ui.js';
import RFB from './core/rfb.js';

// Clipboard contents stay in the two clipboards and in noVNC's existing panel.
// Do not log clipboard text or persist it in web storage.
const panel = document.getElementById('noVNC_clipboard');
const controls = document.createElement('div');
controls.style.cssText = 'margin-top:10px;max-width:300px;line-height:1.5';
const toggle = document.createElement('button');
toggle.id = 'clipboard-share-toggle';
toggle.type = 'button';
toggle.textContent = '클립보드 연결';
const copy = document.createElement('button');
copy.id = 'clipboard-copy-to-host';
copy.type = 'button';
copy.textContent = 'Windows로 복사';
copy.style.marginLeft = '6px';
const status = document.createElement('div');
status.id = 'clipboard-share-status';
status.setAttribute('role', 'status');
status.style.cssText = 'margin-top:8px;font-size:13px';
status.textContent = '연결 후 원격 화면에서 Ctrl+V를 사용하세요. 텍스트만 공유합니다.';
controls.append(toggle, copy, status);
panel.append(controls);

let enabled = false;
let busy = false;
let attached = null;
let remoteFocused = false;
const utf8Patched = new WeakSet();

function connected() {
    return UI.rfb && !UI.rfb.viewOnly && document.documentElement.classList.contains('noVNC_connected');
}

function supportUtf8Clipboard(rfb) {
    if (utf8Patched.has(rfb)) return;
    utf8Patched.add(rfb);
    const original = rfb.clipboardPasteFrom.bind(rfb);
    rfb.clipboardPasteFrom = text => {
        if (rfb._clipboardServerCapabilitiesFormats[1] &&
            rfb._clipboardServerCapabilitiesActions[1 << 27]) {
            original(text);
        } else if (rfb._rfbConnectionState === 'connected' && !rfb.viewOnly) {
            // This x11vnc deployment accepts UTF-8 cut text, but does not
            // advertise Notify. noVNC 1.3's Latin-1 fallback truncates Korean.
            RFB.messages.clientCutText(rfb._sock, new TextEncoder().encode(text));
        } else {
            original(text);
        }
    };
}

function updateControls() {
    toggle.disabled = !connected();
    toggle.textContent = enabled ? '클립보드 연결 해제' : '클립보드 연결';
    toggle.setAttribute('aria-pressed', String(enabled));
    copy.disabled = !enabled || !connected();
}

async function copyToHost(text) {
    try {
        await navigator.clipboard.writeText(text);
        status.textContent = 'Linux에서 복사한 텍스트를 Windows로 전달했습니다.';
    } catch {
        status.textContent = 'Windows로 복사 버튼을 누르세요. 브라우저의 클립보드 허용이 필요할 수 있습니다.';
    }
}

function remoteClipboard(event) {
    if (!enabled || event.target !== UI.rfb) return;
    if (typeof event.detail.text === 'string') void copyToHost(event.detail.text);
}

toggle.addEventListener('click', async () => {
    if (enabled) {
        enabled = false;
        status.textContent = '클립보드 연결을 해제했습니다.';
    } else {
        if (!window.isSecureContext || !navigator.clipboard?.readText || !navigator.clipboard?.writeText) {
            status.textContent = 'localhost 주소에서 Chrome 또는 Edge로 접속하세요. 기존 Clipboard 입력란도 사용할 수 있습니다.';
            return;
        }
        toggle.disabled = true;
        try {
            // Request read access through an explicit user action. Do not send
            // the current clipboard merely because sharing was enabled.
            await navigator.clipboard.readText();
            if (!connected()) return;
            enabled = true;
            status.textContent = '연결됨: 원격 화면에서 Ctrl+V로 붙여넣고, Ctrl+C로 복사하세요.';
        } catch {
            status.textContent = '클립보드 접근을 허용한 뒤 다시 연결하세요. 기존 Clipboard 입력란도 사용할 수 있습니다.';
        }
    }
    updateControls();
});

copy.addEventListener('click', () => {
    if (enabled && connected()) void copyToHost(document.getElementById('noVNC_clipboard_text').value);
});

function remoteTarget(target) {
    return target instanceof Element && (
        !!target.closest('#noVNC_container') ||
        remoteFocused && target === document.body
    );
}

window.addEventListener('pointerdown', event => {
    remoteFocused = event.target instanceof Element && !!event.target.closest('#noVNC_container');
}, true);

async function pasteToRemote(readText, plainText = false) {
    if (busy) return;
    busy = true;
    const rfb = UI.rfb;
    try {
        const text = await readText();
        if (!enabled || !connected() || rfb !== UI.rfb) return;
        if (!text) {
            status.textContent = '붙여넣을 텍스트가 없습니다. 이미지·파일은 지원하지 않습니다.';
            return;
        }
        rfb.clipboardPasteFrom(text);
        // The VNC clipboard transfer is asynchronous. Let the local X server
        // take ownership before sending the application's paste shortcut.
        await new Promise(resolve => setTimeout(resolve, 180));
        if (!enabled || !connected() || rfb !== UI.rfb) return;
        rfb.sendKey(0xffe3, 'ControlLeft', true);
        if (plainText) rfb.sendKey(0xffe1, 'ShiftLeft', true);
        rfb.sendKey(0x76, 'KeyV');
        if (plainText) rfb.sendKey(0xffe1, 'ShiftLeft', false);
        rfb.sendKey(0xffe3, 'ControlLeft', false);
        status.textContent = 'Windows 텍스트를 Linux에 붙여넣었습니다.';
    } catch {
        status.textContent = '클립보드 읽기가 차단됐습니다. 연결 버튼의 권한을 확인하거나 기존 Clipboard 입력란을 사용하세요.';
    } finally {
        busy = false;
    }
}

window.addEventListener('keydown', event => {
    if (!enabled || !connected() || !remoteTarget(event.target)) return;
    const paste = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v';
    const insert = event.shiftKey && event.key === 'Insert';
    if (!paste && !insert) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void pasteToRemote(() => navigator.clipboard.readText(), paste && event.shiftKey);
}, true);

window.addEventListener('paste', event => {
    if (!enabled || !connected() || !remoteTarget(event.target) || !event.clipboardData) return;
    const text = event.clipboardData.getData('text/plain');
    event.preventDefault();
    event.stopImmediatePropagation();
    void pasteToRemote(() => Promise.resolve(text));
}, true);

// noVNC replaces its RFB object on reconnect. Bind only once per connection.
setInterval(() => {
    if (UI.rfb !== attached) {
        if (attached) attached.removeEventListener('clipboard', remoteClipboard);
        attached = UI.rfb;
        if (attached) {
            supportUtf8Clipboard(attached);
            attached.addEventListener('clipboard', remoteClipboard);
        }
    }
    if (!connected() && enabled) {
        enabled = false;
        status.textContent = '원격 연결이 종료됐습니다. 다시 연결한 뒤 클립보드 연결을 눌러 주세요.';
    }
    updateControls();
}, 250);
updateControls();
