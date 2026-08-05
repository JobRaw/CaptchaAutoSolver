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
let initPromise = null;

// ==================== 初始化 ====================

/** 初始化 ONNX Runtime 环境和模型 */
async function initOCR() {
  if (ortSession) return;
  if (initPromise) return initPromise;

  console.log('[OCR Offscreen] 正在初始化 ONNX Runtime...');

  initPromise = (async () => {
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
      initPromise = null; // 加载失败允许重试
      throw err;
    }
  })();

  return initPromise;
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
  } finally {
    resetCanvas();
  }
}

/** 重置 Canvas 尺寸，及时释放显存与内存 */
function resetCanvas() {
  const canvas = document.getElementById('preprocess-canvas');
  if (canvas) {
    canvas.width = 1;
    canvas.height = 1;
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
    case 7: chars = LOWER + UPPER + DIGITS + '+-*=/÷?'; break; // 支持数学算术题
    default: return null; // 不过滤，使用全字符集
  }
  return new Set(chars.split(''));
}

// ==================== 滑动拼图缺口检测 ====================

/**
 * Sobel 边缘检测
 * @param {ImageData} imageData 
 * @returns {Uint8Array} 边缘梯度图
 */
function sobelEdgeDetect(imageData) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const edgeData = new Uint8Array(width * height);
  
  // 提取灰度与 Alpha 通道
  const gray = new Float32Array(width * height);
  const alpha = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    alpha[i] = a;
  }
  
  // Sobel 算子
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sumGrayX = 0, sumGrayY = 0;
      let sumAlphaX = 0, sumAlphaY = 0;
      
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx);
          const weightIdx = (ky + 1) * 3 + (kx + 1);
          const weight = gx[weightIdx]; // gx 和 gy 结构相同，只需分别乘
          
          sumGrayX += gray[idx] * gx[weightIdx];
          sumGrayY += gray[idx] * gy[weightIdx];
          
          sumAlphaX += alpha[idx] * gx[weightIdx];
          sumAlphaY += alpha[idx] * gy[weightIdx];
        }
      }
      
      const magGray = Math.sqrt(sumGrayX * sumGrayX + sumGrayY * sumGrayY);
      const magAlpha = Math.sqrt(sumAlphaX * sumAlphaX + sumAlphaY * sumAlphaY);
      
      // 取亮度梯度和透明度梯度的最大值，完美捕捉拼图轮廓与内部细节
      const magnitude = Math.max(magGray, magAlpha);
      edgeData[y * width + x] = Math.min(255, magnitude);
    }
  }
  
  return edgeData;
}

/**
 * 裁剪掉图像边缘的透明区域，紧贴实体轮廓
 * 返回裁剪后的数据及相对于原图的偏移量
 */
function cropTransparent(imageData) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  
  // 使用较小阈值确保保留完整的边缘特征（如半透明的高光描边往往也是目标轮廓的一部分）
  const threshold = 15;
  
  let minX = width, minY = height, maxX = 0, maxY = 0;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  
  if (minX > maxX || minY > maxY) {
    return { croppedData: imageData, offsetX: 0, offsetY: 0, width, height };
  }
  
  const cWidth = maxX - minX + 1;
  const cHeight = maxY - minY + 1;
  
  const croppedData = new ImageData(cWidth, cHeight);
  for (let y = 0; y < cHeight; y++) {
    for (let x = 0; x < cWidth; x++) {
      const srcIdx = ((y + minY) * width + (x + minX)) * 4;
      const dstIdx = (y * cWidth + x) * 4;
      
      const alpha = data[srcIdx + 3];
      if (alpha > threshold) {
        croppedData.data[dstIdx] = data[srcIdx];
        croppedData.data[dstIdx + 1] = data[srcIdx + 1];
        croppedData.data[dstIdx + 2] = data[srcIdx + 2];
        croppedData.data[dstIdx + 3] = data[srcIdx + 3]; // 保持原始边缘平滑度，避免锯齿干扰 ZNCC
      }
    }
  }
  
  return { croppedData, offsetX: minX, offsetY: minY, width: cWidth, height: cHeight };
}

