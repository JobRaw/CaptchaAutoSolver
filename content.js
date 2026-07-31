/**
 * Captcha Solver - Content Script
 * 自动检测网页验证码图片 → 发送到本地 OCR 服务识别 → 自动填入结果
 */
(function () {
  'use strict';

  // ==================== 常量配置 ====================

  const SCAN_INTERVAL_MS = 1500;
  const MUTATION_DEBOUNCE_MS = 500;
  const SRC_CHANGE_DEBOUNCE_MS = 300;
  const CLICK_REFRESH_DEBOUNCE_MS = 500;

  /** 验证码图片的常见 CSS 选择器 */
  const IMG_SELECTORS = [
    "img[src*='captcha']", "img[src*='code']", "img[src*='verify']",
    "img[src*='getcode']", "img[src*='data:image']",
    "img[id*='captcha']", "img[id*='code']",
    "img[class*='captcha']", "img[class*='code']",
    "img.captcha", "img.code", "#captcha-img",
    ".n-image img", ".el-image img", ".ant-image img",
    "div[class*='code'] img", "div[class*='captcha'] img", "div[class*='verify'] img"
  ];

  /** 验证码输入框的常见 CSS 选择器 */
  const INPUT_SELECTORS = [
    "input[name*='code']", "input[name*='captcha']", "input[name*='verify']",
    "input[placeholder*='验证码']", "input[placeholder*='code']", "input[placeholder*='Code']",
    "input[id*='captcha']", "input[id*='code']",
    "input[class*='captcha']", "#captcha-input",
    "input.n-input__input-el", ".n-input input",
    "input.el-input__inner", ".el-input input",
    "input.ant-input", ".ant-input-affix-wrapper input"
  ];

  // ==================== 运行时状态 ====================

  let isProcessing = false;
  let isEnabled = true;
  let customImgSel = '';
  let customInputSel = '';

  // ==================== 入口 ====================

  init();

  function init() {
    console.log(
      '%c[CaptchaSolver]%c 验证码自动识别扩展已启动！',
      'color: #10b981; font-weight: bold;', 'color: auto;'
    );
    loadUserConfig();
    startObserving();
  }

  // ==================== 配置管理 ====================

  /** 从 chrome.storage 加载用户配置并监听实时变更 */
  function loadUserConfig() {
    if (!chrome.storage?.sync) return;

    chrome.storage.sync.get(['enabled', 'customImgSelector', 'customInputSelector'], (res) => {
      isEnabled = res.enabled !== false;
      customImgSel = res.customImgSelector || '';
      customInputSel = res.customInputSelector || '';
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.enabled) isEnabled = changes.enabled.newValue !== false;
      if (changes.customImgSelector) customImgSel = changes.customImgSelector.newValue || '';
      if (changes.customInputSelector) customInputSel = changes.customInputSelector.newValue || '';
    });
  }

  // ==================== DOM 扫描与监听 ====================

  /** 启动防抖的 DOM 变动监听与交互监听 */
  function startObserving() {
    let scanTimer = null;
    const triggerScan = () => {
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(scanAndSolve, MUTATION_DEBOUNCE_MS);
    };

    scanAndSolve(); // 初始扫描

    if (document.body) {
      new MutationObserver((mutations) => {
        // 过滤：有新增节点或属性 src 改变时才触发扫描
        const shouldScan = mutations.some(m => m.addedNodes.length > 0 || m.attributeName === 'src');
        if (shouldScan) triggerScan();
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }

    // 监听全局所有的图片加载事件（使用捕获阶段，因为 load 不冒泡）
    // 解决单页应用中，图片刚插入 DOM 时没有尺寸导致 isCaptchaSize 漏判的问题
    document.addEventListener('load', (e) => {
      if (e.target && e.target.tagName === 'IMG') {
        triggerScan();
      }
    }, true);

    // 按需触发：用户聚焦到任何 input 时触发轻量级扫描
    document.addEventListener('focusin', (e) => {
      if (e.target && e.target.tagName === 'INPUT') {
        triggerScan();
      }
    });
  }

  /** 扫描页面寻找验证码，找到后自动识别并填入 */
  async function scanAndSolve() {
    if (!isEnabled || isProcessing) return;

    const imgEl = findCaptchaImage();
    const inputEl = findCaptchaInput();
    if (!imgEl || !inputEl) return;

    // 已识别过且图片未变化则跳过
    if (inputEl.value && inputEl.dataset.solvedSrc === imgEl.src) return;

    // 检查图片是否真正加载完成（避免加载中/空占位图导致误识别）
    if (!isCaptchaValid(imgEl)) return;

    // 首次发现时绑定监听并高亮标记
    bindElementObservers(imgEl, inputEl);

    await solveTarget(imgEl, inputEl);
  }

  /** 为验证码图片和输入框绑定变化监听 */
  function bindElementObservers(imgEl, inputEl) {
    if (!imgEl.dataset.hasSolverObserver) {
      imgEl.dataset.hasSolverObserver = 'true';
      console.log('[CaptchaSolver] 已锁定验证码图片:', imgEl);

      new MutationObserver(() =>
        setTimeout(() => solveTarget(imgEl, inputEl), SRC_CHANGE_DEBOUNCE_MS)
      ).observe(imgEl, { attributes: true, attributeFilter: ['src'] });

      imgEl.addEventListener('click', () =>
        setTimeout(() => solveTarget(imgEl, inputEl), CLICK_REFRESH_DEBOUNCE_MS)
      );
    }

    if (!inputEl.dataset.hasSolverObserver) {
      inputEl.dataset.hasSolverObserver = 'true';
      console.log('[CaptchaSolver] 已锁定输入框:', inputEl);
    }
  }

  // ==================== 元素查找 ====================

  /** 查找验证码图片元素 */
  function findCaptchaImage() {
    // 优先使用用户自定义选择器
    const customEl = querySafe(customImgSel);
    if (customEl && isVisible(customEl)) return customEl;

    // 内置选择器匹配
    for (const sel of IMG_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el) && isCaptchaSize(el)) return el;
    }

    // 兜底：遍历所有 img，按尺寸和上下文关键词判断
    for (const img of document.querySelectorAll('img')) {
      const src = (img.src || '').toLowerCase();
      const className = (img.className || '').toString().toLowerCase();
      const parentClass = (img.parentElement?.className || '').toString().toLowerCase();
      
      const isMatch = src.includes('captcha') || src.includes('code') || src.includes('verify') ||
                      className.includes('captcha') || className.includes('code') || className.includes('verify') ||
                      parentClass.includes('code') || parentClass.includes('captcha');
      
      if (!isMatch) continue; // 第一道屏障：极低成本过滤 99% 的无关图片
      
      // 匹配后再执行昂贵的 DOM 布局计算 (isVisible 等)，避免页面卡顿
      if (!isCaptchaValid(img) || !isCaptchaSize(img) || !isVisible(img)) continue;
      
      return img;
    }
    return null;
  }

  /** 查找验证码输入框元素 */
  function findCaptchaInput() {
    // 优先使用用户自定义选择器
    const customEl = querySafe(customInputSel);
    if (customEl && isVisible(customEl)) return customEl;

    // 内置选择器匹配
    for (const sel of INPUT_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }

    // 兜底：按 placeholder / name 关键词匹配
    for (const input of document.querySelectorAll("input[type='text'], input:not([type])")) {
      const ph = (input.placeholder || '').toLowerCase();
      const name = (input.name || '').toLowerCase();
      
      const isMatch = ph.includes('验证码') || ph.includes('code') || name.includes('code');
      if (!isMatch) continue; // 极低成本过滤
      
      if (!isVisible(input)) continue; // 昂贵的布局计算放最后
      return input;
    }
    return null;
  }

  // ==================== OCR 识别 ====================

  /** 提取图片并通过浏览器内置 OCR 引擎进行识别 */
  async function solveTarget(imgEl, inputEl) {
    if (isProcessing) return;
    isProcessing = true;
    showNotice(inputEl, '🤖 正在识别验证码...');

    try {
      const base64 = await getImageBase64(imgEl);
      if (!base64) throw new Error('图片跨域限制，无法读取验证码');

      console.log('[CaptchaSolver] 图片已提取，正在发送到内置 OCR 引擎...');

      // 发送至 Service Worker -> Offscreen 进行推理
      const data = await chrome.runtime.sendMessage({
        type: 'ocr',
        image: base64,
        rangeType: 7
      });

      if (data && data.success && data.text) {
        // ========== 新增数学公式解析层 ==========
        const finalValue = parseMathCaptcha(data.text);
        
        console.log(
          `[CaptchaSolver] ✅ 识别成功: 原始结果 [%c${data.text}%c] -> 填入 [%c${finalValue}%c]`,
          'color:#2563eb; font-weight:bold;', '', 'color:#16a34a; font-weight:bold;', ''
        );
        fillInput(inputEl, finalValue, imgEl);
        inputEl.dataset.solvedSrc = imgEl.src;
        showNotice(inputEl, `✅ 已自动填入: ${finalValue}`, 2500);
      } else {
        throw new Error((data && data.error) || '识别返回空');
      }
    } catch (err) {
      console.error('[CaptchaSolver]', err);
      showNotice(inputEl, `⚠️ ${err.message}`, 3000);
    } finally {
      isProcessing = false;
    }
  }

  // ==================== 工具函数 ====================

  /**
   * 尝试解析并计算数学公式验证码
   * 如果是数学题（如 3+4=?），返回计算结果；如果是普通字符串，原样返回
   */
  function parseMathCaptcha(text) {
    // 清理可能导致误判的空格
    const cleanText = text.replace(/\s+/g, '');
    
    // 匹配：数字 (操作符) 数字 (可选的等号/问号/乱码)
    const mathRegex = /^(\d+)([\+\-\*xX/÷])(\d+).*$/;
    const match = cleanText.match(mathRegex);
    
    if (match) {
      const num1 = parseInt(match[1], 10);
      const operator = match[2].toLowerCase();
      const num2 = parseInt(match[3], 10);
      
      switch (operator) {
        case '+': return (num1 + num2).toString();
        case '-': return (num1 - num2).toString();
        case '*':
        case 'x': return (num1 * num2).toString();
        case '/':
        case '÷': return num2 !== 0 ? (Math.floor(num1 / num2)).toString() : text;
      }
    }
    
    // 如果不是数学题，原样返回
    return text;
  }

  let sharedCanvas = null;
  /** 获取全局复用的 Canvas 以减少内存碎片 */
  function getSharedCanvas() {
    if (!sharedCanvas) sharedCanvas = document.createElement('canvas');
    return sharedCanvas;
  }

  /** 提取图片的 Base64 编码，支持跨域回退 */
  function getImageBase64(imgEl) {
    return new Promise((resolve) => {
      const w = imgEl.naturalWidth || imgEl.width;
      const h = imgEl.naturalHeight || imgEl.height;
      const canvas = getSharedCanvas();
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      try {
        ctx.drawImage(imgEl, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        // 跨域图片：用 crossOrigin='Anonymous' 重新加载
        const tmp = new Image();
        tmp.crossOrigin = 'Anonymous';
        tmp.onload = () => {
          ctx.drawImage(tmp, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        };
        tmp.onerror = () => resolve(null);
        tmp.src = imgEl.src;
      }
    });
  }

  /** 兼容 React/Vue 框架的输入框填充（带识别成功动感瞬态绿/红光呼吸提醒） */
  function fillInput(el, text, imgEl) {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    // 使用独立的浮层来渲染光晕，彻底解决 overflow: hidden 导致光晕被裁切/盖住的问题
    showTransientGlow(el, '#10b981', 'rgba(16, 185, 129, 0.85)');
    if (imgEl) {
      showTransientGlow(imgEl, '#bd4444', 'rgba(189, 68, 68, 0.85)');
    }
  }

  /** 创建独立悬浮层展示发光效果，避免被父元素的 overflow: hidden 遮挡 */
  function showTransientGlow(el, colorHex, colorRgba) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const overlay = document.createElement('div');
    
    // 获取原元素的圆角，如果是 0px 则默认给个 4px 让发光边缘更好看
    let radius = window.getComputedStyle(el).borderRadius;
    if (!radius || radius === '0px') radius = '4px';

    Object.assign(overlay.style, {
      position: 'absolute',
      pointerEvents: 'none',
      zIndex: '2147483647',
      left: `${window.scrollX + rect.left}px`,
      top: `${window.scrollY + rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      borderRadius: radius,
      boxShadow: `0 0 0 2px ${colorHex}, 0 0 20px ${colorRgba}`,
      opacity: '1',
      transition: 'opacity 0.3s ease',
      boxSizing: 'border-box',
      margin: '0',
      padding: '0'
    });

    document.body.appendChild(overlay);

    // 1.5 秒后自动完全淡出，并移除 DOM
    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 300);
    }, 1500);
  }

  let noticeTimer = null;

  /** 在目标元素上方显示精致的现代磨砂玻璃浮动提示 */
  function showNotice(anchor, msg, duration) {
    let tip = document.getElementById('captcha-solver-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'captcha-solver-tip';
      Object.assign(tip.style, {
        position: 'absolute',
        zIndex: '999999',
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(10px)',
        webkitBackdropFilter: 'blur(10px)',
        color: '#f8fafc',
        padding: '6px 14px',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: '500',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        boxShadow: '0 8px 20px -4px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.12)',
        pointerEvents: 'none',
        opacity: '0',
        transform: 'translateY(6px)',
        transition: 'opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
      });
      document.body.appendChild(tip);
    }

    if (noticeTimer) clearTimeout(noticeTimer);

    const rect = anchor.getBoundingClientRect();
    tip.textContent = msg;

    // 计算定位：适当向上拉开一点距离，防止覆盖输入框上方标签
    const topPos = window.scrollY + rect.top - 42;
    const leftPos = window.scrollX + rect.left;

    tip.style.top = `${Math.max(10, topPos)}px`;
    tip.style.left = `${leftPos}px`;

    // 触发淡入动画
    requestAnimationFrame(() => {
      tip.style.opacity = '1';
      tip.style.transform = 'translateY(0)';
    });

    if (duration) {
      noticeTimer = setTimeout(() => {
        tip.style.opacity = '0';
        tip.style.transform = 'translateY(-4px)';
      }, duration);
    }
  }

  /** 安全执行 querySelector，无效选择器不抛异常 */
  function querySafe(selector) {
    if (!selector) return null;
    try { return document.querySelector(selector); }
    catch { return null; }
  }

  /** 判断元素是否可见 */
  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  /** 判断图片是否加载完成且 src 有效 */
  function isCaptchaValid(img) {
    if (!img || !img.src) return false;
    // 排除占位符/空 src
    const src = img.src.trim().toLowerCase();
    if (src === '' || src === 'about:blank' || src.startsWith('javascript:')) return false;
    // 确保图片真实加载完毕，naturalWidth > 0
    return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  }

  /** 判断图片尺寸是否符合验证码特征（宽 50~350, 高 15~150） */
  function isCaptchaSize(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    return w > 50 && w < 350 && h > 15 && h < 150;
  }
})();
