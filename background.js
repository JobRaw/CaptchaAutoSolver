/**
 * Background Service Worker
 * 负责协调 Content Script 与 Offscreen Document 之间的 OCR 请求通信
 */

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

/** 跟踪 offscreen document 是否已创建 */
let offscreenCreating = null;

/** 闲置超时相关的常量 */
const IDLE_ALARM_NAME = 'close-offscreen';

/** 重置闲置计时器，使用 alarms 保证即时 Service Worker 休眠也能准时唤醒并释放内存 */
function resetIdleTimer() {
  chrome.alarms.create(IDLE_ALARM_NAME, { delayInMinutes: 3 });
}

// 监听持久化闹钟
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === IDLE_ALARM_NAME) {
    try {
      await chrome.offscreen.closeDocument();
      offscreenCreating = null;
      console.log('[Background] 闲置超时，已释放 Offscreen 内存');
    } catch (e) {
      // 忽略因离屏文档不存在导致的错误
    }
  }
});

/**
 * 确保 Offscreen Document 已创建
 * Chrome 限制同一时间只能有一个 offscreen document
 */
async function ensureOffscreenDocument() {
  // 检查是否已存在
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (existingContexts.length > 0) {
    return; // 已存在
  }

  // 避免并发创建
  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['DOM_PARSER'],
    justification: '使用 Canvas 预处理验证码图片，并通过 ONNX Runtime WASM 运行 OCR 模型推理'
  });

  await offscreenCreating;
  offscreenCreating = null;

  console.log('[Background] Offscreen document 已创建');
}

// ==================== 消息路由 ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ocr') {
    handleOCRRequest(message, sender)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 异步响应
  }

  if (message.type === 'slider') {
    handleSliderRequest(message, sender)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 异步响应
  }

  if (message.type === 'rotation') {
    handleRotationRequest(message, sender)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 异步响应
  }

  if (message.type === 'fetch-image') {
    handleFetchImageRequest(message.url)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

/**
 * 处理来自 Content Script 的 OCR 请求
 * 转发给 Offscreen Document 执行推理
 */
async function handleOCRRequest(message, sender) {
  try {
    await ensureOffscreenDocument();

    // 转发请求到 offscreen document
    const response = await chrome.runtime.sendMessage({
      type: 'ocr-request',
      image: message.image,
      rangeType: message.rangeType || 6
    });

    // 每次处理完请求后，重置闲置计时器
    resetIdleTimer();

    return response;
  } catch (err) {
    console.error('[Background] OCR 请求处理失败:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 处理来自 Content Script 的滑动验证码缺口检测请求
 * 转发给 Offscreen Document 执行图像分析
 */
async function handleSliderRequest(message, sender) {
  try {
    await ensureOffscreenDocument();

    // 转发请求到 offscreen document
    const response = await chrome.runtime.sendMessage({
      type: 'slider-detect',
      bgImage: message.bgImage,
      pieceImage: message.pieceImage || null,
      initialLeft: message.initialLeft || 0
    });

    // 每次处理完请求后，重置闲置计时器
    resetIdleTimer();

    return response;
  } catch (err) {
    console.error('[Background] 滑动验证码请求处理失败:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 处理来自 Content Script 的旋转验证码角度检测请求
 * 转发给 Offscreen Document 执行图像分析
 */
async function handleRotationRequest(message, sender) {
  try {
    await ensureOffscreenDocument();

    // 转发请求到 offscreen document
    const response = await chrome.runtime.sendMessage({
      type: 'rotation-detect',
      outerImage: message.outerImage,
      innerImage: message.innerImage,
      cx: message.cx || 0,
      cy: message.cy || 0,
      radius: message.radius || 0,
      innerRadius: message.innerRadius || 0
    });

    // 每次处理完请求后，重置闲置计时器
    resetIdleTimer();

    return response;
  } catch (err) {
    console.error('[Background] 旋转验证码请求处理失败:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 绕过 CORS 限制，拉取跨域图片并转为 Base64
 */
async function handleFetchImageRequest(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({ success: true, base64: reader.result });
      reader.onerror = () => reject(new Error('图片转换 Base64 失败'));
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

console.log('[Background] Service Worker 已启动');
