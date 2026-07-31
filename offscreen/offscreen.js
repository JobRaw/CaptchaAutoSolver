/**
 * Offscreen Document - OCR 推理引擎 (ES Module)
 * 使用 onnxruntime-web (WASM) 在浏览器端运行 ddddocr ONNX 模型
 */
import * as ort from '../lib/onnxruntime/ort.wasm.bundle.min.mjs';

// ==================== 常量 ====================

const MODEL_PATH = 'models/common_q8.onnx';
const CHARSET_PATH = 'models/charset.json';

/** 模型要求的目标高度 */
const TARGET_HEIGHT = 64;

// ==================== 运行时状态 ====================

let ortSession = null;
let charset = null;
let isInitializing = false;

// ==================== 初始化 ====================

/** 初始化 ONNX Runtime 环境和模型 */
async function initOCR() {
  if (ortSession) return;
  if (isInitializing) {
    // 等待正在进行的初始化完成
    while (isInitializing) {
      await new Promise(r => setTimeout(r, 100));
    }
    return;
  }

  isInitializing = true;
  console.log('[OCR Offscreen] 正在初始化 ONNX Runtime...');

  try {
    // 配置 WASM 路径，指向扩展本地文件
    ort.env.wasm.wasmPaths = chrome.runtime.getURL('lib/onnxruntime/');
    // 单线程模式，避免 SharedArrayBuffer 跨域隔离问题
    ort.env.wasm.numThreads = 1;
    // 将日志级别设为 error，屏蔽 C++ 底层无用的 Shape 不匹配警告
    ort.env.logLevel = 'error';

    // 并行加载模型和字符集
    const [session, charsetData] = await Promise.all([
      ort.InferenceSession.create(chrome.runtime.getURL(MODEL_PATH), {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
        logSeverityLevel: 4 // 0:verbose, 1:info, 2:warning, 3:error, 4:fatal，彻底屏蔽底层警告
      }),
      fetch(chrome.runtime.getURL(CHARSET_PATH)).then(r => r.json())
    ]);

    ortSession = session;
    charset = charsetData;

    console.log(`[OCR Offscreen] ✅ 模型加载完成，字符集大小: ${charset.length}`);
  } catch (err) {
    console.error('[OCR Offscreen] ❌ 模型加载失败:', err);
    throw err;
  } finally {
    isInitializing = false;
  }
}

// ==================== 图像预处理 ====================

/**
 * 将 Base64 图片预处理为模型输入张量
 * 步骤: 加载图片 → 等比缩放到高度64 → 灰度化 → 归一化 [-1, 1]
 */
async function preprocessImage(base64Str) {
  const img = await loadImage(base64Str);
  const canvas = document.getElementById('preprocess-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // 计算等比缩放尺寸（高度固定为 64）
  const newH = TARGET_HEIGHT;
  const newW = Math.max(1, Math.round(img.width * (TARGET_HEIGHT / img.height)));

  canvas.width = newW;
  canvas.height = newH;

  // 绘制缩放后的图片
  ctx.drawImage(img, 0, 0, newW, newH);
  const imageData = ctx.getImageData(0, 0, newW, newH);
  const pixels = imageData.data; // RGBA

  // 转换为灰度 + 归一化到 [-1, 1]
  const tensorData = new Float32Array(newH * newW);
  for (let i = 0; i < newH * newW; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    // 灰度化 (与 PIL 的 .convert('L') 一致)
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    // 归一化: (pixel / 255 - 0.5) / 0.5 = pixel / 127.5 - 1
    tensorData[i] = gray / 127.5 - 1.0;
  }

  // 构建 NCHW 格式张量: [1, 1, 64, W]
  return new ort.Tensor('float32', tensorData, [1, 1, newH, newW]);
}

/** 从 Base64 字符串加载图片 */
function loadImage(base64Str) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = base64Str;
  });
}

// ==================== CTC 解码 ====================

/**
 * CTC 贪婪解码
 * 模型输出形状: [T, 1, C]（T=时间步, C=字符集大小）
 * 策略: argmax → 去重 → 去空白(index=0) → 可选字符集过滤
 */
function ctcGreedyDecode(outputData, outputShape, allowedChars) {
  const T = outputShape[0];
  const C = outputShape[outputShape.length - 1];
  const result = [];
  let lastIndex = -1;

  for (let t = 0; t < T; t++) {
    // 在当前时间步找到概率最大的字符索引
    let maxIdx = 0;
    let maxVal = -Infinity;
    const offset = t * C;

    for (let c = 0; c < C; c++) {
      if (outputData[offset + c] > maxVal) {
        maxVal = outputData[offset + c];
        maxIdx = c;
      }
    }

    // CTC 去重 + 去空白
    if (maxIdx === lastIndex) continue;
    lastIndex = maxIdx;

    if (maxIdx !== 0 && maxIdx < charset.length) {
      const ch = charset[maxIdx];
      // 如果设置了字符集范围，仅保留允许的字符
      if (!allowedChars || allowedChars.has(ch)) {
        result.push(ch);
      }
    }
  }

  return result.join('');
}

// ==================== OCR 识别主流程 ====================

/**
 * 执行完整的 OCR 识别
 * @param {string} base64Image - Base64 编码的图片
 * @param {number} [rangeType=6] - 字符集范围类型
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
async function recognize(base64Image, rangeType = 6) {
  try {
    await initOCR();

    // 预处理图像
    const inputTensor = await preprocessImage(base64Image);

    // 运行推理
    const feeds = { 'input1': inputTensor };
    const results = await ortSession.run(feeds);

    // 获取输出（输出名称从模型动态获取）
    const outputName = ortSession.outputNames[0];
    const output = results[outputName];

    // 构建允许的字符集
    const allowedChars = buildAllowedChars(rangeType);

    // CTC 解码
    const text = ctcGreedyDecode(output.data, output.dims, allowedChars);

    console.log(`[OCR Offscreen] ✅ 识别结果: ${text}`);
    return { success: true, text };
  } catch (err) {
    console.error('[OCR Offscreen] ❌ 识别失败:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 根据 rangeType 构建允许的字符集合
 * 与 ddddocr 的 set_ranges 保持一致
 */
function buildAllowedChars(rangeType) {
  const DIGITS = '0123456789';
  const LOWER = 'abcdefghijklmnopqrstuvwxyz';
  const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  let chars;
  switch (rangeType) {
    case 0: chars = DIGITS; break;
    case 1: chars = LOWER; break;
    case 2: chars = UPPER; break;
    case 3: chars = LOWER + UPPER; break;
    case 4: chars = LOWER + DIGITS; break;
    case 5: chars = UPPER + DIGITS; break;
    case 6: chars = LOWER + UPPER + DIGITS; break;
    default: return null; // 不过滤，使用全字符集
  }
  return new Set(chars.split(''));
}

// ==================== 消息监听 ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ocr-request') {
    recognize(message.image, message.rangeType)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 表示异步响应
  }
});

console.log('[OCR Offscreen] 离屏文档已加载，等待 OCR 请求...');
