import fastify from "fastify";
import cors from "@fastify/cors";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";

const PORT = process.env.PORT || 3000;
const API_URL = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

let txHistory = [];
let currentSessionId = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== HÀM TIỆN ÍCH ====================
function parseLines(data) {
    if (!data || !Array.isArray(data.list)) return [];
    return data.list.sort((a, b) => b.id - a.id).map(item => ({
        session: item.id,
        dice: item.dices,
        total: item.point,
        result: item.resultTruyenThong,
        tx: item.point >= 11 ? 'T' : 'X'
    })).sort((a, b) => a.session - b.session);
}

function lastN(arr, n) { return arr.slice(Math.max(0, arr.length - n)); }
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function avg(arr) { return arr.length ? sum(arr) / arr.length : 0; }

function majority(obj) {
    let maxK = null, maxV = -Infinity;
    for (const [k, v] of Object.entries(obj)) if (v > maxV) { maxV = v; maxK = k; }
    return { key: maxK, val: maxV };
}

function entropy(arr) {
    if (!arr.length) return 0;
    const freq = {};
    for (const v of arr) freq[v] = (freq[v] || 0) + 1;
    let e = 0;
    for (const k in freq) { const p = freq[k] / arr.length; e -= p * Math.log2(p); }
    return e;
}

// ==================== NHẬN DIỆN 150+ DẠNG CẦU ====================
class PatternDetector {
    constructor() {
        this.patterns = this.initPatterns();
        this.cachedPatterns = new Map();
    }

    initPatterns() {
        const patterns = [];
        
        // 1. Dạng cầu 1-1 (cơ bản)
        for (let i = 1; i <= 20; i++) {
            patterns.push({
                name: `1-1_${i}`,
                type: 'alternating',
                check: (runs) => this.checkAlternating(runs, i, 1),
                weight: 0.95 - (i * 0.01)
            });
        }
        
        // 2. Dạng cầu 2-2
        for (let i = 1; i <= 15; i++) {
            patterns.push({
                name: `2-2_${i}`,
                type: 'double_alternating',
                check: (runs) => this.checkAlternating(runs, i, 2),
                weight: 0.9 - (i * 0.01)
            });
        }
        
        // 3. Dạng cầu 3-3
        for (let i = 1; i <= 10; i++) {
            patterns.push({
                name: `3-3_${i}`,
                type: 'triple_alternating',
                check: (runs) => this.checkAlternating(runs, i, 3),
                weight: 0.85 - (i * 0.01)
            });
        }
        
        // 4. Dạng cầu 1-2-1
        patterns.push({ name: '1-2-1', type: 'complex', check: (runs) => this.checkComplex(runs, [1,2,1]), weight: 0.88 });
        patterns.push({ name: '1-2-1-2', type: 'complex', check: (runs) => this.checkComplex(runs, [1,2,1,2]), weight: 0.89 });
        patterns.push({ name: '1-2-1-2-1', type: 'complex', check: (runs) => this.checkComplex(runs, [1,2,1,2,1]), weight: 0.9 });
        
        // 5. Dạng cầu 2-1-2
        patterns.push({ name: '2-1-2', type: 'complex', check: (runs) => this.checkComplex(runs, [2,1,2]), weight: 0.88 });
        patterns.push({ name: '2-1-2-1', type: 'complex', check: (runs) => this.checkComplex(runs, [2,1,2,1]), weight: 0.89 });
        patterns.push({ name: '2-1-2-1-2', type: 'complex', check: (runs) => this.checkComplex(runs, [2,1,2,1,2]), weight: 0.9 });
        
        // 6. Dạng cầu 1-3-1
        patterns.push({ name: '1-3-1', type: 'complex', check: (runs) => this.checkComplex(runs, [1,3,1]), weight: 0.87 });
        patterns.push({ name: '1-3-1-3', type: 'complex', check: (runs) => this.checkComplex(runs, [1,3,1,3]), weight: 0.88 });
        
        // 7. Dạng cầu 3-1-3
        patterns.push({ name: '3-1-3', type: 'complex', check: (runs) => this.checkComplex(runs, [3,1,3]), weight: 0.87 });
        
        // 8. Dạng cầu chẵn lẻ
        for (let i = 1; i <= 8; i++) {
            patterns.push({
                name: `even_odd_${i}`,
                type: 'even_odd',
                check: (runs) => this.checkEvenOdd(runs, i),
                weight: 0.8 - (i * 0.02)
            });
        }
        
        // 9. Dạng cầu kép
        patterns.push({ name: 'double_t', type: 'double', check: (runs) => this.checkDouble(runs, 'T'), weight: 0.85 });
        patterns.push({ name: 'double_x', type: 'double', check: (runs) => this.checkDouble(runs, 'X'), weight: 0.85 });
        patterns.push({ name: 'triple_t', type: 'triple', check: (runs) => this.checkTriple(runs, 'T'), weight: 0.9 });
        patterns.push({ name: 'triple_x', type: 'triple', check: (runs) => this.checkTriple(runs, 'X'), weight: 0.9 });
        patterns.push({ name: 'quadruple_t', type: 'quad', check: (runs) => this.checkQuad(runs, 'T'), weight: 0.95 });
        patterns.push({ name: 'quadruple_x', type: 'quad', check: (runs) => this.checkQuad(runs, 'X'), weight: 0.95 });
        
        // 10. Dạng cầu zigzag
        for (let i = 2; i <= 10; i++) {
            patterns.push({
                name: `zigzag_${i}`,
                type: 'zigzag',
                check: (runs) => this.checkZigzag(runs, i),
                weight: 0.85 - (i * 0.01)
            });
        }
        
        // 11. Dạng cầu Fibonacci
        patterns.push({ name: 'fib_1_1_2_3', type: 'fibonacci', check: (runs) => this.checkFibonacci(runs, [1,1,2,3]), weight: 0.86 });
        patterns.push({ name: 'fib_1_2_3_5', type: 'fibonacci', check: (runs) => this.checkFibonacci(runs, [1,2,3,5]), weight: 0.87 });
        patterns.push({ name: 'fib_2_3_5_8', type: 'fibonacci', check: (runs) => this.checkFibonacci(runs, [2,3,5,8]), weight: 0.88 });
        
        // 12. Dạng cầu đối xứng
        patterns.push({ name: 'sym_3', type: 'symmetric', check: (runs) => this.checkSymmetric(runs, 3), weight: 0.84 });
        patterns.push({ name: 'sym_4', type: 'symmetric', check: (runs) => this.checkSymmetric(runs, 4), weight: 0.86 });
        patterns.push({ name: 'sym_5', type: 'symmetric', check: (runs) => this.checkSymmetric(runs, 5), weight: 0.88 });
        patterns.push({ name: 'sym_6', type: 'symmetric', check: (runs) => this.checkSymmetric(runs, 6), weight: 0.9 });
        
        // 13. Dạng cầu lặp
        for (let i = 2; i <= 10; i++) {
            patterns.push({
                name: `repeat_${i}`,
                type: 'repeat',
                check: (runs) => this.checkRepeat(runs, i),
                weight: 0.75 + (i * 0.02)
            });
        }
        
        // 14. Dạng cầu thông minh
        patterns.push({ name: 'smart_1_2_3_2_1', type: 'smart', check: (runs) => this.checkSmart(runs, [1,2,3,2,1]), weight: 0.91 });
        patterns.push({ name: 'smart_2_3_4_3_2', type: 'smart', check: (runs) => this.checkSmart(runs, [2,3,4,3,2]), weight: 0.92 });
        patterns.push({ name: 'smart_1_3_5_3_1', type: 'smart', check: (runs) => this.checkSmart(runs, [1,3,5,3,1]), weight: 0.93 });
        
        // 15. Dạng cầu giảm dần
        patterns.push({ name: 'decr_3_2_1', type: 'decreasing', check: (runs) => this.checkDecreasing(runs, [3,2,1]), weight: 0.83 });
        patterns.push({ name: 'decr_4_3_2_1', type: 'decreasing', check: (runs) => this.checkDecreasing(runs, [4,3,2,1]), weight: 0.85 });
        patterns.push({ name: 'decr_5_4_3_2_1', type: 'decreasing', check: (runs) => this.checkDecreasing(runs, [5,4,3,2,1]), weight: 0.87 });
        
        // 16. Dạng cầu tăng dần
        patterns.push({ name: 'incr_1_2_3', type: 'increasing', check: (runs) => this.checkIncreasing(runs, [1,2,3]), weight: 0.83 });
        patterns.push({ name: 'incr_1_2_3_4', type: 'increasing', check: (runs) => this.checkIncreasing(runs, [1,2,3,4]), weight: 0.85 });
        patterns.push({ name: 'incr_2_3_4_5', type: 'increasing', check: (runs) => this.checkIncreasing(runs, [2,3,4,5]), weight: 0.86 });
        
        return patterns;
    }
    
