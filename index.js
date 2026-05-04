const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const os = require('os');
const fs = require('fs');

const app = express();
app.use(cors());

const PORT = 3003;

let apiResponseData = {
    "phien": "Đang chờ dữ liệu...",
    "tong_diem": 0,
    "ket_qua": "Đang chờ kết nối...",
    "md5": "",
    "chuoi_ket_qua": "",
    "thoi_gian_cap_nhat": "",
    "id": "@tranhoang2286"
};

let currentSessionId = null;
let currentMd5 = "";
const patternHistory = [];
// Cờ đánh dấu để chỉ lấy phiên thực tế vừa xổ, bỏ qua lịch sử lúc mới bật tool
let isFirstHistoryIgnored = false;

const WEBSOCKET_URL = "wss://minybordergs.weskb5gams.net/websocket";
const WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
};
const PING_INTERVAL = 15000;

// Khởi tạo các messages
const initialMessages = [
    [1, "MiniGame", "", "", { "agentId": "1", "accessToken": "13-33eead2e251098e563809b0fa01ca231", "reconnect": false }],
    [6, "MiniGame", "taixiuKCBPlugin", { "cmd": 2000 }]
];

let ws = null;
let pingInterval = null;

const getNetworkInfo = () => {
    const interfaces = os.networkInterfaces();
    let localIp = 'localhost';
    let networkIp = '';

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                networkIp = iface.address;
            }
        }
    }

    return { local: localIp, network: networkIp };
};

