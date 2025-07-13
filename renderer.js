const { ipcRenderer } = require('electron');

function App() {
    const [logs, setLogs] = React.useState([]);
    const [members, setMembers] = React.useState([]);
    const [leader, setLeader] = React.useState('');
    const [alwaysOnTop, setAlwaysOnTop] = React.useState(true);
    const [status, setStatus] = React.useState({ runtime: '00:00:00', hits: 0, dataIn: 0, dataOut: 0 });
    const [viewMode, setViewMode] = React.useState('full');
    const [activeTab, setActiveTab] = React.useState('Main');
    const [options, setOptions] = React.useState(() => {
        try {
            return JSON.parse(localStorage.getItem('hivemind-options') || '{}');
        } catch {
            return { maxDistanceFromLeader: 2, followLeader: true };
        }
    });
    const [scenarios, setScenarios] = React.useState(['follow_leader']);
    const [selectedScenario, setSelectedScenario] = React.useState('');
    const [simGrid, setSimGrid] = React.useState([]);
    const [simMembers, setSimMembers] = React.useState(1);
    const [simIterations, setSimIterations] = React.useState('');
    const [simulationRunning, setSimulationRunning] = React.useState(false);

    const logAreaRef = React.useRef(null);
    const wsRef = React.useRef(null);

    const updateOption = (key, value) => {
        setOptions((prev) => {
            const updated = { ...prev, [key]: value };
            localStorage.setItem('hivemind-options', JSON.stringify(updated));
            fetch('http://localhost:3000/update-options', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated)
            })
                .then(() => setLogs(prev => [...prev, `${new Date().toLocaleTimeString('en-US', { hour12: false })} Options updated: ${JSON.stringify(updated)}`].slice(-100)))
                .catch(err => setLogs(prev => [...prev, `${new Date().toLocaleTimeString('en-US', { hour12: false })} Error updating options: ${err.message}`].slice(-100)));
            return updated;
        });
    };

    const optionBoxStyle = {
        flex: '1 1 45%',
        padding: '2px 4px',
        borderRight: '1px solid gold',
        borderBottom: '1px solid gold',
        boxSizing: 'border-box'
    };

    const optionsToggle = ({ label, key }) => (
        <div style={optionBoxStyle}>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {label}
                <input type="checkbox" checked={options[key] || false} onChange={(e) => updateOption(key, e.target.checked)} />
            </label>
        </div>
    );

    const optionsSlider = ({ label, key, min = 0, max = 100, step = 1 }) => (
        <div style={optionBoxStyle}>
            <label style={{ display: 'flex', flexDirection: 'column' }}>
                {label} ({options[key] ?? min})
                <input type="range" min={min} max={max} step={step} value={options[key] ?? min} onChange={(e) => updateOption(key, Number(e.target.value))} />
            </label>
        </div>
    );

    const runSimulation = () => {
        if (selectedScenario !== 'follow_leader' || simulationRunning) return;
        setSimulationRunning(true);
        window.simulationRunning = true;
        window.runSimulation(
            simMembers,
            simIterations,
            (clients) => {
                setSimGrid(clients.flatMap(c => [
                    { x: c.location.xCoord, y: c.location.yCoord, type: c.isLeader ? 'leader' : 'member' },
                    ...Object.values(c.mobiles).map(m => ({ x: m.x, y: m.y, type: 'mobile' }))
                ]));
                setMembers(clients.map(c => ({
                    serial: c.id,
                    name: c.name,
                    state: { position: { x: c.location.xCoord, y: c.location.yCoord, z: c.location.zCoord } },
                    leader: c.isLeader
                })));
            },
            (log) => setLogs(prev => [...prev, `${new Date().toLocaleTimeString('en-US', { hour12: false })} ${log}`].slice(-100)),
            () => {
                setSimulationRunning(false);
                window.simulationRunning = false;
            }
        );
    };

    React.useEffect(() => {
        const ws = new WebSocket('ws://localhost:3000');
        wsRef.current = ws;
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'scenarios') setScenarios(msg.data);
            if (msg.type === 'grid-update') setSimGrid(msg.data);
            if (msg.type === 'log') setLogs(prev => [...prev, `${new Date().toLocaleTimeString('en-US', { hour12: false })} ${msg.data}`].slice(-100));
            if (msg.type === 'members') setMembers(msg.data);
            if (msg.type === 'status') setStatus(msg.data);
            if (msg.type === 'options') setOptions(msg.data);
        };
        return () => ws.close();
    }, []);

    const renderSimulationGrid = () => {
        const gridSize = 20;
        const cellStyle = {
            width: 10,
            height: 10,
            display: 'inline-block',
            textAlign: 'center',
            fontSize: 8,
            lineHeight: '10px'
        };
        const iconMap = {
            leader: '👑',
            member: '🤖',
            mobile: '📱',
            obstacle: '⬛'
        };

        const leaderClient = members.find(c => c.leader);
        const leaderPos = leaderClient ? leaderClient.state.position : { x: 0, y: 0 };
        const offsetX = 10 - leaderPos.x;
        const offsetY = 10 - leaderPos.y;

        const grid = [];
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                const dataX = x - offsetX;
                const dataY = y - offsetY;
                const item = simGrid.find(e => e.x === dataX && e.y === dataY);
                grid.push(
                    <div key={`${x},${y}`} style={cellStyle}>
                        {item ? iconMap[item.type] : '·'}
                    </div>
                );
            }
        }
        return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridSize}, 10px)`, gap: 1, margin: '0 auto' }}>{grid}</div>;
    };

    const renderPageContent = () => {
        switch (activeTab) {
            case 'Main':
                return (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0' }}>
                            <div>
                                <button onClick={startServer}>Start Server</button>
                                <button onClick={stopServer}>Stop Server</button>
                                <button onClick={() => setLogs((prev) => [...prev, `${new Date().toLocaleTimeString('en-US', { hour12: false })} Upgrade clicked`])}>Upgrade</button>
                            </div>
                            <select style={{ minWidth: '120px' }} value={leader} onChange={handleLeaderChange}>
                                <option value="" disabled>Select Leader</option>
                                {members.map((member) => (
                                    <option key={member.serial} value={member.serial}>{member.name || member.serial}</option>
                                ))}
                            </select>
                        </div>
                        <div id="status-bar">
                            <span>Runtime: {status.runtime} • Hits: {status.hits} • Data In/Out: {status.dataIn}/{status.dataOut}</span>
                        </div>
                    </>
                );
            case 'Options':
                return (
                    <div style={{ padding: '0', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                        {optionsSlider({ label: 'Max Distance from Leader', key: 'maxDistanceFromLeader', min: 0, max: 20, step: 1 })}
                        {optionsToggle({ label: 'Follow Leader', key: 'followLeader' })}
                    </div>
                );
            case 'Simulations':
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <label>Scenario:
                                <select value={selectedScenario} onChange={(e) => setSelectedScenario(e.target.value)}>
                                    <option value="">Select Scenario</option>
                                    {scenarios.map((s) => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                            </label>
                            <label>Members:
                                <input type="range" min="1" max="25" value={simMembers} onChange={(e) => setSimMembers(Number(e.target.value))} style={{ maxWidth: '100px' }} />
                            </label>
                            <label>Iterations:
                                <input type="text" value={simIterations} maxLength={5} onChange={(e) => setSimIterations(e.target.value)} style={{ width: '50px' }} />
                            </label>
                            <button onClick={runSimulation} disabled={simulationRunning || selectedScenario !== 'follow_leader'}>
                                {simulationRunning ? 'Running...' : 'Run Simulation'}
                            </button>
                            <button onClick={() => { window.stopSimulation(); setSimulationRunning(false); }} disabled={!simulationRunning}>
                                Stop Simulation
                            </button>
                        </div>
                        {renderSimulationGrid()}
                    </div>
                );
            default:
                return <div style={{ padding: '8px' }}>{activeTab} Page Placeholder</div>;
        }
    };

    React.useEffect(() => {
        ipcRenderer.on('server-log', (event, message) => {
            const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
            setLogs((prev) => [...prev, `${timestamp} ${message}`].slice(-100));
        });
        return () => {
            ipcRenderer.removeAllListeners('server-log');
            if (wsRef.current) wsRef.current.close();
        };
    }, []);

    React.useEffect(() => {
        if (logAreaRef.current) {
            logAreaRef.current.scrollTop = logAreaRef.current.scrollHeight;
        }
    }, [logs]);

    React.useEffect(() => {
        ipcRenderer.send('resize-window', { width: 400, height: viewMode === 'full' ? 300 : 115 });
    }, [viewMode]);

    const toggleViewMode = () => setViewMode((prev) => (prev === 'full' ? 'minimal' : 'full'));
    const startServer = () => { ipcRenderer.send('start-server'); connectWebSocket(); };
    const stopServer = () => { ipcRenderer.send('stop-server'); if (wsRef.current) wsRef.current.close(); };
    const toggleAlwaysOnTop = () => setAlwaysOnTop((prev) => { const newValue = !prev; ipcRenderer.send('set-always-on-top', newValue); return newValue; });
    const handleLeaderChange = (e) => {
        const newLeaderSerial = e.target.value;
        setLeader(newLeaderSerial);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'set-leader', data: { serial: newLeaderSerial } }));
        }
    };

    const connectWebSocket = () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
        const ws = new WebSocket('ws://localhost:3000');
        wsRef.current = ws;
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'scenarios') setScenarios(msg.data);
            if (msg.type === 'grid-update') setSimGrid(msg.data);
            if (msg.type === 'log') setLogs(prev => [...prev, `${new Date().toLocaleTimeString('en-US', { hour12: false })} ${msg.data}`].slice(-100));
            if (msg.type === 'members') setMembers(msg.data);
            if (msg.type === 'status') setStatus(msg.data);
            if (msg.type === 'options') setOptions(msg.data);
        };
    };

    const copyLogs = () => navigator.clipboard.writeText(logs.join('\n'));
    const clearLogs = () => setLogs([]);

    return (
        <div id="app">
            <div id="window-controls">
                <span id="title-bar">Hivemind</span>
                <button onClick={toggleViewMode}>{viewMode === 'full' ? '▿' : '▵'}</button>
                <button onClick={toggleAlwaysOnTop}>{alwaysOnTop ? '🔒' : '🔓'}</button>
                <button onClick={() => ipcRenderer.send('window-close')}>×</button>
            </div>

            <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-evenly', borderBottom: '1px solid gold', paddingBottom: '4px' }}>
                {['Main', 'Settings', 'Options', 'Simulations', 'Logs'].map((tab) => (
                    <span
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            cursor: 'pointer',
                            fontWeight: activeTab === tab ? 'bold' : 'normal',
                            transition: 'color 0.2s',
                            color: 'gold'
                        }}
                        onMouseEnter={(e) => (e.target.style.textShadow = '0 0 4px gold')}
                        onMouseLeave={(e) => (e.target.style.textShadow = 'none')}
                    >
                        {tab}
                    </span>
                ))}
            </div>

            {viewMode === 'full' && renderPageContent()}

            <div style={{ position: 'relative', flexGrow: viewMode === 'full' ? 1 : 0 }}>
                <textarea
                    id="logs"
                    ref={logAreaRef}
                    rows={viewMode === 'full' && activeTab === 'Main' ? 12 : 1}
                    readOnly
                    value={viewMode === 'full' && activeTab === 'Main' ? logs.slice().reverse().join('\n') : (logs.length > 0 ? logs[logs.length - 1] : '')}
                    style={{ whiteSpace: 'nowrap', overflowX: 'hidden', color: 'gold' }}
                />
                {viewMode === 'full' && activeTab === 'Main' && (
                    <div id="log-controls">
                        <button onClick={copyLogs}>📋</button>
                        <button onClick={clearLogs}>🗑️</button>
                    </div>
                )}
            </div>
        </div>
    );
}

ReactDOM.render(<App />, document.getElementById('root'));