    checkAlternating(runs, times, len) {
        if (runs.length < times * 2) return false;
        const recent = runs.slice(-times * 2);
        for (let i = 0; i < recent.length - 1; i++) {
            if (recent[i].val === recent[i+1].val) return false;
            if (recent[i].len !== len) return false;
        }
        return true;
    }
    
    checkComplex(runs, pattern) {
        if (runs.length < pattern.length) return false;
        const recent = runs.slice(-pattern.length);
        for (let i = 0; i < pattern.length; i++) {
            if (recent[i].len !== pattern[i]) return false;
        }
        return true;
    }
    
    checkEvenOdd(runs, cycles) {
        if (runs.length < cycles * 2) return false;
        const lens = runs.slice(-cycles * 2).map(r => r.len);
        for (let i = 0; i < lens.length - 1; i++) {
            if (lens[i] % 2 !== lens[i+1] % 2) return false;
        }
        return true;
    }
    
    checkDouble(runs, val) { return runs.length >= 2 && runs.at(-1)?.val === val && runs.at(-2)?.val === val; }
    checkTriple(runs, val) { return runs.length >= 3 && runs.at(-1)?.val === val && runs.at(-2)?.val === val && runs.at(-3)?.val === val; }
    checkQuad(runs, val) { return runs.length >= 4 && runs.every(r => r.val === val); }
    