/**
 * 边缘模板匹配 (采用工业级 ZNCC - 零均值归一化交叉相关 算法)
 * @param {HTMLImageElement} bgImg 
 * @param {HTMLImageElement} pieceImg 
 * @param {number} [initialLeft=0] 
 * @returns {{success: boolean, targetX: number, startX: number, offsetX: number, confidence: number}}
 */
function templateMatchByEdge(bgImg, pieceImg, initialLeft = 0) {
  const canvas = document.getElementById('preprocess-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  canvas.width = bgImg.width;
  canvas.height = bgImg.height;
  ctx.drawImage(bgImg, 0, 0);
  const bgEdge = sobelEdgeDetect(ctx.getImageData(0, 0, bgImg.width, bgImg.height));
  
  canvas.width = pieceImg.width;
  canvas.height = pieceImg.height;
  ctx.drawImage(pieceImg, 0, 0);
  
  const pieceImageData = ctx.getImageData(0, 0, pieceImg.width, pieceImg.height);
  const cropInfo = cropTransparent(pieceImageData);
  const pieceEdge = sobelEdgeDetect(cropInfo.croppedData);
  
  // 关键修复：真实起始坐标 = DOM 容器偏移量 + 图像内部的透明边距
  const startX = (initialLeft || 0) + cropInfo.offsetX;

  const minX = Math.floor(bgImg.width * 0.05);
  const maxX = Math.floor(bgImg.width * 0.95) - cropInfo.width;
  
  if (maxX <= minX || bgImg.height < cropInfo.height) {
    return { success: false, targetX: 0, startX: 0, offsetX: 0, confidence: 0 };
  }
  
  // 1. 预计算拼图模板的 ZNCC 核心参数 (均值与归一化差值)
  let sumP = 0;
  const numPixels = cropInfo.width * cropInfo.height;
  for (let i = 0; i < numPixels; i++) {
    sumP += pieceEdge[i];
  }
  const meanP = sumP / numPixels;
  
  let varP = 0;
  const pNorm = new Float32Array(numPixels);
  for (let i = 0; i < numPixels; i++) {
    const p = pieceEdge[i] - meanP;
    pNorm[i] = p;
    varP += p * p;
  }
  
  if (varP === 0) {
    return { success: false, targetX: 0, startX: 0, offsetX: 0, confidence: 0 };
  }

  let bestX = 0;
  let bestY = 0;
  let bestScore = -Infinity;
  const maxY = bgImg.height - cropInfo.height;
  const avoidRadius = Math.max(25, Math.floor(cropInfo.width * 0.7));

  // 2. 第一阶段：粗粒度扫描 (Y轴步长 2)
  for (let x = minX; x <= maxX; x++) {
    if (Math.abs(x - startX) < avoidRadius) continue;

    for (let y = 0; y <= maxY; y += 2) {
      let sumB = 0;
      let sumB2 = 0;
      let cov = 0;
      
      let pIdx = 0;
      for (let py = 0; py < cropInfo.height; py++) {
        let bIdx = (y + py) * bgImg.width + x;
        for (let px = 0; px < cropInfo.width; px++) {
          const b = bgEdge[bIdx++];
          sumB += b;
          sumB2 += b * b;
          cov += b * pNorm[pIdx++];
        }
      }
      
      const varB = sumB2 - (sumB * sumB) / numPixels;
      if (varB > 0) {
        const zncc = cov / Math.sqrt(varB * varP);
        if (zncc > bestScore) {
          bestScore = zncc;
          bestX = x;
          bestY = y;
        }
      }
    }
  }

  // 3. 第二阶段：1px 领域的极致精细提纯 (在 bestX/bestY 周围 ±2 像素微调)
  if (bestScore > -Infinity) {
    const fineMinX = Math.max(minX, bestX - 2);
    const fineMaxX = Math.min(maxX, bestX + 2);
    const fineMinY = Math.max(0, bestY - 2);
    const fineMaxY = Math.min(maxY, bestY + 2);

    for (let x = fineMinX; x <= fineMaxX; x++) {
      if (Math.abs(x - startX) < avoidRadius) continue;
      for (let y = fineMinY; y <= fineMaxY; y++) {
        let sumB = 0, sumB2 = 0, cov = 0, pIdx = 0;
        for (let py = 0; py < cropInfo.height; py++) {
          let bIdx = (y + py) * bgImg.width + x;
          for (let px = 0; px < cropInfo.width; px++) {
            const b = bgEdge[bIdx++];
            sumB += b;
            sumB2 += b * b;
            cov += b * pNorm[pIdx++];
          }
        }
        const varB = sumB2 - (sumB * sumB) / numPixels;
        if (varB > 0) {
          const zncc = cov / Math.sqrt(varB * varP);
          if (zncc > bestScore) {
            bestScore = zncc;
            bestX = x;
          }
        }
      }
    }
  }
  
  return {
    success: bestScore > 0.20,
    targetX: bestX,
    startX: startX,
    offsetX: bestX - startX,
    confidence: bestScore === -Infinity ? 0 : bestScore
  };
}

/**
 * 阴影区域检测 (回退策略)
 * @param {HTMLImageElement} bgImg 
 * @param {number} [startX=0]
 * @returns {{success: boolean, targetX: number, startX: number, offsetX: number, confidence: number}}
 */
function shadowRegionDetect(bgImg, startX = 0) {
  const canvas = document.getElementById('preprocess-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  canvas.width = bgImg.width;
  canvas.height = bgImg.height;
  ctx.drawImage(bgImg, 0, 0);
  const imageData = ctx.getImageData(0, 0, bgImg.width, bgImg.height);
  const data = imageData.data;
  
  // 计算每列的灰度均值
  const colMeans = new Float32Array(bgImg.width);
  for (let x = 0; x < bgImg.width; x++) {
    let sum = 0;
    for (let y = 0; y < bgImg.height; y++) {
      const idx = (y * bgImg.width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
    }
    colMeans[x] = sum / bgImg.height;
  }
  
  let bestX = 0;
  let bestScore = 0;
  
  const minW = 30;
  const maxW = 80;
  const minX = Math.max(1, Math.floor(bgImg.width * 0.1));
  const maxX = Math.floor(bgImg.width * 0.9);
  
  for (let x1 = minX; x1 < maxX - minW; x1++) {
    // 避开滑块自身位置
    if (Math.abs(x1 - startX) < 40) continue;

    for (let w = minW; w <= maxW; w++) {
      const x2 = x1 + w;
      if (x2 >= maxX) break;
      
      const drop = colMeans[x1 - 1] - colMeans[x1];
      const rise = colMeans[x2] - colMeans[x2 - 1];
      
      if (drop > 0 && rise > 0) {
        const score = drop + rise;
        if (score > bestScore) {
          bestScore = score;
          // 关键修复：目标坐标应该是缺口的左边缘 (x1)，而不是缺口的中心 (x1+x2)/2！
          bestX = x1;
        }
      }
    }
  }
  
  const normalizedConfidence = Math.min(1, bestScore / 100);
  
  return {
    success: bestScore > 5,
    targetX: bestX,
    startX: startX,
    offsetX: bestX - startX,
    confidence: normalizedConfidence
  };
}

/**
 * 检测滑动拼图缺口主入口
 * @param {string} bgBase64 - 背景图 Base64
 * @param {string} [pieceBase64] - 滑块图 Base64
 * @param {number} [initialLeft=0] - 初始 X 偏移
 * @returns {Promise<{success: boolean, targetX?: number, startX?: number, offsetX?: number, confidence?: number, error?: string}>}
 */
async function detectSliderGap(bgBase64, pieceBase64, initialLeft = 0) {
  try {
    const bgImg = await loadImage(bgBase64);
    
    if (pieceBase64) {
      const pieceImg = await loadImage(pieceBase64);
      console.log('[OCR Offscreen] 尝试执行边缘模板匹配...');
      const matchResult = templateMatchByEdge(bgImg, pieceImg, initialLeft);
      if (matchResult.success && matchResult.confidence > 0.25) {
        console.log(`[OCR Offscreen] ✅ 边缘模板匹配成功，targetX: ${matchResult.targetX}, startX: ${matchResult.startX}, 偏移: ${matchResult.offsetX}`);
        return matchResult;
      }
      console.log(`[OCR Offscreen] 边缘模板匹配置信度不足 (${matchResult.confidence})，回退到阴影检测`);
    }
    
    console.log('[OCR Offscreen] 尝试执行阴影区域检测...');
    const shadowResult = shadowRegionDetect(bgImg, initialLeft);
    if (shadowResult.success) {
      console.log(`[OCR Offscreen] ✅ 阴影检测成功，targetX: ${shadowResult.targetX}, 偏移: ${shadowResult.offsetX}`);
      return shadowResult;
    }
    
    return { success: false, error: '无法定位缺口' };
  } catch (err) {
    console.error('[OCR Offscreen] ❌ 缺口检测异常:', err);
    return { success: false, error: err.message };
  } finally {
    resetCanvas();
  }
}

// ==================== 旋转验证码带状极坐标匹配 (Color-Weighted Ring-Independent ZNCC) ====================

function extractColorPolarRows(imageData, cx, cy, radius, bandWidth, sampleCount, ignoreBlackHole) {
  const { data, width, height } = imageData;
  const numRadii = bandWidth * 2 + 1;
  const rows = [];

  for (let dr = -bandWidth; dr <= bandWidth; dr++) {
    const r = radius + dr;
    const rowR = new Float32Array(sampleCount).fill(-1);
    const rowG = new Float32Array(sampleCount).fill(-1);
    const rowB = new Float32Array(sampleCount).fill(-1);
    let validPixels = 0;
    
    for (let i = 0; i < sampleCount; i++) {
      const angle = (2 * Math.PI * i) / sampleCount;
      const px = Math.round(cx + r * Math.cos(angle));
      const py = Math.round(cy + r * Math.sin(angle));
      
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const idx = (py * width + px) * 4;
        const alpha = data[idx + 3];
        if (alpha > 10) { 
          if (ignoreBlackHole && data[idx] === 0 && data[idx + 1] === 0 && data[idx + 2] === 0) {
            // Ignore anti-bot black hole
          } else {
            rowR[i] = data[idx];
            rowG[i] = data[idx + 1];
            rowB[i] = data[idx + 2];
            validPixels++;
          }
        }
      }
    }
    
    rows.push({ rChannel: rowR, gChannel: rowG, bChannel: rowB, validCount: validPixels, dr: dr, r: r });
  }
  return rows;
}

function channelZNCC(rowO, rowI, sampleCount, shift) {
  let sumO = 0, sumI = 0, count = 0;
  for (let a = 0; a < sampleCount; a++) {
    const valO = rowO[a];
    const valI = rowI[(a + shift) % sampleCount];
    if (valO >= 0 && valI >= 0) {
      sumO += valO;
      sumI += valI;
      count++;
    }
  }
  
  if (count < sampleCount * 0.4) return -1;

  const meanO = sumO / count;
  const meanI = sumI / count;
  
  let cov = 0, varO = 0, varI = 0;
  for (let a = 0; a < sampleCount; a++) {
    const valO = rowO[a];
    const valI = rowI[(a + shift) % sampleCount];
    if (valO >= 0 && valI >= 0) {
      const o = valO - meanO;
      const i = valI - meanI;
      cov += o * i;
      varO += o * o;
      varI += i * i;
    }
  }
  
  // Requires minimum variance to prevent noise amplification
  if ((varO / count) < 10 || (varI / count) < 10) return -1;

  const denom = Math.sqrt(varO * varI);
  return denom > 0 ? cov / denom : 0;
}

function colorRingZNCC(rowO, rowI, sampleCount, shift) {
  const zR = channelZNCC(rowO.rChannel, rowI.rChannel, sampleCount, shift);
  const zG = channelZNCC(rowO.gChannel, rowI.gChannel, sampleCount, shift);
  const zB = channelZNCC(rowO.bChannel, rowI.bChannel, sampleCount, shift);
  
  if (zR === -1 || zG === -1 || zB === -1) return -1;
  return (zR + zG + zB) / 3;
}

function extractPolarBand(imageData, cx, cy, radius, bandWidth, sampleCount) {
  const { data, width, height } = imageData;
  const numRadii = bandWidth * 2 + 1;
  const polar = new Float32Array(sampleCount * numRadii);

  for (let i = 0; i < sampleCount; i++) {
    const angle = (2 * Math.PI * i) / sampleCount;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    for (let dr = -bandWidth; dr <= bandWidth; dr++) {
      const r = radius + dr;
      const px = Math.round(cx + r * cosA);
      const py = Math.round(cy + r * sinA);
      
      const pIdx = i * numRadii + (dr + bandWidth);
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const idx = (py * width + px) * 4;
        const alpha = data[idx + 3] / 255.0; // 提取 Alpha 通道
        polar[pIdx] = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) * alpha;
      } else {
        polar[pIdx] = 0;
      }
    }
  }
  return polar;
}