function connectWebSocket() {
    console.log(`\n=========================================`);
    console.log(`🔌 Connecting to B52 WebSocket (Bom Tấn)...`);
    console.log(`=========================================\n`);

    ws = new WebSocket(WEBSOCKET_URL, { headers: WS_HEADERS });

    ws.on('open', () => {
        console.log('[✅] WebSocket connected to B52 TX Bom Tấn (MiniGame)');
        initialMessages.forEach((msg, i) => {
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(msg));
                    console.log(`[📤] Sent init message ${i + 1}: ${JSON.stringify(msg)}`);
                }
            }, i * 300);
        });

        clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send('2');
            }
        }, PING_INTERVAL);
    });

    ws.on('message', (message) => {
        try {
            const raw = message.toString();
            // console.log('[📥 RAW]', raw);
            require('fs').appendFileSync('raw_bomtan.log', raw + '\n');

            if (raw === '3') return; // Ping/pong của Engine.IO hoặc raw mini game
            const data = JSON.parse(raw);

            if (!Array.isArray(data) || typeof data[1] !== 'object') {
                return;
            }

            const payload = data[1];
            const cmd = payload.cmd || payload.c;
            const sid = payload.sid || payload.phien || payload.id;

            // Tìm mảng htr chứa kết quả xúc xắc (đặc trưng của TX Bom tấn B52)
            let md5 = payload.md5;
            let rs = payload.rs;
            let d1 = payload.d1;
            let d2 = payload.d2;
            let d3 = payload.d3;

            // Với dữ liệu htr (history array), nó thường chứa danh sách 50 phiên liên tục.
            // Để tránh tình trạng script lúc mới bật bắt hàng loạt toàn bộ kết quả trong quá khứ, 
            // chúng ta chỉ trích xuất duy nhất d1, d2, d3 từ htr NẾU id phiên đó (sid) KHỚP VỚI PHIÊN HIỆN TẠI (currentSessionId) 
            // HOẶC nếu nó là điểm chốt của phiên đó.
            if (payload.htr && payload.htr.length > 0) {
                // Ta chỉ lấy đúng phần tử cuối dùng vì nó chính là kết quả mới nhất
                const lastResult = payload.htr[payload.htr.length - 1];

                // Nếu sid của khối tổng không có, ta dùng sid của khối kết quả htr gán ngược ra
                if (!sid) sid = lastResult.sid;

                d1 = lastResult.d1;
                d2 = lastResult.d2;
                d3 = lastResult.d3;
            }
            // Cập nhật phiên mới hoặc lấy chuỗi mã hóa md5 đầu phiên
            if (cmd === 2005 && sid) { // CMD=2005 là phiên mới (chứa md5)
                currentSessionId = sid;
                if (md5) currentMd5 = md5;
                console.log(`[🎮] Phiên mới (TX Bom Tấn): ${sid} | MD5: ${currentMd5 || 'Chưa có'}`);
            }

            if ((cmd === 2000 || cmd === 2006 || cmd === 1003) && d1 && d2 && d3) {
                // Ta chỉ in ra và lưu lịch sử NẾU MD5 hoặc d1, d2, d3 thay đổi so với lần lưu trước
                // Đây là cách tối ưu nhất để tránh việc server broadcast lại nhiều lần
                const isDuplicate = patternHistory.length > 0 &&
                    patternHistory[patternHistory.length - 1].session === (sid ? sid.toString() : currentSessionId?.toString());

                // Cờ kiểm tra tránh history lấy từ luồng khởi tạo (trên log bác gửi htr đầu có 50 cái, lấy dính cái đang chạy)
                if (isDuplicate) {
                    return;
                }

                // Không cho lấy phiên cũ bằng cách so sánh số session
                if (currentSessionId && sid && Number(sid) < (Number(currentSessionId) - 1)) {
                    // -1 ở đây là để cho phép độ trễ mạng tối đa 1 phiên. Nếu chênh lệch > 1 thì bỏ.
                    return;
                }

                const resultSession = sid ? sid.toString() : (currentSessionId ? currentSessionId.toString() : "Chưa rõ");
                const total = d1 + d2 + d3;
                const result = (total > 10) ? "Tài" : "Xỉu";
                const hashKhop = rs || "";

                const curTime = new Date();
                const timeString = curTime.toLocaleTimeString('vi-VN', { hour12: false }) + " - " + curTime.toLocaleDateString('vi-VN');

                apiResponseData = {
                    "phien": resultSession,
                    "tong_diem": total,
                    "ket_qua": result.toUpperCase(),
                    "md5": currentMd5,
                    "chuoi_ket_qua": hashKhop,
                    "thoi_gian_cap_nhat": timeString,
                    "id": "@tranhoang2286",
                    "update_count": (apiResponseData.update_count || 0) + 1
                };

                console.log(`[🎲] Phiên ${apiResponseData.phien} Bom Tấn: Tổng điểm: ${total} (${apiResponseData.ket_qua}) => Xúc xắc: [${d1}-${d2}-${d3}]`);

                patternHistory.push({
                    session: apiResponseData.phien,
                    dice: [d1, d2, d3],
                    total: total,
                    result: result,
                    md5_hash: currentMd5,
                    rs_string: hashKhop,
                    timestamp: new Date().toISOString()
                });

                if (patternHistory.length > 100) {
                    patternHistory.shift();
                }

                // KHÔNG reset currentSessionId ở đây nữa
                // vì nó đóng vai trò chặn kết quả cũ ở lượt broadcast sau của server.
                // currentSessionId = null; 
                currentMd5 = "";
            }
        } catch (e) {
            // Lỗi parse json
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`[🔌] WebSocket closed. Code: ${code}, Reason: ${reason}`);
        clearInterval(pingInterval);
        setTimeout(connectWebSocket, 5000); // Tự động reconnect sau 5s
    });

    ws.on('error', (err) => {
        console.error(`[❌] WebSocket error:`, err.message);
    });
}

// APIs
app.get('/api/b52txbomtan', (req, res) => {
    res.json(apiResponseData);
});

app.get('/api/history', (req, res) => {
    res.json({
        current: apiResponseData,
        history: [...patternHistory].reverse()
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        ws_connected: ws && ws.readyState === WebSocket.OPEN,
        uptime: process.uptime(),
        last_update: apiResponseData.thoi_gian_cap_nhat
    });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    const netInfo = getNetworkInfo();
    console.log(`\n=========================================`);
    console.log(`🚀 B52 TX Bom Tấn Data Stream Server`);
    console.log(`=========================================`);
    console.log(`📡 Server running on:`);
    console.log(`   Local: http://${netInfo.local}:${PORT}`);
    if (netInfo.network) {
        console.log(`   Network: http://${netInfo.network}:${PORT}`);
    }
    console.log(`   Public: Use VPS IP:${PORT} to access remotely`);
    console.log(`=========================================`);
    connectWebSocket();
});