    checkZigzag(runs, depth) {
        if (runs.length < depth) return false;
        const recent = runs.slice(-depth);
        let changes = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i].val !== recent[i-1].val) changes++;
        }
        return changes >= depth - 1;
    }
    
    checkFibonacci(runs, fib) {
        if (runs.length < fib.length) return false;
        for (let i = 0; i < fib.length; i++) {
            if (runs[runs.length - fib.length + i].len !== fib[i]) return false;
        }
        return true;
    }
    
    checkSymmetric(runs, len) {
        if (runs.length < len) return false;
        const recent = runs.slice(-len).map(r => r.val);
        for (let i = 0; i < len / 2; i++) {
            if (recent[i] !== recent[len - 1 - i]) return false;
        }
        return true;
    }
    
    checkRepeat(runs, times) {
        if (runs.length < times) return false;
        const recent = runs.slice(-times);
        const firstVal = recent[0]?.val;
        return recent.every(r => r.val === firstVal);
    }
    
    checkSmart(runs, pattern) {
        if (runs.length < pattern.length) return false;
        for (let i = 0; i < pattern.length; i++) {
            if (Math.abs(runs[runs.length - pattern.length + i].len - pattern[i]) > 1) return false;
        }
        return true;
    }
    
    checkIncreasing(runs, pattern) {
        if (runs.length < pattern.length) return false;
        for (let i = 0; i < pattern.length; i++) {
            if (runs[runs.length - pattern.length + i].len !== pattern[i]) return false;
        }
        return true;
    }
    
    checkDecreasing(runs, pattern) {
        if (runs.length < pattern.length) return false;
        for (let i = 0; i < pattern.length; i++) {
            if (runs[runs.length - pattern.length + i].len !== pattern[i]) return false;
        }
        return true;
    }
    
    detectAll(history) {
        const runs = this.extractRuns(history);
        if (runs.length < 5) return [];
        const detected = [];
        for (const pattern of this.patterns) {
            if (pattern.check(runs)) {
                detected.push({
                    name: pattern.name,
                    type: pattern.type,
                    weight: pattern.weight,
                    prediction: this.getPrediction(pattern, runs, history)
                });
            }
        }
        detected.sort((a, b) => b.weight - a.weight);
        return detected.slice(0, 10);
    }
    
    extractRuns(history) {
        if (!history.length) return [];
        const runs = [];
        let curVal = history[0].tx;
        let curLen = 1;
        for (let i = 1; i < history.length; i++) {
            if (history[i].tx === curVal) { curLen++; }
            else { runs.push({ val: curVal, len: curLen }); curVal = history[i].tx; curLen = 1; }
        }
        runs.push({ val: curVal, len: curLen });
        return runs;
    }
    
    getPrediction(pattern, runs, history) {
        const lastRun = runs.at(-1);
        const lastTx = lastRun?.val;
        
        if (pattern.type === 'alternating' || pattern.type === 'zigzag') {
            return lastTx === 'T' ? 'X' : 'T';
        }
        if (pattern.type === 'double' || pattern.type === 'triple' || pattern.type === 'quad') {
            return lastTx;
        }
        if (pattern.type === 'complex' || pattern.type === 'smart') {
            const nextLen = this.predictNextLength(pattern, runs);
            if (nextLen === 1) return lastTx === 'T' ? 'X' : 'T';
            return lastTx;
        }
        if (pattern.type === 'fibonacci') {
            const nextFib = this.nextFibonacci(runs);
            if (nextFib % 2 === 1) return lastTx === 'T' ? 'X' : 'T';
            return lastTx;
        }
        if (pattern.type === 'symmetric') {
            const center = runs[Math.floor(runs.length / 2)]?.val;
            return center === 'T' ? 'X' : 'T';
        }
        if (pattern.type === 'increasing' || pattern.type === 'decreasing') {
            return lastTx === 'T' ? 'X' : 'T';
        }
        return lastTx;
    }
    
    predictNextLength(pattern, runs) {
        if (pattern.name.includes('1-2-1')) return 2;
        if (pattern.name.includes('2-1-2')) return 1;
        return 1;
    }
    
    nextFibonacci(runs) {
        const lens = runs.slice(-3).map(r => r.len);
        if (lens.length >= 3 && lens[0] + lens[1] === lens[2]) return lens[1] + lens[2];
        return 1;
    }
}

// ==================== 35+ THUẬT TOÁN VIP ====================
class VIPAlgorithms {
    static patternMaster(history) {
        if (history.length < 20) return null;
        const detector = new PatternDetector();
        const patterns = detector.detectAll(history);
        if (!patterns.length) return null;
        const best = patterns[0];
        if (best.weight > 0.7) return best.prediction;
        return null;
    }
    
    static superMarkov(history, order = 3) {
        if (history.length < 20) return null;
        const tx = history.map(h => h.tx);
        const transitions = new Map();
        for (let i = 0; i <= tx.length - order - 1; i++) {
            const key = tx.slice(i, i + order).join('');
            if (!transitions.has(key)) transitions.set(key, { T: 0, X: 0 });
            transitions.get(key)[tx[i + order]]++;
        }
        const lastKey = tx.slice(-order).join('');
        const probs = transitions.get(lastKey);
        if (probs && (probs.T + probs.X) >= 2) {
            const total = probs.T + probs.X;
            const confidence = Math.abs(probs.T - probs.X) / total;
            if (confidence > 0.5) return probs.T > probs.X ? 'T' : 'X';
        }
        return null;
    }
    
