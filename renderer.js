let globalConfig = {};

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
        const cfg = globalConfig.service_configs[name];
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="status-dot" id="dot-${name}"></div>
            <h3>${name.toUpperCase()}</h3>
            
            <div class="drop-zone" id="drop-${name}" onclick="triggerFilePicker('${name}')">
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
            <button onclick="deployService('${name}')">DEPLOYY NOW</button>
        `;
        grid.appendChild(card);

        // Setup DND for this zone
        const dropZone = document.getElementById(`drop-${name}`);

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                handleFileSelection(name, files[0].path);
            }
        });
    });
}

function handleFileSelection(serviceName, fullPath) {
    if (!fullPath.endsWith('.tar')) {
        log(`Error: Please select a .tar file for ${serviceName}`, 'system');
        return;
    }
    serviceFiles[serviceName] = fullPath;
    const fileName = fullPath.split('/').pop() || fullPath.split('\\').pop();
    document.getElementById(`file-${serviceName}`).textContent = fileName;
    log(`Selected image for ${serviceName}: ${fileName}`);
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
    log(`System: Global settings saved.`, 'system');
});

async function deployService(name) {
    const registryUrl = document.getElementById(`reg-${name}`).value;
    const tag = document.getElementById(`tag-${name}`).value;
    const manifestPath = document.getElementById(`path-${name}`).value;

    if (!registryUrl || !tag) {
        log(`Error: Registry URL and Tag required for ${name}`, 'system');
        return;
    }

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
function log(msg, type = '') {
    const line = document.createElement('p');
    line.className = 'log-line ' + type;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    line.textContent = `[${time}] ${msg}`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

function clearLogs() {
    terminal.innerHTML = '<p class="log-line system">> Terminal buffer cleared.</p>';
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

window.api.onLog((msg) => {
    log(msg);
});

window.api.onDeployComplete(({ serviceName, success, tag }) => {
    const dot = document.getElementById(`dot-${serviceName}`);
    if (dot) dot.classList.remove('active');
    if (success) {
        log(`SUCCESS: ${serviceName}:${tag} deployed flawlessly.`, 'system');
        window.api.showPopup({
            type: 'info',
            title: 'Deployment Successful',
            message: `${serviceName}:${tag} has been successfully deployed.`
        });
    } else {
        log(`FAILURE: Deployment of ${serviceName} encountered an error.`, 'system');
        window.api.showPopup({
            type: 'error',
            title: 'Deployment Failed',
            message: `Deployment of ${serviceName} failed. Check logs for details.`
        });
    }
});

init();
