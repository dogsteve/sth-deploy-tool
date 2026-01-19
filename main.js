const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const RegistryClient = require('./utils/registry');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 850,
        backgroundColor: '#050505',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        titleBarStyle: 'hiddenInset'
    });

    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// --- Config Management ---
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

ipcMain.handle('load-config', () => {
    if (fs.existsSync(CONFIG_PATH)) {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
    return {
        git_repo_url: '',
        username: '',
        password: '',
        reg_username: '',
        reg_password: '',
        service_configs: {
            "sth-local-api": { registry_url: 'uat-tsn-harbor.xuatnhapcanh.bca:80/sth/sth-api', last_tag: 'v2.0.1' },
            "sth-local-worker": { registry_url: 'uat-tsn-harbor.xuatnhapcanh.bca:80/sth/sth-worker', last_tag: 'v2.0.1' },
            "sth-portal-api": { registry_url: '', last_tag: '' },
            "sth-portal-worker": { registry_url: '', last_tag: '' },
            "sth-portal-fe": { registry_url: '', last_tag: '' }
        }
    };
});

ipcMain.handle('select-file', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Docker Image', extensions: ['tar'] }]
    });
    if (result.canceled) return null;
    return result.filePaths[0];
});

ipcMain.handle('save-config', (event, config) => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return { success: true };
});

ipcMain.handle('show-popup', (event, { type, title, message }) => {
    const { dialog } = require('electron');
    dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
        type: type || 'info',
        title: title,
        message: message,
        buttons: ['OK']
    });
});

