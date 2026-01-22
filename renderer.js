let globalConfig = {};
let activeService = null;
const serviceLogs = {}; // { serviceName: [{ msg, type, time }] }

async function init() {
    globalConfig = await window.api.loadConfig();

    // Fill Sidebar
    document.getElementById('git_repo_url').value = globalConfig.git_repo_url || '';
    document.getElementById('username').value = globalConfig.username || '';
    document.getElementById('password').value = globalConfig.password || '';

    // NEW: Registry Credentials
    if (document.getElementById('reg_username')) {
        document.getElementById('reg_username').value = globalConfig.reg_username || '';
    }
    if (document.getElementById('reg_password')) {
        document.getElementById('reg_password').value = globalConfig.reg_password || '';
    }

    // Render Services
    renderServices();
}

const serviceFiles = {}; // Store selected tar path per service

function renderServices() {
    const grid = document.getElementById('service_grid');
    grid.innerHTML = '';

    Object.keys(globalConfig.service_configs).forEach(name => {
        // Initialize logs for this service if not present
        if (!serviceLogs[name]) serviceLogs[name] = [];

        const cfg = globalConfig.service_configs[name];
        const card = document.createElement('div');
        card.className = 'card';
        card.id = `card-${name}`;

        // Select service on click
        card.onclick = (e) => {
            // Prevent triggering if clicking inputs or buttons
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('.drop-zone')) return;
            selectService(name);
        };

        card.innerHTML = `
            <div class="status-dot" id="dot-${name}"></div>
            <h3>${name.toUpperCase()}</h3>
            
            <div class="drop-zone" id="drop-${name}">
                <p id="label-${name}">Drop .tar or Click to select</p>
                <div class="file-name" id="file-${name}">-</div>
            </div>

            <div class="input-group">
                <label>Registry Registry</label>
                <input type="text" id="reg-${name}" value="${cfg.registry_url || ''}" placeholder="example.com/project">
            </div>
            <div class="input-group">
                <label>Deploy Tag</label>
                <input type="text" id="tag-${name}" value="${cfg.last_tag || ''}" placeholder="vX.X.X">
            </div>
            <div class="input-group">
                <label>Manifest Path (Optional)</label>
                <input type="text" id="path-${name}" value="${cfg.manifest_path || ''}" placeholder="manifests/service/values.yaml">
            </div>
            <div style="display: flex; gap: 10px; margin-top: 5px;">
                <button class="secondary btn-view-logs" style="flex: 1;">VIEW LOGS</button>
                <button class="btn-deploy" style="flex: 1;">DEPLOY NOW</button>
            </div>
        `;
        grid.appendChild(card);

        // Bind Events

        // 1. Drop Zone Click
        const dropZone = document.getElementById(`drop-${name}`);
        dropZone.onclick = () => triggerFilePicker(name);

        // 2. View Logs Button
        const viewLogsBtn = card.querySelector('.btn-view-logs');
        viewLogsBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent card click
            selectService(name);
        });

        // 3. Deploy Button
        const deployBtn = card.querySelector('.btn-deploy');
        deployBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent card click
            deployService(name);
        });

        // Setup DND for this zone
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                handleFileSelection(name, files[0].path);
            }
        });
    });
}

function selectService(name) {
    if (activeService === name) return;

    // Update active state
    activeService = name;

    // Update UI highlights
    document.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
    const card = document.getElementById(`card-${name}`);
    if (card) card.classList.add('active');

    // Update Terminal Header
    const termHeader = document.querySelector('.terminal-header span');
    if (termHeader) termHeader.textContent = `LIVE LOGS: ${name.toUpperCase()}`;

    // Re-render logs
    renderLogsForService(name);
}

function renderLogsForService(name) {
    const term = document.getElementById('terminal');
    term.innerHTML = ''; // Clear current

    // If no logs yet
    if (!serviceLogs[name] || serviceLogs[name].length === 0) {
        const line = document.createElement('p');
        line.className = 'log-line system';
        line.textContent = `> Ready to deploy ${name}...`;
        term.appendChild(line);
        return;
    }

    // Append all stored logs
    serviceLogs[name].forEach(logEntry => {
        appendLogToTerminal(logEntry.msg, logEntry.type, logEntry.time);
    });

    term.scrollTop = term.scrollHeight;
}

function handleFileSelection(serviceName, fullPath) {
    if (!fullPath.endsWith('.tar')) {
        log(serviceName, `Error: Please select a .tar file for ${serviceName}`, 'system');
        return;
    }
    serviceFiles[serviceName] = fullPath;
    const fileName = fullPath.split('/').pop() || fullPath.split('\\').pop();
    document.getElementById(`file-${serviceName}`).textContent = fileName;
    log(serviceName, `Selected image for ${serviceName}: ${fileName}`);
}

