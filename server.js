const WebSocket = require('ws');
const express = require('express');
const { spawn } = require('child_process');

const app = express();
app.use(express.json());

const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

let clients = [];
let serverStartTime = null;
let postHits = 0;
let dataIn = 0;
let dataOut = 0;
const loggedMessages = new Set();
let simulationOptions = { maxDistanceFromLeader: 2, followLeader: true, leaderFollowTarget: false, attackStyle: 'Focused' };

function broadcast(data) {
    const message = { ...data, timestamp: undefined };
    const messageKey = JSON.stringify(message);
    if (!loggedMessages.has(messageKey)) {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
                dataOut += JSON.stringify(data).length;
            }
        });
        loggedMessages.add(messageKey);
        if (loggedMessages.size > 1000) {
            loggedMessages.clear();
        }
    }
}

function formatRuntime() {
    if (!serverStartTime) return '00:00:00';
    const diff = Math.floor((Date.now() - serverStartTime) / 1000);
    const hours = Math.floor(diff / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
    const seconds = (diff % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

setInterval(() => {
    if (serverStartTime) {
        broadcast({
            type: 'status',
            data: {
                runtime: formatRuntime(),
                hits: postHits,
                dataIn,
                dataOut,
            },
        });
    }
}, 1000);

wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    broadcast({ type: 'log', data: 'WebSocket client connected' });
    ws.send(JSON.stringify({ type: 'members', data: clients.map(c => ({
        serial: c.id,
        name: c.name,
        state: { position: { x: c.location.xCoord, y: c.location.yCoord, z: c.location.zCoord } },
        leader: c.isLeader
    })) }));
    ws.send(JSON.stringify({ type: 'scenarios', data: ['follow_leader'] }));
    ws.send(JSON.stringify({ type: 'options', data: simulationOptions }));
});

app.post('/', (req, res) => {
    postHits++;
    const clientData = req.body;
    const id = clientData.id;
    dataIn += JSON.stringify(clientData).length;

    // Update or add client to clients array
    const existingClientIndex = clients.findIndex(c => c.id === id);
    if (existingClientIndex >= 0) {
        clients[existingClientIndex] = { ...clientData, timestamp: Date.now() };
    } else {
        clients.push({ ...clientData, timestamp: Date.now() });
    }

    // Remove stale clients (older than 5 seconds)
    clients = clients.filter(c => Date.now() - c.timestamp <= 5000);

    // Log current clients state
    broadcast({ type: 'log', data: `Current clients: ${JSON.stringify(clients.map(c => ({ id: c.id, position: c.location })))}` });

    // Send updated members to UI
    broadcast({
        type: 'members',
        data: clients.map(c => ({
            serial: c.id,
            name: c.name,
            state: { position: { x: c.location.xCoord, y: c.location.yCoord, z: c.location.zCoord } },
            leader: c.isLeader
        }))
    });

    // Generate grid data for UI
    const gridData = clients.flatMap(c => [
        { x: c.location.xCoord, y: c.location.yCoord, type: c.isLeader ? 'leader' : 'member' },
        ...Object.values(c.mobiles).map(m => ({ x: m.x, y: m.y, type: 'mobile' }))
    ]);
    broadcast({ type: 'grid-update', data: gridData });

    // Log client data
    broadcast({ type: 'log', data: `Received data from ${id}: ${JSON.stringify({ id: clientData.id, location: clientData.location })}` });

    // Send data to Hivemind with options
    const inputData = JSON.stringify({
        collective: clients,
        clientSerial: id,
        options: simulationOptions
    });
    const hivemindProcess = spawn('python', ['Hivemind.py'], { stdio: ['pipe', 'pipe', 'pipe'] });
    hivemindProcess.stdin.write(inputData);
    hivemindProcess.stdin.end();

    // Get response from Hivemind
    let taskOutput = '';
    hivemindProcess.stdout.on('data', (data) => {
        taskOutput += data.toString();
    });

    hivemindProcess.stderr.on('data', (data) => {
        if (!data.toString().includes('[Hivemind Log]')) {
            broadcast({ type: 'log', data: `Hivemind error: ${data.toString()}` });
        }
    });

    hivemindProcess.on('close', (code) => {
        if (code !== 0) {
            console.error(`Hivemind process exited with code ${code}`);
            broadcast({ type: 'log', data: `Hivemind process exited with code ${code}` });
            res.json({ error: 'Hivemind processing failed' });
        } else {
            const task = JSON.parse(taskOutput);
            // Store task in client
            const clientIndex = clients.findIndex(c => c.id === id);
            if (clientIndex >= 0) {
                clients[clientIndex].task = task;
            }
            broadcast({ type: 'log', data: `Task for ${id}: ${JSON.stringify(task)}` });
            res.json(task);
        }
    });
});

app.post('/update-client', (req, res) => {
    const updatedClient = req.body;
    const id = updatedClient.id;
    const existingClientIndex = clients.findIndex(c => c.id === id);
    if (existingClientIndex >= 0) {
        // Preserve previous task if it exists
        const previousTask = clients[existingClientIndex].task;
        clients[existingClientIndex] = { ...updatedClient, timestamp: Date.now(), task: previousTask };
        broadcast({ type: 'log', data: `Updated client ${id} in server: ${JSON.stringify({ id: updatedClient.id, location: updatedClient.location })}` });
        // Update members and grid
        broadcast({
            type: 'members',
            data: clients.map(c => ({
                serial: c.id,
                name: c.name,
                state: { position: { x: c.location.xCoord, y: c.location.yCoord, z: c.location.zCoord } },
                leader: c.isLeader
            }))
        });
        const gridData = clients.flatMap(c => [
            { x: c.location.xCoord, y: c.location.yCoord, type: c.isLeader ? 'leader' : 'member' },
            ...Object.values(c.mobiles).map(m => ({ x: m.x, y: m.y, type: 'mobile' }))
        ]);
        broadcast({ type: 'grid-update', data: gridData });
    }
    res.json({ status: 'success' });
});

app.post('/update-options', (req, res) => {
    const { maxDistanceFromLeader, followLeader, leaderFollowTarget, attackStyle } = req.body;
    simulationOptions = {
        maxDistanceFromLeader: Math.max(0, Math.min(20, Number(maxDistanceFromLeader))),
        followLeader: Boolean(followLeader),
        leaderFollowTarget: Boolean(leaderFollowTarget),
        attackStyle: ['AoE', 'Focused', 'Balanced'].includes(attackStyle) ? attackStyle : 'Focused'
    };
    broadcast({ type: 'options', data: simulationOptions });
    broadcast({ type: 'log', data: `Updated simulation options: ${JSON.stringify(simulationOptions)}` });
    res.json({ status: 'success' });
});

server.listen(3000, () => {
    serverStartTime = Date.now();
    console.log('Server running on port 3000');
    broadcast({ type: 'log', data: 'Server started on port 3000' });
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, closing server');
    wss.clients.forEach((client) => client.terminate());
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});