/**
 * 计算两个二维极坐标带之间的 2D ZNCC 相关度 - V1
 */
function polarBandZNCC(outerBand, innerBand, numAngles, numRadii, shiftAngles) {
  let sumO = 0, sumI = 0;
  const N = numAngles * numRadii;

  // 第一遍：计算均值
  for (let a = 0; a < numAngles; a++) {
    const outerRowOffset = a * numRadii;
    const innerRowOffset = (((a + shiftAngles) % numAngles + numAngles) % numAngles) * numRadii;
    for (let r = 0; r < numRadii; r++) {
      sumO += outerBand[outerRowOffset + r];
      sumI += innerBand[innerRowOffset + r];
    }
  }
  const meanO = sumO / N;
  const meanI = sumI / N;

  // 第二遍：计算方差和协方差
  let cov = 0, varO = 0, varI = 0;
  for (let a = 0; a < numAngles; a++) {
    const outerRowOffset = a * numRadii;
    const innerRowOffset = (((a + shiftAngles) % numAngles + numAngles) % numAngles) * numRadii;
    for (let r = 0; r < numRadii; r++) {
      const o = outerBand[outerRowOffset + r] - meanO;
      const ii = innerBand[innerRowOffset + r] - meanI;
      cov += o * ii;
      varO += o * o;
      varI += ii * ii;
    }
  }

  const denom = Math.sqrt(varO * varI);
  return denom > 0 ? cov / denom : 0;
}