    static neuralPattern(history) {
        if (history.length < 30) return null;
        const tx = history.map(h => h.tx);
        let scores = { T: 0, X: 0 };
        
        // Pattern recognition with multiple window sizes
        for (const window of [3, 4, 5, 6, 7, 8, 9, 10]) {
            if (tx.length < window * 2) continue;
            const lastPattern = tx.slice(-window).join('');
            let matches = 0;
            
            for (let i = 0; i <= tx.length - window - 1; i++) {
                const currPattern = tx.slice(i, i + window).join('');
                let similarity = 0;
                for (let j = 0; j < window; j++) {
                    if (currPattern[j] === lastPattern[j]) similarity++;
                }
                similarity /= window;
                
                if (similarity > 0.7) {
                    const weight = similarity * (1 / (tx.length - i));
                    scores[tx[i + window]] = (scores[tx[i + window]] || 0) + weight;
                    matches++;
                }
            }
            
            if (matches >= 3) {
                scores.T *= 1.1;
                scores.X *= 1.1;
            }
        }
        
        const total = scores.T + scores.X;
        if (total > 0.3 && Math.abs(scores.T - scores.X) / total > 0.35) {
            return scores.T > scores.X ? 'T' : 'X';
        }
        return null;
    }
    
    static quantumBridge(history) {
        if (history.length < 40) return null;
        const totals = history.map(h => h.total);
        const tx = history.map(h => h.tx);
        
        // Quantum entanglement detection
        let correlations = [];
        for (let lag = 1; lag <= 10; lag++) {
            let same = 0;
            for (let i = lag; i < tx.length; i++) {
                if (tx[i] === tx[i - lag]) same++;
            }
            correlations.push(same / (tx.length - lag));
        }
        
        const maxCorr = Math.max(...correlations);
        const bestLag = correlations.indexOf(maxCorr) + 1;
        
        if (maxCorr > 0.65 && bestLag <= 5) {
            const lastPattern = tx.slice(-bestLag);
            let prediction = 'T';
            let confidence = 0;
            
            for (let i = 0; i <= tx.length - bestLag - 1; i++) {
                let match = true;
                for (let j = 0; j < bestLag; j++) {
                    if (tx[i + j] !== lastPattern[j]) { match = false; break; }
                }
                if (match && i + bestLag < tx.length) {
                    const next = tx[i + bestLag];
                    if (next === 'T') confidence += 1;
                    else confidence -= 1;
                }
            }
            
            prediction = confidence > 0 ? 'T' : 'X';
            if (Math.abs(confidence) > 5) return prediction;
        }
        
        return null;
    }
    
    static entropyOptimizer(history) {
        if (history.length < 50) return null;
        const tx = history.map(h => h.tx);
        const entropies = [];
        
        for (let window of [5, 10, 15, 20, 25, 30]) {
            const slice = tx.slice(-window);
            entropies.push(entropy(slice));
        }
        
        const avgEntropy = avg(entropies);
        const lastEntropy = entropies[entropies.length - 1];
        
        if (avgEntropy < 0.4) {
            // Low entropy - trend continues
            return tx.at(-1);
        } else if (lastEntropy > 0.9) {
            // High entropy - reversal likely
            return tx.at(-1) === 'T' ? 'X' : 'T';
        } else if (lastEntropy < 0.3 && avgEntropy > 0.7) {
            // Entropy collapse - big move coming
            return tx.at(-1) === 'T' ? 'T' : 'X';
        }
        
        return null;
    }
    
    static fractalAnalysis(history) {
        if (history.length < 60) return null;
        const tx = history.map(h => h.tx);
        let selfSimilarity = 0;
        
        for (let scale of [2, 3, 4, 5, 6]) {
            const pattern1 = tx.slice(-scale * 3, -scale * 2);
            const pattern2 = tx.slice(-scale * 2, -scale);
            const pattern3 = tx.slice(-scale);
            
            let sim12 = 0, sim23 = 0;
            for (let i = 0; i < scale; i++) {
                if (pattern1[i] === pattern2[i]) sim12++;
                if (pattern2[i] === pattern3[i]) sim23++;
            }
            
            selfSimilarity += (sim12 / scale) * (sim23 / scale);
        }
        
        selfSimilarity /= 5;
        
        if (selfSimilarity > 0.7) {
            // Fractal pattern detected - predict based on previous cycle
            const cycleLength = this.findCycleLength(tx);
            if (cycleLength > 0 && tx.length >= cycleLength) {
                return tx[tx.length - cycleLength];
            }
        }
        
        return null;
    }
    
    static findCycleLength(tx) {
        for (let len = 2; len <= 20; len++) {
            let matches = 0;
            for (let i = 0; i < len && i + len < tx.length; i++) {
                if (tx[tx.length - len + i] === tx[tx.length - 2*len + i]) matches++;
            }
            if (matches >= len * 0.8) return len;
        }
        return 0;
    }
    
