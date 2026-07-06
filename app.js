const OLLAMA_URL = '/ollama/api/chat';
const MODEL = 'qwen2.5:3b';

let resumeContext = null;
let systemPromptTemplate = null;
let conversationHistory = [];
let isGenerating = false;

let offTopicPatterns = [];

const REDIRECT_RESPONSES = [
    "I appreciate the creativity, but I'm laser-focused on one thing: helping you figure out if Luis is the right hire. What role are you looking at?",
    "Ha, nice try! But I only talk about Luis's qualifications. Got a job description you'd like me to analyze?",
    "I'm a one-trick pony — and that trick is knowing Luis's resume inside and out. What can I tell you about his experience?",
    "That's outside my wheelhouse. I'm here to help you evaluate Luis as a candidate. What position are you hiring for?",
];

async function loadResumeContext() {
    const [resumeResp, promptResp, guardResp] = await Promise.all([
        fetch('resume-context.json'),
        fetch('system-prompt.txt'),
        fetch('guardrails.json')
    ]);
    resumeContext = await resumeResp.json();
    systemPromptTemplate = await promptResp.text();
    const guardrails = await guardResp.json();
    offTopicPatterns = guardrails.patterns.map(p => new RegExp(p, 'i'));
}

function getSystemPrompt() {
    return systemPromptTemplate.replace('{{RESUME_DATA}}', JSON.stringify(resumeContext));
}

function checkGuardrails(message) {
    for (const pattern of offTopicPatterns) {
        if (pattern.test(message)) {
            return REDIRECT_RESPONSES[Math.floor(Math.random() * REDIRECT_RESPONSES.length)];
        }
    }
    return null;
}

function createMessageElement(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    if (role === 'user') {
        avatar.textContent = '👤';
    } else {
        avatar.innerHTML = '<img src="avatar.png" alt="Luis">';
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = formatMessage(content);

    div.appendChild(avatar);
    div.appendChild(contentDiv);
    return div;
}

function createTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.id = 'typing-indicator';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = '<img src="avatar.png" alt="Luis">';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div><p class="thinking-text">digging through 25 years of experience...</p>';

    div.appendChild(avatar);
    div.appendChild(contentDiv);
    return div;
}

function formatMessage(text) {
    let formatted = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    formatted = formatted.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    formatted = formatted.replace(/^## (.+)$/gm, '<h3>$1</h3>');

    // list markers must convert before the *emphasis* rule eats leading asterisks
    formatted = formatted.replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>');

    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*(.+?)\*/g, '<em>$1</em>');
    formatted = formatted.replace(/`(.+?)`/g, '<code>$1</code>');

    formatted = formatted.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    formatted = formatted.replace(/\n\n/g, '</p><p>');
    formatted = '<p>' + formatted + '</p>';
    formatted = formatted.replace(/<p><h3>/g, '<h3>');
    formatted = formatted.replace(/<\/h3><\/p>/g, '</h3>');
    formatted = formatted.replace(/<p><ul>/g, '<ul>');
    formatted = formatted.replace(/<\/ul><\/p>/g, '</ul>');
    formatted = formatted.replace(/<p>\s*<\/p>/g, '');

    return formatted;
}

async function sendMessage(userMessage) {
    if (isGenerating) return;

    const guardrailBlock = checkGuardrails(userMessage);
    if (guardrailBlock) {
        const chatContainer = document.getElementById('chat-container');
        chatContainer.appendChild(createMessageElement('user', userMessage));
        chatContainer.appendChild(createMessageElement('assistant', guardrailBlock));
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return;
    }

    isGenerating = true;
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;

    const chatContainer = document.getElementById('chat-container');
    chatContainer.appendChild(createMessageElement('user', userMessage));

    conversationHistory.push({ role: 'user', content: userMessage });

    const typingEl = createTypingIndicator();
    chatContainer.appendChild(typingEl);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
        const messages = [
            { role: 'system', content: getSystemPrompt() },
            ...conversationHistory
        ];

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 300000);

        const response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                model: MODEL,
                messages: messages,
                stream: true,
                keep_alive: "30m",
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    num_predict: 1024,
                    num_ctx: 8192
                }
            })
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`Ollama returned ${response.status}`);
        }

        typingEl.remove();

        const assistantMsg = createMessageElement('assistant', '');
        chatContainer.appendChild(assistantMsg);
        const contentDiv = assistantMsg.querySelector('.message-content');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let buffer = '';
        let lastRender = 0;

        const render = () => {
            contentDiv.innerHTML = formatMessage(fullResponse);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // only parse complete lines; a JSON object can span chunks
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line);
                    if (data.message && data.message.content) {
                        fullResponse += data.message.content;
                    }
                } catch (e) {
                    // skip malformed JSON lines
                }
            }

            const now = performance.now();
            if (now - lastRender > 50) {
                lastRender = now;
                render();
            }
        }

        if (buffer.trim()) {
            try {
                const data = JSON.parse(buffer);
                if (data.message && data.message.content) {
                    fullResponse += data.message.content;
                }
            } catch (e) {
                // trailing partial line, ignore
            }
        }

        render();

        conversationHistory.push({ role: 'assistant', content: fullResponse });

        // trim to an even count so user/assistant pairs stay aligned
        if (conversationHistory.length > 20) {
            conversationHistory = conversationHistory.slice(-16 + (conversationHistory.length % 2));
        }

    } catch (error) {
        // drop the unanswered user message so history stays in user/assistant pairs
        conversationHistory.pop();
        typingEl.remove();
        const errorMsg = createMessageElement('assistant',
            "The $150 mini PC in the basement is thinking too hard (or my recipe app is hogging the CPU). Give it a moment and try again."
        );
        chatContainer.appendChild(errorMsg);
    } finally {
        isGenerating = false;
        sendBtn.disabled = false;
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

async function checkOllamaConnection() {
    const statusBar = document.getElementById('status-bar');
    const statusText = statusBar.querySelector('.status-text');
    try {
        const response = await fetch('/ollama/api/tags');
        if (response.ok) {
            statusBar.className = 'status-bar connected';
            statusText.textContent = `Connected to Ollama — model: ${MODEL}`;
        } else {
            throw new Error('Not OK');
        }
    } catch {
        statusBar.className = 'status-bar error';
        statusText.textContent = 'Cannot reach Ollama. Is it running?';
    }
}

async function warmupModel() {
    try {
        await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: getSystemPrompt() },
                    { role: 'user', content: 'hello' }
                ],
                stream: false,
                keep_alive: "30m",
                options: { num_ctx: 8192, num_predict: 1 }
            })
        });
    } catch (e) {
        // warmup failed, that's ok
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadResumeContext();
        checkOllamaConnection();
        warmupModel();
    } catch (e) {
        const statusBar = document.getElementById('status-bar');
        statusBar.className = 'status-bar error';
        statusBar.querySelector('.status-text').textContent = 'Failed to load app data. Try a refresh?';
    }

    const input = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');

    sendBtn.addEventListener('click', () => {
        const msg = input.value.trim();
        if (msg) {
            input.value = '';
            input.style.height = 'auto';
            sendMessage(msg);
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 150) + 'px';
    });
});
