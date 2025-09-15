const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// --- নিরাপত্তা এবং সংযোগের জন্য CORS কনফিগারেশন ---
const io = socketIo(server, {
  cors: {
    origin: "https://pccontroll.onrender.com", // শুধুমাত্র আপনার ড্যাশবোর্ডের URL থেকে সংযোগ গ্রহণ করবে
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // 'public' ফোল্ডারের ফাইল পরিবেশন করবে

const PORT = process.env.PORT || 3000;
const CORRECT_PASSWORD = '12345678'; // আপনার ৮ ডিজিটের পাসওয়ার্ড এখানে দিন

// --- বিভিন্ন ভ্যারিয়েবল যা প্রোগ্রামের অবস্থা মনে রাখবে ---
let actionToTake = 'none'; // ডিভাইসের জন্য কমান্ড ('none' or 'pulse')
let lastSeenTimeout;
let deviceStatus = 'Offline'; // ডিভাইসের বর্তমান অবস্থা
let latestSensorData = { // সেন্সরের সর্বশেষ ডেটা
    dht11: { temperature: null, humidity: null },
    dht22: { temperature: null, humidity: null }
};

// --- লগইন প্রচেষ্টা ট্র্যাক করার জন্য ---
const loginAttempts = {};
const BLOCK_DURATION = 5 * 60 * 1000; // ৫ মিনিটের জন্য ব্লক করা হবে

// --- NodeMCU থেকে ডেটা গ্রহণ করার জন্য HTTP এন্ডপয়েন্ট ---
app.post('/data', (req, res) => {
    const { log, dht11, dht22 } = req.body;
    
    if (log) {
        io.emit('deviceLog', log); // ড্যাশবোর্ডে লগ পাঠাবে
    }

    // সেন্সরের ডেটা আপডেট করা
    if (dht11) latestSensorData.dht11 = dht11;
    if (dht22) latestSensorData.dht22 = dht22;
    
    io.emit('sensorUpdate', latestSensorData); // সব ড্যাশবোর্ডে সেন্সরের নতুন ডেটা পাঠাবে

    // ডিভাইসের স্ট্যাটাস 'Online' করা
    if (deviceStatus !== 'Online') {
        deviceStatus = 'Online';
        io.emit('deviceStatus', { status: 'Online' });
    }

    // অফলাইন টাইমার রিসেট করা
    clearTimeout(lastSeenTimeout);
    lastSeenTimeout = setTimeout(() => {
        deviceStatus = 'Offline';
        io.emit('deviceStatus', { status: 'Offline' });
    }, 15000); // ১৫ সেকেন্ড কোনো ডেটা না আসলে অফলাইন দেখাবে

    res.json({ action: actionToTake }); // NodeMCU-কে কমান্ড পাঠাবে
    if (actionToTake === 'pulse') {
        actionToTake = 'none'; // কমান্ড পাঠানোর পর রিসেট করবে
    }
});

// --- ড্যাশবোর্ডের সাথে রিয়েল-টাইম যোগাযোগের জন্য Socket.IO ---
io.on('connection', (socket) => {
    let loggedIn = false;

    // লগইন প্রচেষ্টা হ্যান্ডেল করা
    socket.on('loginAttempt', (password) => {
        const ip = socket.handshake.address;
        const now = Date.now();

        if (loginAttempts[ip] && now < loginAttempts[ip].blockUntil) {
            socket.emit('loginBlock', { message: `Too many attempts. Try again in ${Math.ceil((loginAttempts[ip].blockUntil - now) / 60000)} minutes.` });
            return;
        }

        if (password === CORRECT_PASSWORD) {
            loggedIn = true;
            delete loginAttempts[ip];
            socket.emit('loginSuccess');
            socket.emit('deviceStatus', { status: deviceStatus });
            socket.emit('sensorUpdate', latestSensorData);
        } else {
            loginAttempts[ip] = loginAttempts[ip] || { count: 0 };
            loginAttempts[ip].count++;

            if (loginAttempts[ip].count >= 3) {
                loginAttempts[ip].blockUntil = now + BLOCK_DURATION;
                socket.emit('loginBlock', { message: 'Too many attempts. Blocked for 5 minutes.' });
            } else {
                socket.emit('loginFail', { message: `Invalid password. ${3 - loginAttempts[ip].count} attempts remaining.` });
            }
        }
    });

    // 'Start PC' বাটনের কমান্ড হ্যান্ডেল করা
    socket.on('pulseRelay', () => {
        if (loggedIn && deviceStatus === 'Online') {
            console.log('Pulse command received from dashboard.');
            actionToTake = 'pulse';
            io.emit('pulseTriggered'); // সব ক্লায়েন্টকে ফিডব্যাক পাঠানো
        }
    });

    socket.on('disconnect', () => {
        // console.log('A user disconnected from the dashboard.');
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