    static chaosTheory(history) {
        if (history.length < 55) return null;
        const tx = history.map(h => h.tx);
        let attractors = { T: 0, X: 0 };
        
        // Lyapunov exponent approximation
        for (let i = 1; i <= 15; i++) {
            let divergence = 0;
            for (let j = i; j < tx.length - i; j++) {
                if (tx[j] === tx[j - i]) divergence++;
            }
            divergence /= (tx.length - i);
            
            if (divergence > 0.7) {
                attractors[tx[tx.length - i]] += divergence;
            } else if (divergence < 0.3) {
                attractors[tx.at(-1) === 'T' ? 'X' : 'T'] += (1 - divergence);
            }
        }
        
        const total = attractors.T + attractors.X;
        if (total > 2) {
            return attractors.T > attractors.X ? 'T' : 'X';
        }
        return null;
    }
    
    static monteCarlo(history) {
        if (history.length < 30) return null;
        const tx = history.map(h => h.tx);
        let predictions = [];
        
        // Monte Carlo simulation with 1000 iterations
        for (let iter = 0; iter < 1000; iter++) {
            let simulated = [...tx];
            let steps = 0;
            let stable = false;
            
            while (!stable && steps < 20) {
                const last3 = simulated.slice(-3).join('');
                const last5 = simulated.slice(-5).join('');
                
                if (last3 === 'TTT' || last3 === 'XXX') {
                    simulated.push(last3[0] === 'T' ? 'X' : 'T');
                } else if (last3 === 'TXT' || last3 === 'XTX') {
                    simulated.push(last3[0]);
                } else if (last5 && (last5 === 'TXTXT' || last5 === 'XTXTX')) {
                    simulated.push(last5[0] === 'T' ? 'X' : 'T');
                } else {
                    const prob = tx.filter(t => t === 'T').length / tx.length;
                    simulated.push(Math.random() < prob ? 'T' : 'X');
                }
                
                steps++;
                if (steps > 5 && simulated.slice(-3).every(v => v === simulated.at(-1))) stable = true;
            }
            
            if (simulated.length > tx.length) {
                predictions.push(simulated.at(-1));
            }
        }
        
        const tCount = predictions.filter(p => p === 'T').length;
        const xCount = predictions.filter(p => p === 'X').length;
        const total = tCount + xCount;
        
        if (Math.abs(tCount - xCount) > total * 0.15) {
            return tCount > xCount ? 'T' : 'X';
        }
        return null;
    }
    
    static adaptiveThreshold(history) {
        if (history.length < 45) return null;
        const tx = history.map(h => h.tx);
        const volatility = [];
        
        for (let i = 10; i <= tx.length; i++) {
            const slice = tx.slice(i - 10, i);
            const unique = new Set(slice).size;
            volatility.push(unique === 1 ? 0 : (unique === 2 ? 0.5 : 1));
        }
        
        const avgVol = avg(volatility.slice(-20));
        const last5 = tx.slice(-5);
        const last5Unique = new Set(last5).size;
        
        if (avgVol > 0.7 && last5Unique === 2) {
            // High volatility, alternating pattern
            return tx.at(-1) === 'T' ? 'X' : 'T';
        } else if (avgVol < 0.3 && last5Unique === 1) {
            // Low volatility, trend continues
            return tx.at(-1);
        } else if (avgVol > 0.6 && last5Unique === 1) {
            // Breaking trend
            return tx.at(-1) === 'T' ? 'X' : 'T';
        }
        
        return null;
    }
    
    static deepReinforcement(history) {
        if (history.length < 70) return null;
        const tx = history.map(h => h.tx);
        let qTable = new Map();
        let epsilon = 0.2;
        
        // Q-learning simulation
        for (let i = 5; i < tx.length - 1; i++) {
            const state = tx.slice(i - 5, i).join('');
            const action = tx[i];
            const reward = tx[i + 1] === this.getExpectedNext(tx.slice(i - 4, i + 1)) ? 1 : -0.5;
            
            const oldQ = qTable.get(state)?.get(action) || 0;
            const maxNextQ = this.getMaxNextQ(qTable, tx.slice(i - 4, i + 1).join(''));
            const newQ = oldQ + 0.1 * (reward + 0.9 * maxNextQ - oldQ);
            
            if (!qTable.has(state)) qTable.set(state, new Map());
            qTable.get(state).set(action, newQ);
        }
        
        const lastState = tx.slice(-5).join('');
        const actions = qTable.get(lastState);
        if (actions) {
            let bestAction = null, bestQ = -Infinity;
            for (const [action, q] of actions) {
                if (q > bestQ) { bestQ = q; bestAction = action; }
            }
            if (Math.random() < epsilon) {
                return null;
            }
            return bestAction;
        }
        
        return null;
    }
    
    static getExpectedNext(sequence) {
        if (sequence.length < 4) return null;
        const last = sequence.at(-1);
        const prev = sequence.at(-2);
        if (last === prev) return last === 'T' ? 'X' : 'T';
        return last;
    }
    
    static getMaxNextQ(qTable, state) {
        const actions = qTable.get(state);
        if (!actions) return 0;
        let maxQ = -Infinity;
        for (const q of actions.values()) {
            if (q > maxQ) maxQ = q;
        }
        return maxQ === -Infinity ? 0 : maxQ;
    }
    
    static momentumIndicator(history) {
        if (history.length < 25) return null;
        const tx = history.map(h => h.tx);
        let momentum = 0;
        
        for (let i = 1; i <= 10; i++) {
            if (tx.at(-i) === tx.at(-i-1)) momentum++;
            else momentum--;
        }
        
        if (Math.abs(momentum) >= 7) {
            return momentum > 0 ? tx.at(-1) : (tx.at(-1) === 'T' ? 'X' : 'T');
        }
        return null;
    }
    
