document.addEventListener('DOMContentLoaded', () => {
    // --- State Variables ---
    let socket = null;
    let deviceOnline = false;
    const maxLogLines = 150;

    // --- DOM Elements ---
    // Containers
    const loginContainer = document.getElementById('login-container');
    const dashboardContainer = document.getElementById('dashboard-container');
    
    // Forms & Inputs
    const loginForm = document.getElementById('login-form');
    const passwordInput = document.getElementById('password');
    const loginError = document.getElementById('login-error');
    const loginBtn = document.getElementById('login-btn');
    
    // Status Elements
    const serverStatus = document.getElementById('server-status');
    const deviceStatus = document.getElementById('device-status');
    const logoutBtn = document.getElementById('logout-btn');
    
    // Action Buttons
    const pulseBtn = document.getElementById('pulse-btn');
    const restartBtn = document.getElementById('restart-btn');
    const actionFeedback = document.getElementById('action-feedback');
    
    // Sensors
    const dht11Temp = document.querySelector('#dht11-temp .value');
    const dht11TempBar = document.querySelector('#dht11-temp .progress-bar-fill');
    const dht11Humi = document.querySelector('#dht11-humi .value');
    const dht11HumiBar = document.querySelector('#dht11-humi .progress-bar-fill');
    
    const dht22Temp = document.querySelector('#dht22-temp .value');
    const dht22TempBar = document.querySelector('#dht22-temp .progress-bar-fill');
    const dht22Humi = document.querySelector('#dht22-humi .value');
    const dht22HumiBar = document.querySelector('#dht22-humi .progress-bar-fill');
    
    // Log console
    const logConsole = document.getElementById('log-console');
    const clearLogsBtn = document.getElementById('clear-logs-btn');

    // --- Auto-Login Check ---
    const savedPassword = localStorage.getItem('pc_dashboard_pass');
    if (savedPassword) {
        initSocketConnection(savedPassword);
    } else {
        showLogin();
    }

    // --- Login Handlers ---
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const password = passwordInput.value.trim();
        if (!password) return;
        
        loginBtn.disabled = true;
        loginBtn.querySelector('span').innerText = 'Authenticating...';
        initSocketConnection(password);
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('pc_dashboard_pass');
        if (socket) {
            socket.disconnect();
        }
        showLogin();
        appendLog('SYSTEM', 'Logged out successfully.');
    });

    clearLogsBtn.addEventListener('click', () => {
        logConsole.innerHTML = '';
        appendLog('SYSTEM', 'Console cleared.');
    });

    // --- Control Handlers ---
    pulseBtn.addEventListener('click', () => {
        if (!deviceOnline) return;
        triggerRipple(pulseBtn);
        socket.emit('pulseRelay');
        showFeedback('Triggered power button pulse...');
    });

    restartBtn.addEventListener('click', () => {
        if (!deviceOnline) return;
        triggerRipple(restartBtn);
        socket.emit('restartRelay');
        showFeedback('Triggered reset button pulse...');
    });

    // --- Helper Functions ---
    function showLogin() {
        loginContainer.classList.add('active');
        dashboardContainer.classList.remove('active');
        loginBtn.disabled = false;
        loginBtn.querySelector('span').innerText = 'Unlock Control Center';
        passwordInput.value = '';
    }

    function showDashboard() {
        loginContainer.classList.remove('active');
        dashboardContainer.classList.add('active');
    }

    function initSocketConnection(password) {
        // Clear old connection if any
        if (socket) {
            socket.disconnect();
        }

        // Initialize Socket.IO
        socket = io();

        // Server Connection Status Events
        socket.on('connect', () => {
            updateStatusBadge(serverStatus, true, 'Server: Online');
            appendLog('SYSTEM', 'Connected to PC Control Server.');
            
            // Attempt to login with password
            socket.emit('loginAttempt', password);
        });

        socket.on('disconnect', () => {
            updateStatusBadge(serverStatus, false, 'Server: Offline');
            updateStatusBadge(deviceStatus, false, 'ESP32: Offline');
            deviceOnline = false;
            disableControlButtons();
            appendLog('SYSTEM', 'Disconnected from PC Control Server.');
        });

        // Authentication Events
        socket.on('loginSuccess', () => {
            localStorage.setItem('pc_dashboard_pass', password);
            showDashboard();
            appendLog('SUCCESS', 'Access granted. Welcome to Control Center.');
        });

        socket.on('loginFail', (data) => {
            localStorage.removeItem('pc_dashboard_pass');
            showLogin();
            loginError.textContent = data.message || 'Incorrect password.';
            appendLog('ERROR', `Login failed: ${data.message}`);
        });

        socket.on('loginBlock', (data) => {
            localStorage.removeItem('pc_dashboard_pass');
            showLogin();
            loginError.textContent = data.message || 'Blocked due to too many attempts.';
            appendLog('ERROR', `IP Blocked: ${data.message}`);
        });

        // Telemetry Events
        socket.on('deviceStatus', (data) => {
            const isOnline = (data.status === 'Online');
            deviceOnline = isOnline;
            updateStatusBadge(deviceStatus, isOnline, `ESP32: ${data.status}`);
            
            if (isOnline) {
                enableControlButtons();
                appendLog('SYSTEM', 'ESP32 controller node is ONLINE.');
            } else {
                disableControlButtons();
                appendLog('WARN', 'ESP32 controller node went OFFLINE.');
            }
        });

        socket.on('sensorUpdate', (data) => {
            updateSensors(data);
        });

        socket.on('deviceLog', (message) => {
            let logType = 'INFO';
            let cleanedMsg = message;
            
            if (message.includes('[WARN]')) {
                logType = 'WARN';
                cleanedMsg = message.replace('[WARN]', '').trim();
            } else if (message.includes('[ERROR]')) {
                logType = 'ERROR';
                cleanedMsg = message.replace('[ERROR]', '').trim();
            } else if (message.includes('[SUCCESS]')) {
                logType = 'SUCCESS';
                cleanedMsg = message.replace('[SUCCESS]', '').trim();
            } else if (message.includes('[INFO]')) {
                cleanedMsg = message.replace('[INFO]', '').trim();
            }

            appendLog(logType, cleanedMsg);
        });

        socket.on('pulseTriggered', () => {
            appendLog('SUCCESS', 'Server processed Power button pulse action.');
        });

        socket.on('restartTriggered', () => {
            appendLog('SUCCESS', 'Server processed Reset button pulse action.');
        });
    }

    function updateStatusBadge(badgeElement, isActive, text) {
        const indicator = badgeElement.querySelector('.indicator');
        const textSpan = badgeElement.querySelector('.status-text');
        
        if (isActive) {
            indicator.className = 'indicator green';
        } else {
            indicator.className = 'indicator red';
        }
        textSpan.textContent = text;
    }

    function enableControlButtons() {
        pulseBtn.disabled = false;
        restartBtn.disabled = false;
    }

    function disableControlButtons() {
        pulseBtn.disabled = true;
        restartBtn.disabled = true;
    }

    function updateSensors(data) {
        // DHT11
        if (data.dht11) {
            const t = data.dht11.temperature;
            const h = data.dht11.humidity;
            
            dht11Temp.textContent = t !== null && t !== undefined ? parseFloat(t).toFixed(1) : '--';
            dht11TempBar.style.width = t !== null && t !== undefined ? `${Math.min(100, Math.max(0, (t / 50) * 100))}%` : '0%';
            
            dht11Humi.textContent = h !== null && h !== undefined ? parseFloat(h).toFixed(0) : '--';
            dht11HumiBar.style.width = h !== null && h !== undefined ? `${Math.min(100, Math.max(0, h))}%` : '0%';
        }
        
        // DHT22
        if (data.dht22) {
            const t = data.dht22.temperature;
            const h = data.dht22.humidity;
            
            dht22Temp.textContent = t !== null && t !== undefined ? parseFloat(t).toFixed(1) : '--';
            dht22TempBar.style.width = t !== null && t !== undefined ? `${Math.min(100, Math.max(0, (t / 50) * 100))}%` : '0%';
            
            dht22Humi.textContent = h !== null && h !== undefined ? parseFloat(h).toFixed(0) : '--';
            dht22HumiBar.style.width = h !== null && h !== undefined ? `${Math.min(100, Math.max(0, h))}%` : '0%';
        }
    }

    function appendLog(level, message) {
        const time = new Date().toLocaleTimeString();
        const logLine = document.createElement('div');
        logLine.className = 'log-line';
        
        let levelClass = 'info-msg';
        if (level === 'WARN') levelClass = 'warn-msg';
        else if (level === 'ERROR') levelClass = 'error-msg-line';
        else if (level === 'SYSTEM') levelClass = 'system-msg';
        else if (level === 'SUCCESS') levelClass = 'success-msg';

        logLine.innerHTML = `<span class="log-timestamp">[${time}]</span><span class="${levelClass}">[${level}]</span> ${message}`;
        
        logConsole.appendChild(logLine);
        
        // Prune excessive log messages
        while (logConsole.childElementCount > maxLogLines) {
            logConsole.removeChild(logConsole.firstChild);
        }
        
        // Auto scroll to bottom
        logConsole.scrollTop = logConsole.scrollHeight;
    }

    function showFeedback(text) {
        actionFeedback.textContent = text;
        actionFeedback.className = 'action-feedback-visible';
        setTimeout(() => {
            actionFeedback.className = 'action-feedback-hidden';
        }, 3000);
    }

    function triggerRipple(element) {
        const ripple = element.querySelector('.btn-ripple');
        if (!ripple) return;
        
        ripple.classList.remove('active');
        // Trigger reflow
        void ripple.offsetWidth;
        ripple.classList.add('active');
    }
});