function extractPolarRows(imageData, cx, cy, radius, bandWidth, sampleCount) {
  const { data, width, height } = imageData;
  const numRadii = bandWidth * 2 + 1;
  const rows = [];

  for (let dr = -bandWidth; dr <= bandWidth; dr++) {
    const r = radius + dr;
    const row = new Float32Array(sampleCount);
    let validPixels = 0;
    
    for (let i = 0; i < sampleCount; i++) {
      const angle = (2 * Math.PI * i) / sampleCount;
      const px = Math.round(cx + r * Math.cos(angle));
      const py = Math.round(cy + r * Math.sin(angle));
      
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const idx = (py * width + px) * 4;
        const alpha = data[idx + 3];
        if (alpha > 10) { // 非完全透明
          row[i] = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
          validPixels++;
        } else {
          row[i] = -1; // 标记为无效
        }
      } else {
        row[i] = -1;
      }
    }
    
    // 计算该行的方差（仅有效像素）
    let sum = 0, sqSum = 0;
    for (let i = 0; i < sampleCount; i++) {
      if (row[i] >= 0) {
        sum += row[i];
        sqSum += row[i] * row[i];
      }
    }
    const mean = validPixels > 0 ? sum / validPixels : 0;
    const variance = validPixels > 0 ? (sqSum / validPixels) - (mean * mean) : 0;
    
    rows.push({ data: row, validCount: validPixels, variance: variance, r: r, dr: dr });
  }
  return rows;
}