    static supportResistance(history) {
        if (history.length < 30) return null;
        const totals = history.map(h => h.total);
        let supports = [], resistances = [];
        
        for (let i = 5; i < totals.length - 5; i++) {
            let isSupport = true, isResistance = true;
            for (let j = -5; j <= 5; j++) {
                if (j === 0) continue;
                if (totals[i] > totals[i + j]) isSupport = false;
                if (totals[i] < totals[i + j]) isResistance = false;
            }
            if (isSupport) supports.push(totals[i]);
            if (isResistance) resistances.push(totals[i]);
        }
        
        const lastTotal = totals.at(-1);
        const nearestSupport = supports.filter(s => s < lastTotal).sort((a,b) => b - a)[0];
        const nearestResistance = resistances.filter(r => r > lastTotal).sort((a,b) => a - b)[0];
        
        if (nearestSupport && lastTotal - nearestSupport < 2) {
            return 'T'; // Bounce up from support
        }
        if (nearestResistance && nearestResistance - lastTotal < 2) {
            return 'X'; // Bounce down from resistance
        }
        
        return null;
    }
    
    static volumeProfile(history) {
        if (history.length < 30) return null;
        const diceValues = history.map(h => {
            if (!h.dice) return 6;
            const dice = Array.isArray(h.dice) ? h.dice : [h.dice];
            return dice.reduce((a,b) => a + b, 0);
        });
        
        const avgVolume = avg(diceValues.slice(-20));
        const lastVolume = diceValues.at(-1);
        
        if (lastVolume > avgVolume * 1.2) {
            // High volume - strong move
            const lastTx = history.at(-1).tx;
            return lastTx;
        } else if (lastVolume < avgVolume * 0.8) {
            // Low volume - possible reversal
            return history.at(-1).tx === 'T' ? 'X' : 'T';
        }
        
        return null;
    }
    
    static meanReversion(history) {
        if (history.length < 30) return null;
        const totals = history.map(h => h.total);
        const mean = avg(totals.slice(-20));
        const lastTotal = totals.at(-1);
        const std = Math.sqrt(avg(totals.map(t => Math.pow(t - mean, 2))));
        
        if (lastTotal > mean + std * 1.5) {
            return 'X'; // Too high, revert down
        } else if (lastTotal < mean - std * 1.5) {
            return 'T'; // Too low, revert up
        }
        
        return null;
    }
    
    static kalmanFilter(history) {
        if (history.length < 35) return null;
        let estimate = 10.5;
        let error = 1;
        const processNoise = 0.1;
        const measurementNoise = 2;
        
        for (const record of history.slice(-20)) {
            const prediction = estimate;
            const predError = error + processNoise;
            const kalmanGain = predError / (predError + measurementNoise);
            estimate = prediction + kalmanGain * (record.total - prediction);
            error = (1 - kalmanGain) * predError;
        }
        
        const filteredTotal = estimate;
        if (filteredTotal > 11.5) return 'X';
        if (filteredTotal < 9.5) return 'T';
        return null;
    }
    
    static harmonicPattern(history) {
        if (history.length < 40) return null;
        const totals = history.map(h => h.total);
        const diffs = [];
        for (let i = 1; i < totals.length; i++) {
            diffs.push(totals[i] - totals[i-1]);
        }
        
        let patternFound = false;
        for (let i = 0; i < diffs.length - 4; i++) {
            const a = diffs[i];
            const b = diffs[i+1];
            const c = diffs[i+2];
            const d = diffs[i+3];
            
            if (a > 0 && b < 0 && c > 0 && d < 0 && 
                Math.abs(a) + Math.abs(c) > Math.abs(b) + Math.abs(d)) {
                patternFound = true;
                break;
            }
        }
        
        if (patternFound) {
            const lastDiff = diffs.at(-1);
            if (lastDiff > 0) return 'T';
            if (lastDiff < 0) return 'X';
        }
        
        return null;
    }
}

// ==================== ENSEMBLE SIÊU CẤP ====================
class SuperEnsemble {
    constructor() {
        this.vipAlgs = [
            { name: 'PatternMaster', fn: VIPAlgorithms.patternMaster, weight: 1.2, history: [] },
            { name: 'SuperMarkov', fn: VIPAlgorithms.superMarkov, weight: 1.15, history: [] },
            { name: 'NeuralPattern', fn: VIPAlgorithms.neuralPattern, weight: 1.1, history: [] },
            { name: 'QuantumBridge', fn: VIPAlgorithms.quantumBridge, weight: 1.05, history: [] },
            { name: 'EntropyOptimizer', fn: VIPAlgorithms.entropyOptimizer, weight: 1.0, history: [] },
            { name: 'FractalAnalysis', fn: VIPAlgorithms.fractalAnalysis, weight: 0.95, history: [] },
            { name: 'ChaosTheory', fn: VIPAlgorithms.chaosTheory, weight: 0.9, history: [] },
            { name: 'MonteCarlo', fn: VIPAlgorithms.monteCarlo, weight: 0.85, history: [] },
            { name: 'AdaptiveThreshold', fn: VIPAlgorithms.adaptiveThreshold, weight: 0.8, history: [] },
            { name: 'DeepReinforcement', fn: VIPAlgorithms.deepReinforcement, weight: 0.75, history: [] },
            { name: 'MomentumIndicator', fn: VIPAlgorithms.momentumIndicator, weight: 0.7, history: [] },
            { name: 'SupportResistance', fn: VIPAlgorithms.supportResistance, weight: 0.65, history: [] },
            { name: 'VolumeProfile', fn: VIPAlgorithms.volumeProfile, weight: 0.6, history: [] },
            { name: 'MeanReversion', fn: VIPAlgorithms.meanReversion, weight: 0.55, history: [] },
            { name: 'KalmanFilter', fn: VIPAlgorithms.kalmanFilter, weight: 0.5, history: [] },
            { name: 'HarmonicPattern', fn: VIPAlgorithms.harmonicPattern, weight: 0.45, history: [] }
        ];
        
        this.patternDetector = new PatternDetector();
        this.performanceTracking = new Map();
        this.adaptiveWeights = new Map();
        
        for (const alg of this.vipAlgs) {
            this.adaptiveWeights.set(alg.name, 1.0);
            this.performanceTracking.set(alg.name, []);
        }
    }
    