async function triggerFilePicker(serviceName) {
    const filePath = await window.api.selectFile();
    if (filePath) {
        handleFileSelection(serviceName, filePath);
    }
}

document.getElementById('save_global').addEventListener('click', async () => {
    globalConfig.git_repo_url = document.getElementById('git_repo_url').value;
    globalConfig.username = document.getElementById('username').value;
    globalConfig.password = document.getElementById('password').value;

    // NEW: Registry Credentials
    globalConfig.reg_username = document.getElementById('reg_username').value;
    globalConfig.reg_password = document.getElementById('reg_password').value;

    await window.api.saveConfig(globalConfig);
    // Log this globally or to active service? Let's just alert
    window.api.showPopup({ type: 'info', title: 'Saved', message: 'Global settings saved.' });
});

async function deployService(name) {
    const registryUrl = document.getElementById(`reg-${name}`).value;
    const tag = document.getElementById(`tag-${name}`).value;
    const manifestPath = document.getElementById(`path-${name}`).value;

    if (!registryUrl || !tag) {
        window.api.showPopup({ type: 'error', title: 'Missing Info', message: `Registry URL and Tag required for ${name}` });
        return;
    }

    // Auto-select this service to show its logs
    selectService(name);

    // Clear previous logs for this run
    serviceLogs[name] = [];
    renderLogsForService(name);

    // Update local config but don't save registry credentials per service (they are global in sidebar)
    globalConfig.service_configs[name].registry_url = registryUrl;
    globalConfig.service_configs[name].last_tag = tag;
    globalConfig.service_configs[name].manifest_path = manifestPath;
    await window.api.saveConfig(globalConfig);

    const dot = document.getElementById(`dot-${name}`);
    if (dot) dot.classList.add('active');

    window.api.runDeploy({
        serviceName: name,
        tag: tag,
        registryUrl: registryUrl,
        globalConfig: globalConfig,
        tarPath: serviceFiles[name] || null,
        manifestPath: manifestPath // Pass explicit path
    });
}

// Log Handling
const terminal = document.getElementById('terminal');

// New log function manages storage
function log(serviceName, msg, type = '') {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    // Store
    if (!serviceLogs[serviceName]) serviceLogs[serviceName] = [];
    serviceLogs[serviceName].push({ msg, type, time });

    // If viewing this service, append to UI
    if (activeService === serviceName) {
        appendLogToTerminal(msg, type, time);
    }
}

function appendLogToTerminal(msg, type, time) {
    const line = document.createElement('p');
    line.className = 'log-line ' + type;
    line.textContent = `[${time}] ${msg}`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

function clearLogs() {
    if (activeService) {
        serviceLogs[activeService] = [];
        renderLogsForService(activeService);
    } else {
        terminal.innerHTML = '<p class="log-line system">> Terminal buffer cleared.</p>';
    }
}

const expandBtn = document.getElementById('expand-btn');
const overlay = document.getElementById('terminal-overlay');
let isExpanded = false;

function toggleTerminal() {
    isExpanded = !isExpanded;
    const term = document.getElementById('terminal');

    if (isExpanded) {
        term.classList.add('expanded');
        overlay.classList.add('active');
        expandBtn.textContent = '⤡'; // Minimize icon
    } else {
        term.classList.remove('expanded');
        overlay.classList.remove('active');
        expandBtn.textContent = '⤢'; // Expand icon
    }
}

expandBtn.addEventListener('click', toggleTerminal);
overlay.addEventListener('click', toggleTerminal); // Click outside to close

// Updated to receive object
window.api.onLog((payload) => {
    // payload: { serviceName, message, type }
    if (typeof payload === 'string') {
        // Fallback for old messages if any
        if (activeService) log(activeService, payload);
    } else {
        log(payload.serviceName, payload.message, payload.type);
    }
});

window.api.onDeployComplete(({ serviceName, success, tag }) => {
    const dot = document.getElementById(`dot-${serviceName}`);
    if (dot) dot.classList.remove('active');

    if (success) {
        log(serviceName, `SUCCESS: ${serviceName}:${tag} deployed flawlessly.`, 'system');
        window.api.showPopup({
            type: 'info',
            title: 'Deployment Successful',
            message: `${serviceName}:${tag} has been successfully deployed.`
        });
    } else {
        log(serviceName, `FAILURE: Deployment of ${serviceName} encountered an error.`, 'system');
        window.api.showPopup({
            type: 'error',
            title: 'Deployment Failed',
            message: `Deployment of ${serviceName} failed. Check logs for details.`
        });
    }
});

init();