// --- Deployment Logic ---
ipcMain.on('run-deploy', async (event, { serviceName, tag, registryUrl, globalConfig, tarPath, manifestPath }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const log = (msg) => win.webContents.send('log-output', msg);

    log(`--- Initiating deployment: ${serviceName}:${tag} ---`);

    try {
        // 1. Prepare Docker Tarball
        let finalTarPath = tarPath;
        if (!finalTarPath) {
            const imagesPath = path.join(process.cwd(), 'images');
            finalTarPath = path.join(imagesPath, `${serviceName}.tar`);
        }

        if (!fs.existsSync(finalTarPath)) {
            log(`Error: Tar file not found at ${finalTarPath}`);
            win.webContents.send('deploy-complete', { serviceName, success: false });
            return;
        }

        // 2. Registry Client Push (No Docker Daemon!)
        const client = new RegistryClient(log);

        let regHost = registryUrl;
        let repoName = serviceName; // Default backup

        // Heuristic to split host and repo
        const parts = registryUrl.split('/');
        if (parts.length > 1) {
            regHost = parts[0];
            repoName = parts.slice(1).join('/'); // "sth/sth-api"
        }

        log(`--- Authenticating with Registry ---`);
        log(`Registry: ${regHost}`);
        log(`Repository: ${repoName}`);

        await client.login(globalConfig.reg_username, globalConfig.reg_password, regHost);

        log(`--- Pushing Image to Registry (Docker-less) ---`);
        await client.pushTarball(finalTarPath, repoName, tag);

        // 3. Git Ops (Replaced simple-git with isomorphic-git)
        const repoDir = path.join(app.getPath('temp'), `repo_${serviceName}_${Date.now()}`);
        if (fs.existsSync(repoDir)) fs.rmSync(repoDir, { recursive: true, force: true });

        fs.mkdirSync(repoDir, { recursive: true });

        log(`--- Cloning Git Repo (isomorphic-git) ---`);
        log(`Clone URL: ${globalConfig.git_repo_url}`);

        await git.clone({
            fs,
            http,
            dir: repoDir,
            url: globalConfig.git_repo_url,
            depth: 1,
            singleBranch: true,
            onAuth: () => ({ username: globalConfig.username, password: globalConfig.password })
        });

        // Identify file to modify
        let targetFilePathRelative = null;

        if (manifestPath && manifestPath.trim() !== '') {
            // User provided an specific path relative to repo root
            const candidate = path.join(repoDir, manifestPath);
            if (fs.existsSync(candidate)) {
                if (fs.statSync(candidate).isDirectory()) {
                    log(`Searching provided directory: ${manifestPath}`);
                    // Use the base identifying name (e.g. "sth-worker") derived from repoName ("sth/sth-worker")
                    const identifier = repoName.split('/').pop();
                    targetFilePathRelative = findYamlFile(candidate, identifier, repoDir);
                } else {
                    targetFilePathRelative = manifestPath;
                }
            } else {
                log(`Warning: Configured manifest path '${manifestPath}' not found in repo. Falling back to search.`);
            }
        }

        if (!targetFilePathRelative) {
            // Use the base identifying name (e.g. "sth-worker") derived from repoName ("sth/sth-worker")
            const identifier = repoName.split('/').pop();
            log(`Looking for YAML containing "${identifier}"...`);
            targetFilePathRelative = findYamlFile(repoDir, identifier, repoDir);
        }

        if (!targetFilePathRelative) {
            log(`Error: Could not find YAML for ${serviceName}`);
            throw new Error('YAML not found');
        }

        log(`Modifying file: ${targetFilePathRelative}`);
        const fullYamlPath = path.join(repoDir, targetFilePathRelative);

        // Use identifier for update if we derived it, or just serviceName/repo suffix
        const identifier = repoName.split('/').pop();
        updateYaml(fullYamlPath, identifier, tag);

        log(`Updated image tag to ${tag} in ${targetFilePathRelative}`);

        // Commit & Push
        log(`--- Committing and Pushing ---`);
        await git.add({ fs, dir: repoDir, filepath: targetFilePathRelative });

        await git.commit({
            fs,
            dir: repoDir,
            message: `Deploy ${serviceName}:${tag}`,
            author: {
                name: globalConfig.username || 'STH Deployer',
                email: 'deployer@example.com'
            }
        });

        log(`Committed: Deploy ${serviceName}:${tag}`);

        await git.push({
            fs,
            http,
            dir: repoDir,
            remote: 'origin',
            ref: 'main', // Assuming main branch
            onAuth: () => ({ username: globalConfig.username, password: globalConfig.password })
        });

        log(`--- DEPLOYMENT SUCCESSFUL ---`);
        win.webContents.send('deploy-complete', { serviceName, success: true, tag });

    } catch (err) {
        log(`Error during deployment: ${err.message}`);

        if (err.response) {
            log(`Details: ${JSON.stringify(err.response.data || err.response.statusText)}`);
        } else if (err.data) {
            // Isomorphic git often puts errors in data
            log(`Details: ${JSON.stringify(err.data)}`);
        } else {
            console.error(err);
        }

        win.webContents.send('deploy-complete', { serviceName, success: false });
    }
});

function findYamlFile(dir, identifier, baseDir) {
    const files = getAllFiles(dir);
    for (const file of files) {
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
            const content = fs.readFileSync(file, 'utf8');
            // Check if file content mentions the service name/identifier
            if (content.includes(identifier)) {
                return path.relative(baseDir, file);
            }
        }
    }
    return null;
}

function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    files.forEach((file) => {
        if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
            if (!file.includes('.git')) {
                arrayOfFiles = getAllFiles(path.join(dirPath, file), arrayOfFiles);
            }
        } else {
            arrayOfFiles.push(path.join(dirPath, file));
        }
    });

    return arrayOfFiles;
}

function updateYaml(filePath, identifier, newTag) {
    const content = fs.readFileSync(filePath, 'utf8');
    // Regex: Look for 'image:' followed by anything, then the identifier (sth-worker), then ':', then capture the old tag
    // User file: image: uat-tsn-harbor.xuatnhapcanh.bca/sth/sth-worker:v2.0.5
    // Regex: image:\s+.*sth-worker:(.*)
    const pattern = new RegExp(`(image:\\s+.*${identifier}:)(.*)`, 'g');
    let newContent = content.replace(pattern, `$1${newTag}`);

    fs.writeFileSync(filePath, newContent);
}