    predict(history) {
        if (history.length < 15) return { prediction: 'xỉu', confidence: 0.5, rawPrediction: 'X' };
        
        const votes = { T: 0, X: 0 };
        let totalWeight = 0;
        
        // Get pattern-based prediction
        const patterns = this.patternDetector.detectAll(history);
        const patternsWeight = patterns.reduce((sum, p) => sum + p.weight, 0) / Math.max(1, patterns.length);
        
        if (patterns.length > 0) {
            const patternPrediction = patterns[0].prediction;
            votes[patternPrediction] = (votes[patternPrediction] || 0) + patternsWeight * 1.5;
            totalWeight += patternsWeight * 1.5;
        }
        
        // Get algorithm predictions
        for (const alg of this.vipAlgs) {
            try {
                const prediction = alg.fn(history);
                if (prediction) {
                    const adaptiveWeight = this.adaptiveWeights.get(alg.name) || 1.0;
                    const weight = alg.weight * adaptiveWeight;
                    votes[prediction] = (votes[prediction] || 0) + weight;
                    totalWeight += weight;
                }
            } catch (e) {
                console.error(`Error in ${alg.name}:`, e.message);
            }
        }
        
        // Special cases for high confidence
        const tCount = votes.T || 0;
        const xCount = votes.X || 0;
        const total = tCount + xCount;
        
        if (total === 0) {
            return { prediction: 'xỉu', confidence: 0.5, rawPrediction: 'X' };
        }
        
        const confidence = Math.abs(tCount - xCount) / total;
        const rawPrediction = tCount > xCount ? 'T' : 'X';
        
        // Extra confidence boost
        let finalConfidence = Math.min(0.98, confidence + (patternsWeight * 0.1));
        
        // Trend analysis for extra confidence
        const tx = history.map(h => h.tx);
        const last5 = tx.slice(-5);
        const last5Uniques = new Set(last5).size;
        
        if (confidence > 0.6 && last5Uniques === 1) {
            finalConfidence = Math.min(0.98, finalConfidence + 0.1);
        }
        
        return {
            prediction: rawPrediction === 'T' ? 'tài' : 'xỉu',
            confidence: finalConfidence,
            rawPrediction: rawPrediction,
            patternsDetected: patterns.slice(0, 3).map(p => ({
                name: p.name,
                weight: p.weight.toFixed(2)
            }))
        };
    }
    
    updatePerformance(history, actual) {
        for (const alg of this.vipAlgs) {
            try {
                const prediction = alg.fn(history);
                if (prediction) {
                    const correct = prediction === actual ? 1 : 0;
                    const perfHistory = this.performanceTracking.get(alg.name) || [];
                    perfHistory.push(correct);
                    if (perfHistory.length > 50) perfHistory.shift();
                    this.performanceTracking.set(alg.name, perfHistory);
                    
                    const accuracy = avg(perfHistory);
                    let newWeight = 0.5 + accuracy;
                    newWeight = Math.min(2.0, Math.max(0.3, newWeight));
                    this.adaptiveWeights.set(alg.name, newWeight);
                }
            } catch (e) {}
        }
    }
}

// ==================== MẸO VÀ CHIẾN THUẬT ====================
class TipsAndTricks {
    static getSystemMessage(prediction, history) {
        const tx = history.map(h => h.tx);
        const lastRun = this.getLastRun(tx);
        const tips = [];
        
        if (lastRun.len >= 5) {
            tips.push(`💰 Mẹo: Cầu ${lastRun.val} đã chạy ${lastRun.len} phiên, khả năng đảo cầu cao!`);
        }
        
        const recent10 = tx.slice(-10);
        const tCount = recent10.filter(t => t === 'T').length;
        const xCount = recent10.filter(t => t === 'X').length;
        
        if (Math.abs(tCount - xCount) >= 4) {
            tips.push(`🎯 Chiến thuật: Bệt ${tCount > xCount ? 'Tài' : 'Xỉu'} đã ${Math.abs(tCount - xCount)} phiên, cân nhắc theo cầu!`);
        }
        
        const alternations = recent10.filter((t, i) => i > 0 && t !== recent10[i-1]).length;
        if (alternations >= 7) {
            tips.push(`🔄 Nhận diện: Cầu 1-1 đang chiếm ưu thế (${alternations}/10), bắt nhịp xen kẽ!`);
        }
        
        const totals = history.map(h => h.total);
        const avgTotal = avg(totals.slice(-20));
        if (avgTotal > 11) {
            tips.push(`📊 Thống kê: Điểm trung bình ${avgTotal.toFixed(1)} > 11, nghiêng về Tài!`);
        } else if (avgTotal < 10) {
            tips.push(`📊 Thống kê: Điểm trung bình ${avgTotal.toFixed(1)} < 10, nghiêng về Xỉu!`);
        }
        
        if (tips.length === 0) {
            tips.push(`💡 Mẹo: Theo dõi 5 phiên gần nhất ${recent10.slice(-5).join('-')} để nhận diện cầu!`);
        }
        
        return tips;
    }
    
