const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const net = require('net');

let mainWindow = null;
let serverProcess = null;

function checkAndFreePort(port, callback) {
    const server = net.createServer();
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            mainWindow.webContents.send('server-log', `Port ${port} is in use. Attempting to free it...`);
            const { exec } = require('child_process');
            const command = `netstat -aon | findstr LISTENING | findstr :${port}`;
            exec(command, (execErr, stdout) => {
                if (execErr || !stdout) {
                    mainWindow.webContents.send('server-log', `Could not find process on port ${port}.`);
                    return;
                }
                const pid = stdout.trim().split(/\s+/).pop();
                if (!pid || pid === '0') {
                    mainWindow.webContents.send('server-log', `Could not identify process on port ${port}.`);
                    return;
                }
                exec(`taskkill /PID ${pid} /F`, (killErr) => {
                    if (killErr) {
                        mainWindow.webContents.send('server-log', `Failed to kill process ${pid}.`);
                        return;
                    }
                    mainWindow.webContents.send('server-log', `Freed port ${port} (PID ${pid}).`);
                    setTimeout(callback, 500);
                });
            });
        } else {
            mainWindow.webContents.send('server-log', `Port check error: ${err.message}`);
        }
    });
    server.once('listening', () => {
        server.close(callback);
    });
    server.listen(port);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 400,
        height: 300,
        frame: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    mainWindow.setAlwaysOnTop(true);
    mainWindow.loadFile('index.html');
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

ipcMain.on('start-server', (event) => {
    if (serverProcess && !serverProcess.killed) {
        event.sender.send('server-log', 'Server is already running');
        return;
    }
    checkAndFreePort(3000, () => {
        serverProcess = spawn('node', ['server.js'], { stdio: 'inherit' });
        serverProcess.on('error', (err) => {
            event.sender.send('server-log', `Server error: ${err.message}`);
            serverProcess = null;
        });
        serverProcess.on('close', (code) => {
            event.sender.send('server-log', `Server stopped (code ${code})`);
            serverProcess = null;
        });
        event.sender.send('server-log', 'Server started');
    });
});

ipcMain.on('stop-server', (event) => {
    if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
        event.sender.send('server-log', 'Server stop signal sent');
    } else {
        event.sender.send('server-log', 'Server is not running');
    }
});

ipcMain.on('set-always-on-top', (event, value) => {
    if (mainWindow) {
        mainWindow.setAlwaysOnTop(value);
    }
});

ipcMain.on('resize-window', (event, { width, height }) => {
    if (mainWindow) {
        mainWindow.setResizable(true);
        mainWindow.setSize(width, height, true);
        mainWindow.setResizable(false);
    }
});

ipcMain.on('window-close', () => {
    app.quit();
});

app.on('window-all-closed', () => {
    if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('quit', () => {
    if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
    }
});

app.whenReady().then(() => {
    createWindow();
});