function zncc1D(rowO, rowI, sampleCount, shift) {
  let sumO = 0, sumI = 0, count = 0;
  // 必须内外都有有效像素才参与计算
  for (let a = 0; a < sampleCount; a++) {
    const valO = rowO[a];
    const valI = rowI[(a + shift) % sampleCount];
    if (valO >= 0 && valI >= 0) {
      sumO += valO;
      sumI += valI;
      count++;
    }
  }
  
  if (count < sampleCount * 0.5) return -1; // 有效重叠太少

  const meanO = sumO / count;
  const meanI = sumI / count;
  
  let cov = 0, varO = 0, varI = 0;
  for (let a = 0; a < sampleCount; a++) {
    const valO = rowO[a];
    const valI = rowI[(a + shift) % sampleCount];
    if (valO >= 0 && valI >= 0) {
      const o = valO - meanO;
      const i = valI - meanI;
      cov += o * i;
      varO += o * o;
      varI += i * i;
    }
  }
  
  const denom = Math.sqrt(varO * varI);
  return denom > 0 ? cov / denom : -1;
}


async function detectRotationAngle(outerBase64, innerBase64, cx, cy, radius, innerRadius, algoOptions = {}) {
  try {
    const canvas = document.getElementById("preprocess-canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const outerImg = await loadImage(outerBase64);
    canvas.width = outerImg.width;
    canvas.height = outerImg.height;
    ctx.drawImage(outerImg, 0, 0);
    const outerData = ctx.getImageData(0, 0, outerImg.width, outerImg.height);

    const innerImg = await loadImage(innerBase64);
    canvas.width = innerImg.width;
    canvas.height = innerImg.height;
    ctx.drawImage(innerImg, 0, 0);
    const innerData = ctx.getImageData(0, 0, innerImg.width, innerImg.height);

    const innerCx = innerImg.width / 2;
    const innerCy = innerImg.height / 2;
    if (!radius || radius <= 0) radius = Math.min(innerImg.width, innerImg.height) / 2 - 2;

    // 自动探测内圆的真实物理半径（排除图片的透明边距）
    let realInnerRadius = 0;
    for (let y = 0; y < innerImg.height; y++) {
      for (let x = 0; x < innerImg.width; x++) {
        const alpha = innerData.data[(y * innerImg.width + x) * 4 + 3];
        if (alpha > 10) {
          const dx = x - innerCx;
          const dy = y - innerCy;
          const r = Math.sqrt(dx * dx + dy * dy);
          if (r > realInnerRadius) realInnerRadius = r;
        }
      }
    }
    // 取保守探测值，若比外部传进来的 innerRadius 小，说明有透明边距，以探测值为准
    if (realInnerRadius > 10 && (!innerRadius || realInnerRadius < innerRadius)) {
      innerRadius = Math.round(realInnerRadius);
    } else if (!innerRadius) {
      innerRadius = radius;
    }

    const sampleCount = 360;
    const bandWidth = 8;
    const numRadii = bandWidth * 2 + 1;

    let v1Result = null;
    let v2Result = null;
    let v3Result = null;

    // --- V1 (2D Grayscale ZNCC) ---
    if (algoOptions.v1 !== false) {
      const v1Radius = Math.round(radius * 0.65);
      const v1InnerRadius = Math.round(innerRadius * 0.65);
      const outerBand = extractPolarBand(outerData, cx, cy, v1Radius, bandWidth, sampleCount);
      const innerBand = extractPolarBand(innerData, innerCx, innerCy, v1InnerRadius, bandWidth, sampleCount);
      
      let bestV1Angle = 0;
      let bestV1Score = -Infinity;
      
      for (let i = 0; i < 360; i++) {
        let score = polarBandZNCC(outerBand, innerBand, sampleCount, numRadii, i);
        if (score > bestV1Score) {
          bestV1Score = score;
          bestV1Angle = i;
        }
      }
      v1Result = { angle: bestV1Angle, score: bestV1Score };
    }

    // --- V2 (1D Variance Profile ZNCC) ---
    if (algoOptions.v2 !== false) {
      const v2BandWidth = 18;
      const outerRows = extractPolarRows(outerData, cx, cy, radius, v2BandWidth, sampleCount);
      const innerRows = extractPolarRows(innerData, innerCx, innerCy, innerRadius, v2BandWidth, sampleCount);
      
      // 筛选具有足够变化(方差>5)的特征圈
      const validOuterRows = outerRows.filter(r => r.variance > 5);
      
      let bestV2Angle = 0;
      let bestV2Score = -Infinity;
      
      if (validOuterRows.length > 0) {
        for (let i = 0; i < 360; i++) {
          let totalScore = 0;
          let validCount = 0;
          
          for (const rowO of validOuterRows) {
            const rowI = innerRows.find(r => r.dr === rowO.dr);
            if (rowI && rowI.variance > 0) {
              const score = zncc1D(rowO.data, rowI.data, sampleCount, i);
              if (score !== -1) {
                totalScore += score;
                validCount++;
              }
            }
          }
          if (validCount > 0) {
            const avgScore = totalScore / validCount;
            if (avgScore > bestV2Score) {
              bestV2Score = avgScore;
              bestV2Angle = i;
            }
          }
        }
      }
      v2Result = { angle: bestV2Angle, score: bestV2Score };
    }

    // --- V3 (Color ZNCC) ---
    if (algoOptions.v3 !== false) {
      const v3BandWidth = 18;
      const outerColorRows = extractColorPolarRows(outerData, cx, cy, radius, v3BandWidth, sampleCount, true);
      const innerColorRows = extractColorPolarRows(innerData, innerCx, innerCy, innerRadius, v3BandWidth, sampleCount, false);
      
      let bestV3Angle = 0;
      let bestV3Score = -Infinity;
      
      for (let i = 0; i < 360; i++) {
        let totalScore = 0;
        let validRingCount = 0;
        for (let r = 0; r < outerColorRows.length; r++) {
          const rowO = outerColorRows[r];
          const rowI = innerColorRows[r];
          if (!rowO || !rowI) continue;
          
          const score = colorRingZNCC(rowO, rowI, sampleCount, i);
          if (score !== -1) {
            const weight = Math.min(rowO.validCount, rowI.validCount);
            totalScore += score * weight;
            validRingCount += weight;
          }
        }
        if (validRingCount > 0) {
          const weightedScore = totalScore / validRingCount;
          if (weightedScore > bestV3Score) {
            bestV3Score = weightedScore;
            bestV3Angle = i;
          }
        }
      }
      v3Result = { angle: bestV3Angle, score: bestV3Score };
    }

    // === 聚合投票机制 (Clustering Voting) ===
    let candidates = [];
    
    // 角度差计算
    const angDiff = (a, b) => {
        let d = Math.abs(a - b) % 360;
        return d > 180 ? 360 - d : d;
    };

    // 理论极值映射，用于归一化打分 (让跨算法比较更公平)
    // 削弱 V1，增强 V2 和 V3 的话语权
    const maxScores = { 'V3': 0.60, 'V1': 0.25, 'V2': 0.95 };
    const normalize = (algo, score) => Math.max(0, score) / (maxScores[algo] || 1);
    
    // === V2 & V3 双重保险强共识 (Strong Consensus Bypass) ===
    // 如果 V2 和 V3 计算出的角度极度接近(<=5度)，且分数没有太离谱(>0.20)
    // 它们将无视单项及格线，直接被保送进候选池，形成绝对共识
    let v2v3Consensus = false;
    if (v2Result && v3Result && v2Result.score > 0.20 && v3Result.score > 0.20) {
        if (angDiff(v2Result.angle, v3Result.angle) <= 5) {
            v2v3Consensus = true;
        }
    }

    if (v3Result && (v3Result.score > 0.35 || v2v3Consensus)) candidates.push({ algo: 'V3', angle: v3Result.angle, score: v3Result.score, norm: normalize('V3', v3Result.score) });
    if (v2Result && (v2Result.score > 0.40 || v2v3Consensus)) candidates.push({ algo: 'V2', angle: v2Result.angle, score: v2Result.score, norm: normalize('V2', v2Result.score) });
    if (v1Result && v1Result.score > 0.18) candidates.push({ algo: 'V1', angle: v1Result.angle, score: v1Result.score, norm: normalize('V1', v1Result.score) });

    // 基于权重融合多个角度 (解决 360 度跨界问题)
    const fuseAngles = (angleObjs) => {
        let sumSin = 0, sumCos = 0;
        angleObjs.forEach(obj => {
            const rad = obj.angle * Math.PI / 180;
            // 归一化得分作为融合权重
            const weight = obj.norm || 0.1; 
            sumSin += Math.sin(rad) * weight;
            sumCos += Math.cos(rad) * weight;
        });
        let res = Math.atan2(sumSin, sumCos) * 180 / Math.PI;
        return (res + 360) % 360;
    };

    let finalAngle = 0;
    let finalConfidence = 0;
    let chosenAlgo = 'NONE';
    
    if (candidates.length === 0) {
       // 全都没达到阈值，进行归一化降维比对
       const all = [];
       if (v3Result) all.push({ algo: 'V3', angle: v3Result.angle, score: v3Result.score, norm: normalize('V3', v3Result.score) });
       if (v1Result) all.push({ algo: 'V1', angle: v1Result.angle, score: v1Result.score, norm: normalize('V1', v1Result.score) });
       if (v2Result) all.push({ algo: 'V2', angle: v2Result.angle, score: v2Result.score, norm: normalize('V2', v2Result.score) });

       if (all.length > 0) {
         // 根据归一化相对努力程度挑一个最好的
         const best = all.reduce((max, cur) => cur.norm > max.norm ? cur : max);
         finalAngle = best.angle;
         finalConfidence = best.score;
         chosenAlgo = `FALLBACK_${best.algo}`;
       }
    } else if (candidates.length === 1) {
       finalAngle = candidates[0].angle;
       finalConfidence = candidates[0].score;
       chosenAlgo = candidates[0].algo;
    } else {
       // Find clusters (diff < 15 degrees)
       let consensusFound = false;
       for (let i = 0; i < candidates.length; i++) {
           for (let j = i + 1; j < candidates.length; j++) {
               if (angDiff(candidates[i].angle, candidates[j].angle) <= 15) {
                   // 共识达成！不再只采纳优先级高的，而是进行加权融合
                   finalAngle = Math.round(fuseAngles([candidates[i], candidates[j]]));
                   // 置信度取两者中的较高者
                   finalConfidence = Math.max(candidates[i].score, candidates[j].score);
                   chosenAlgo = `CONSENSUS_${candidates[i].algo}_${candidates[j].algo}`;
                   consensusFound = true;
                   break;
               }
           }
           if (consensusFound) break;
       }
       if (!consensusFound) {
           // 互相分歧，严格按优先级取
           const sorted = candidates.sort((a,b) => {
               const p = {'V3': 3, 'V1': 2, 'V2': 1};
               return p[b.algo] - p[a.algo];
           });
           finalAngle = sorted[0].angle;
           finalConfidence = sorted[0].score;
           chosenAlgo = `${sorted[0].algo}_SOLO_OVERRIDE`;
       }
    }

    return {
      success: true,
      bestAngle: finalAngle || 0,
      confidence: (finalConfidence === -Infinity || isNaN(finalConfidence)) ? 0 : finalConfidence,
      metrics: {
        chosenAlgo: chosenAlgo
      },
      details: {
        v1: v1Result,
        v2: v2Result,
        v3: v3Result
      }
    };
  } catch (err) {
    console.error("[OCR Offscreen] detectRotationAngle error:", err);
    return { success: false, bestAngle: 0, confidence: 0, error: err.message };
  }
}

// ==================== 消息监听 ====================


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ocr-request') {
    recognize(message.image, message.rangeType)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 表示异步响应
  }
  if (message.type === 'slider-detect') {
    detectSliderGap(message.bgImage, message.pieceImage, message.initialLeft || 0)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.type === 'rotation-detect') {
    detectRotationAngle(message.outerImage, message.innerImage, message.cx || 0, message.cy || 0, message.radius || 0, message.innerRadius || 0)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

console.log('[OCR Offscreen] 离屏文档已加载，等待 OCR/缺口检测/旋转检测 请求...');