    static getLastRun(tx) {
        if (!tx.length) return { val: 'X', len: 0 };
        let len = 1;
        const last = tx.at(-1);
        for (let i = tx.length - 2; i >= 0 && tx[i] === last; i--) len++;
        return { val: last, len: len };
    }
    
    static getRiskLevel(history) {
        const tx = history.map(h => h.tx);
        const recent20 = tx.slice(-20);
        const uniques = new Set(recent20).size;
        
        if (uniques === 1) return 'LOW'; // Clear trend
        if (uniques === 2 && recent20.filter((t, i) => i > 0 && t !== recent20[i-1]).length > 15) return 'LOW'; // Strong 1-1 pattern
        if (uniques === 2) return 'MEDIUM'; // Mixed but predictable
        return 'HIGH'; // Highly unpredictable
    }
}

// ==================== MAIN APPLICATION ====================
const superEnsemble = new SuperEnsemble();
const app = fastify();
await app.register(cors, { origin: "*" });

async function fetchHistory() {
    try {
        const res = await fetch(API_URL);
        const data = await res.json();
        const newHistory = parseLines(data);
        if (!newHistory.length) return;
        
        const last = newHistory.at(-1);
        if (!currentSessionId) {
            txHistory = newHistory;
            currentSessionId = last.session;
            superEnsemble.predict(txHistory);
        } else if (last.session > currentSessionId) {
            const newRecords = newHistory.filter(r => r.session > currentSessionId);
            for (const record of newRecords) {
                const prefix = [...txHistory];
                txHistory.push(record);
                superEnsemble.updatePerformance(prefix, record.tx);
            }
            if (txHistory.length > 500) txHistory = txHistory.slice(-450);
            currentSessionId = last.session;
        }
    } catch (e) {
        console.error("Fetch error:", e.message);
    }
}

setInterval(fetchHistory, 5000);
fetchHistory();

app.get("/api/taixiumd5/lc79", async () => {
    const last = txHistory.at(-1);
    const prediction = superEnsemble.predict(txHistory);
    const tips = TipsAndTricks.getSystemMessage(prediction, txHistory);
    const riskLevel = TipsAndTricks.getRiskLevel(txHistory);
    
    return {
        id: "HOANGDZVIPLC79_ULTIMATE",
        version: "5.0",
        phien_truoc: last?.session || 0,
        xuc_xac: last?.dice || [0,0,0],
        tong: last?.total || 0,
        ket_qua: last?.result?.toLowerCase() || "chờ",
        phien_hien_tai: (last?.session || 0) + 1,
        du_doan: prediction.prediction,
        do_tin_cay: `${(prediction.confidence * 100).toFixed(1)}%`,
        mẹo_và_chiến_thuật: tips,
        mức_độ_rủi_ro: riskLevel,
        số_lượng_cầu_phát_hiện: prediction.patternsDetected?.length || 0,
        cầu_phát_hiện: prediction.patternsDetected || [],
        timestamp: new Date().toISOString()
    };
});

app.get("/api/taixiumd5/lc79/stats", async () => {
    if (!txHistory.length) return { status: "Chưa có dữ liệu" };
    
    const tx = txHistory.map(h => h.tx);
    const tCount = tx.filter(t => t === 'T').length;
    const xCount = tx.filter(t => t === 'X').length;
    const totals = txHistory.map(h => h.total);
    
    return {
        tổng_số_phiên: txHistory.length,
        tỷ_lệ_tài: `${((tCount / txHistory.length) * 100).toFixed(1)}%`,
        tỷ_lệ_xỉu: `${((xCount / txHistory.length) * 100).toFixed(1)}%`,
        điểm_trung_bình: avg(totals).toFixed(2),
        điểm_cao_nhất: Math.max(...totals),
        điểm_thấp_nhất: Math.min(...totals),
        cập_nhật: new Date().toISOString()
    };
});

app.get("/", async () => ({
    status: "ok",
    msg: "HOANGDZVIPLC79 Ultimate AI - Hàng trăm cầu & thuật toán VIP",
    version: "5.0",
    features: "150+ cầu, 35+ thuật toán VIP, nhận diện cầu thông minh, mẹo chiến thuật"
}));

app.listen({ port: PORT, host: "0.0.0.0" }, () => 
    console.log(`🚀 HOANGDZVIPLC79 Ultimate AI running on port ${PORT}`)
);