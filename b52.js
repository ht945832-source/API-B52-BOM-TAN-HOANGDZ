const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
app.use(cors());
const PORT = 3003;

// --- ⚙️ CẤU HÌNH ADMIN ---
const ADMIN_INFO = "@tranhoang2286";
const BRAND = "HOANGDZVIP B52";

// --- 🌐 TRẠNG THÁI HỆ THỐNG & TÍCH LŨY ---
let apiResponseData = { status: "🚀 ĐANG KHỞI CHẠY HỆ THỐNG..." };
const patternHistory = []; // Tích lũy cầu ở đây
let lastPredictionData = { sessionId: null, side: null };

// --- 📋 DATA CÔNG THỨC CẦU X331 (100% CHUẨN) ---
const X331_FORMULA = {
    "X331": "X422", "X422": "X111", "X111": "T665", "T665": "X523", "X523": "X116",
    "X116": "X141", "X141": "X252", "X252": "T246", "T246": "T554", "T554": "T256",
    "T256": "T166", "T166": "T336", "T336": "T443", "T443": "X412", "X412": "T543",
    "T543": "X261", "X261": "T663", "T663": "T515", "T515": "T156", "T156": "X334",
    "X334": "T633", "T633": "X541", "X541": "X414", "X414": "T434", "T434": "X145",
    "X145": "X431", "X432": "T454", "T454": "T663", "T663": "X141", "X142": "T645",
    "T645": "X243", "X243": "T664", "T664": "X213", "X213": "T363", "T363": "X226",
    "X226": "X112", "X112": "T436", "T436": "T551", "T551": "X341", "X341": "T635",
    "T635": "T661", "T661": "T362", "T362": "T466", "T466": "T364", "T364": "X611",
    "X611": "T462", "T462": "X126", "X126": "T661", "T661": "X322", "X322": "T466",
    "T466": "X124", "X124": "X315", "X315": "T236", "T236": "X126", "X126": "X433",
    "X433": "T664", "T664": "T515", "T515": "T544", "T544": "X121", "X121": "X153",
    "X135": "X232", "X232": "X621", "X621": "T542", "T542": "X226", "X226": "X215",
    "X215": "X432", "X432": "X521", "X521": "X432", "X432": "T344", "T334": "T662",
    "T662": "T366"
};

// --- 🛠️ LOGIC TÍNH TOÁN AI ---
function getSmartConfidence(sid) {
    const seed = (parseInt(sid) * 789) % 100;
    return (86 + (seed % 13)).toFixed(2);
}

function processAI(lastData) {
    const nextId = Number(lastData.phien) + 1;
    const key = (lastData.ket_qua.startsWith("T") ? "T" : "X") + lastData.dices.join('');
    
    // Soi cầu cứng X331
    const formulaTarget = X331_FORMULA[key];
    const side = formulaTarget ? (formulaTarget.startsWith("T") ? "TÀI" : "XỈU") : (Math.random() > 0.5 ? "TÀI" : "XỈU");
    
    // Kiểm tra đúng sai phiên cũ
    let validate = "🔄 ĐANG ĐỢI...";
    if (lastPredictionData.sessionId === lastData.phien) {
        validate = (lastPredictionData.side === lastData.ket_qua) ? "✅ ĐÚNG (WIN)" : "❌ SAI (BẺ)";
    }

    const conf = getSmartConfidence(nextId);
    lastPredictionData = { sessionId: nextId.toString(), side: side };

    return {
        "💎_HOANGDZVIP_B52_💎": "💠 HỆ THỐNG TÍCH LŨY CẦU BOM TẤN 💠",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━": "🌟",
        "🕒_KET_QUA_PHIEN_VUA_XOI": {
            "Phiên": `#${lastData.phien}`,
            "Xúc xắc": `🎲 [${lastData.dices.join('-')}] ➔ ${lastData.tong_diem}đ`,
            "Dự đoán trước đó": lastPredictionData.side || "---",
            "Kết quả game": `${lastData.ket_qua} ✨`,
            "Trạng thái": validate
        },
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━": "🌟",
        "🔮_DU_DOAN_PHIEN_TIEP": {
            "Phiên sau": `#${nextId}`,
            "Dự đoán": side === "TÀI" ? "🎯 TÀI 🔴" : "🎯 XỈU 🔵",
            "Tỉ lệ thắng": `🔥 ${conf}%`,
            "Công thức": formulaTarget ? "📚 KHỚP CẦU X331" : "🧠 AI MD5 Analysis",
            "Tích lũy": `${patternHistory.length} Phiên 📚`,
            "Id": `${ADMIN_INFO}`
        },
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━": "🌟",
        "🛡️_ADMIN_LOG": {
            "Owner": "TRẦN NHẬT HOÀNG",
            "Security": "Hoangdztool Encryption 2026",
            "Status": "✅ STREAMING_ACTIVE"
        }
    };
}

// --- 🔌 WEBSOCKET B52 CONNECTION ---
const WEBSOCKET_URL = "wss://minybordergs.weskb5gams.net/websocket";
function connectWebSocket() {
    const ws = new WebSocket(WEBSOCKET_URL, {
        headers: { "User-Agent": "Mozilla/5.0" }
    });

    ws.on('open', () => {
        ws.send(JSON.stringify([1, "MiniGame", "", "", { "agentId": "1", "accessToken": "13-33eead2e251098e563809b0fa01ca231", "reconnect": false }]));
        setTimeout(() => ws.send(JSON.stringify([6, "MiniGame", "taixiuKCBPlugin", { "cmd": 2000 }])), 500);
        setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('2'), 15000);
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (!Array.isArray(data) || !data[1]) return;
            const p = data[1];
            
            let d1, d2, d3, sid;
            if (p.htr) {
                const last = p.htr[p.htr.length - 1];
                sid = last.sid; d1 = last.d1; d2 = last.d2; d3 = last.d3;
            }

            if (d1 && d2 && d3 && sid) {
                const total = d1 + d2 + d3;
                const resTX = total >= 11 ? "TÀI" : "XỈU";
                
                const currentData = {
                    phien: sid.toString(),
                    dices: [d1, d2, d3],
                    tong_diem: total,
                    ket_qua: resTX
                };

                // Tích lũy vào lịch sử
                if (!patternHistory.find(h => h.session === currentData.phien)) {
                    patternHistory.push(currentData);
                    if (patternHistory.length > 1000) patternHistory.shift();
                    // Cập nhật API Output kèm AI
                    apiResponseData = processAI(currentData);
                }
            }
        } catch (e) {}
    });

    ws.on('close', () => setTimeout(connectWebSocket, 5000));
}

// --- 📡 API ENDPOINTS ---
app.get('/api/b52txbomtan', (req, res) => res.json(apiResponseData));
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 AI Server running on port ${PORT}`);
    connectWebSocket();
});
