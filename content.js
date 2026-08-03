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

  /** 滑动拼图验证码的通用 CSS 选择器 */
  const SLIDER_SELECTORS = {
    // 滑动容器（最外层包裹元素）
    container: [
      '.geetest_panel', '.geetest_widget',
      '.tc-action-panel',
      '#aliyunCaptcha-sliding',
      '.yidun_panel',
      '.slider',
      '[class*="slide-verify"]', '[class*="slider-captcha"]',
      '[class*="puzzle"][class*="captcha"]'
    ],
    // 背景大图
    bgImage: [
      '.geetest_canvas_bg canvas', '.geetest_canvas_bg img',
      '.tc-bg-img img',
      '.yidun_bg-img img',
      '.bg-img-div img',
      '[class*="slide"] img[class*="bg"]',
      '[class*="captcha"] canvas[class*="bg"]',
      '[class*="bg"] img',
      '[class*="puzzle"] img:not([class*="piece"]):not([class*="block"]):not([class*="slice"])'
    ],
    // 滑块拼图小图
    pieceImage: [
      '.geetest_canvas_slice canvas', '.geetest_slice_bg img',
      '.tc-jpp-img img',
      '.yidun_jigsaw img',
      '.slider-img-div img',
      '[class*="slide"] img[class*="piece"]',
      '[class*="slide"] img[class*="block"]',
      '[class*="slide"] img[class*="slice"]',
      '[class*="slider"] img'
    ],
    // 拖拽滑块按钮
    sliderBtn: [
      '.geetest_slider_button',
      '.tc-slider-normal',
      '.yidun_slider__icon',
      '.slider-move-btn',
      '[class*="slider"] [class*="btn"]:not([class*="refresh"])',
      '[class*="slider"] [class*="handle"]',
      '[class*="slider"] [class*="drag"]',
      '[class*="slider"] [class*="icon"]:not([class*="refresh"])'
    ],
    // 滑动轨道
    track: [
      '.geetest_slider',
      '.tc-slider-bar',
      '.yidun_slider',
      '.slider-move-track',
      '[class*="slider"] [class*="track"]',
      '[class*="slider"] [class*="bar"]'
    ]
  };

  // ==================== 运行时状态 ====================

  let isProcessing = false;
  let isEnabled = true;
  let customImgSel = '';
  let customInputSel = '';
  let isSliderProcessing = false;
  let customSliderBgSel = '';
  let customSliderBtnSel = '';

  // ==================== 入口 ====================

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

    chrome.storage.sync.get(['enabled', 'customImgSelector', 'customInputSelector', 'customSliderBgSelector', 'customSliderBtnSelector'], (res) => {
      isEnabled = res.enabled !== false;
      customImgSel = res.customImgSelector || '';
      customInputSel = res.customInputSelector || '';
      customSliderBgSel = res.customSliderBgSelector || '';
      customSliderBtnSel = res.customSliderBtnSelector || '';
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.enabled) isEnabled = changes.enabled.newValue !== false;
      if (changes.customImgSelector) customImgSel = changes.customImgSelector.newValue || '';
      if (changes.customInputSelector) customInputSel = changes.customInputSelector.newValue || '';
      if (changes.customSliderBgSelector) customSliderBgSel = changes.customSliderBgSelector.newValue || '';
      if (changes.customSliderBtnSelector) customSliderBtnSel = changes.customSliderBtnSelector.newValue || '';
    });
  }

  // ==================== DOM 扫描与监听 ====================

  /** 启动防抖的 DOM 变动监听与交互监听 */
  function startObserving() {
    let scanTimer = null;
    const triggerScan = () => {
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        scanAndSolve();
        scanAndSolveSlider();
      }, MUTATION_DEBOUNCE_MS);
    };

    scanAndSolve(); // 初始扫描
    scanAndSolveSlider();

    if (document.body) {
      new MutationObserver((mutations) => {
        // 过滤：有新增节点或属性 src/style/class 改变时才触发扫描
        const shouldScan = mutations.some(m => 
          m.addedNodes.length > 0 || 
          m.attributeName === 'src' || 
          m.attributeName === 'style' || 
          m.attributeName === 'class'
        );
        if (shouldScan) triggerScan();
      }).observe(document.body, { 
        childList: true, 
        subtree: true, 
        attributes: true, 
        attributeFilter: ['src', 'style', 'class'] 
      });
    }

    // 监听全局所有的图片加载事件（使用捕获阶段，因为 load 不冒泡）
    // 解决单页应用中，图片刚插入 DOM 时没有尺寸导致 isCaptchaSize 漏判的问题
    document.addEventListener('load', (e) => {
      if (e.target && e.target.tagName === 'IMG') {
        triggerScan();
      }
    }, true);

    // 按需触发：用户聚焦或离开 input 时触发轻量级扫描
    document.addEventListener('focusin', (e) => {
      if (e.target && e.target.tagName === 'INPUT') {
        triggerScan();
      }
    });
    
    document.addEventListener('focusout', (e) => {
      if (e.target && e.target.tagName === 'INPUT') {
        // 延迟触发，等待由于失焦产生的表单数据同步（如 Vue v-model）
        setTimeout(() => triggerScan(), 300);
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

  /** 在元素相对位置绘制一条垂直调试参考线 */
  function drawDebugMarker(anchorEl, offsetX, color, text) {
    const rect = anchorEl.getBoundingClientRect();
    const marker = document.createElement('div');
    
    // 红色半透明垂直线
    Object.assign(marker.style, {
      position: 'absolute',
      zIndex: '2147483647',
      pointerEvents: 'none',
      left: `${window.scrollX + rect.left + offsetX}px`,
      top: `${window.scrollY + rect.top}px`,
      width: '4px',
      height: `${rect.height}px`,
      backgroundColor: color,
      boxShadow: '0 0 4px rgba(0,0,0,0.5)'
    });
    
    // 顶部文本提示标签
    const label = document.createElement('div');
    label.textContent = text;
    Object.assign(label.style, {
      position: 'absolute',
      top: '-20px',
      left: '-10px',
      backgroundColor: color,
      color: '#fff',
      fontSize: '12px',
      padding: '2px 4px',
      borderRadius: '2px',
      whiteSpace: 'nowrap'
    });
    
    marker.appendChild(label);
    document.body.appendChild(marker);
    
    // 5秒后自动清除调试标记
    setTimeout(() => {
      if (marker.parentNode) marker.parentNode.removeChild(marker);
    }, 5000);
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

  // ==================== 滑动验证码 ====================

  async function scanAndSolveSlider() {
    if (!isEnabled || isSliderProcessing) return;

    // 查找滑动验证码元素
    const sliderElements = findSliderElements();
    if (!sliderElements) return;

    const { bgEl, pieceEl, btnEl, trackEl } = sliderElements;

    // 获取当前背景图来源（src 或 css background）
    const currentSrc = bgEl.src || bgEl.style.backgroundImage || '';

    // 防重复：如果已处理过，且图片没有变，则跳过；如果图片变了，说明用户点击了刷新，重置状态
    if (btnEl.dataset.sliderSolved === 'true') {
      if (btnEl.dataset.sliderSrc === currentSrc) {
        return;
      } else {
        btnEl.dataset.sliderSolved = 'false'; // 图片变了，重置状态
      }
    }
    
    // 记录本次处理的图片
    btnEl.dataset.sliderSrc = currentSrc;

    // 校验背景图片是否加载完成且不是透明/占位
    if (!isCaptchaValid(bgEl)) return;

    isSliderProcessing = true;
    showNotice(btnEl, '🧩 正在识别滑动验证码...');

    try {
      // 提取图像
      const bgBase64 = await getElementImage(bgEl);
      const pieceBase64 = pieceEl && isCaptchaValid(pieceEl) ? await getElementImage(pieceEl) : null;

      if (!bgBase64) throw new Error('无法提取背景图');

      const bgRect = bgEl.getBoundingClientRect();
      const bgNaturalWidth = bgEl.naturalWidth || bgEl.width || bgRect.width;
      const scale = bgRect.width / bgNaturalWidth;

      let initialPieceLeft = 0;
      if (pieceEl) {
        const pieceRect = pieceEl.getBoundingClientRect();
        initialPieceLeft = Math.max(0, (pieceRect.left - bgRect.left) / scale);
      }

      console.log('[CaptchaSolver] 滑动验证码图像已提取，正在分析缺口位置...');

      // 发送到 Background -> Offscreen 进行缺口定位
      const result = await chrome.runtime.sendMessage({
        type: 'slider',
        bgImage: bgBase64,
        pieceImage: pieceBase64,
        initialLeft: initialPieceLeft
      });

      if (result && result.success && typeof result.offsetX === 'number') {
        const targetCssX = (typeof result.targetX === 'number' ? result.targetX : (result.offsetX + initialPieceLeft)) * scale;
        const dragDistance = Math.round(result.offsetX * scale);

        console.log(
          `[CaptchaSolver] ✅ 缺口定位成功: targetX=%c${result.targetX || 'N/A'}px%c, startX=%c${result.startX || 0}px%c, 相对偏移=%c${result.offsetX}px%c (实际拖拽距离: ${dragDistance}px, scale: ${scale.toFixed(2)})`,
          'color:#2563eb; font-weight:bold;', '',
          'color:#9333ea; font-weight:bold;', '',
          'color:#16a34a; font-weight:bold;', ''
        );

        // 【调试可视化】
        // 1. 在背景图上标出图像识别引擎给出的绝对目标缺口位置（红线）
        drawDebugMarker(bgEl, targetCssX, 'rgba(239, 68, 68, 0.85)', '目标缺口');
        
        // 2. 在滑块轨道上标出插件将要把滑块拖动到的终点位置（绿线）
        drawDebugMarker(btnEl, dragDistance, 'rgba(16, 185, 129, 0.85)', '拖拽终点');

        // 执行模拟拖拽
        const dragSuccess = await simulateSliderDrag(btnEl, trackEl, dragDistance);
        if (!dragSuccess) {
          throw new Error('拖拽被拦截，请先填写账号密码');
        }

        btnEl.dataset.sliderSolved = 'true';
        showNotice(btnEl, `✅ 滑动验证码已完成`, 2500);
        showTransientGlow(btnEl, '#10b981', 'rgba(16, 185, 129, 0.85)');
      } else {
        throw new Error((result && result.error) || '缺口定位失败');
      }
    } catch (err) {
      console.error('[CaptchaSolver] 滑动验证码处理失败:', err);
      showNotice(btnEl, `⚠️ ${err.message}`, 3000);
    } finally {
      isSliderProcessing = false;
    }
  }

  function findSliderElements() {
    // 优先使用用户自定义选择器
    const customBg = querySafe(customSliderBgSel);
    const customBtn = querySafe(customSliderBtnSel);

    let bgEl = null, pieceEl = null, btnEl = null, trackEl = null;

    // 查找背景图
    if (customBg && isVisible(customBg)) {
      bgEl = customBg;
    } else {
      for (const sel of SLIDER_SELECTORS.bgImage) {
        const el = querySafe(sel);
        if (el && isVisible(el)) { bgEl = el; break; }
      }
    }

    // 查找滑块按钮
    if (customBtn && isVisible(customBtn)) {
      btnEl = customBtn;
    } else {
      for (const sel of SLIDER_SELECTORS.sliderBtn) {
        const el = querySafe(sel);
        if (el && isVisible(el)) { btnEl = el; break; }
      }
    }

    // 必须同时找到背景图和滑块按钮
    if (!bgEl || !btnEl) return null;

    // 查找拼图小图（可选）
    for (const sel of SLIDER_SELECTORS.pieceImage) {
      const el = querySafe(sel);
      if (el && isVisible(el)) { pieceEl = el; break; }
    }

    // 查找轨道（可选，用于计算拖拽范围）
    for (const sel of SLIDER_SELECTORS.track) {
      const el = querySafe(sel);
      if (el && isVisible(el)) { trackEl = el; break; }
    }
    // 如果没有找到轨道，使用按钮的父元素作为轨道
    if (!trackEl) trackEl = btnEl.parentElement;

    return { bgEl, pieceEl, btnEl, trackEl };
  }

  async function getElementImage(el) {
    if (el.tagName === 'CANVAS') {
      try {
        return el.toDataURL('image/png');
      } catch {
        return null;
      }
    }
    // img 元素复用现有逻辑
    return getImageBase64(el);
  }

  function generateHumanTrack(distance) {
    const points = [];
    const totalDuration = 600 + Math.random() * 600; // 600~1200ms
    const steps = 30 + Math.floor(Math.random() * 20); // 30~50步

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      
      // 三段式缓动：快加速 → 匀速 → 慢减速
      let easedT;
      if (t < 0.4) {
        // 加速阶段：easeIn
        easedT = 2 * t * t;
      } else if (t < 0.75) {
        // 匀速阶段
        easedT = 0.32 + (t - 0.4) * 1.6;
      } else {
        // 减速阶段：easeOut
        const rem = (t - 0.75) / 0.25;
        easedT = 0.88 + 0.12 * (1 - Math.pow(1 - rem, 3));
      }

      const x = Math.round(distance * easedT);
      const y = Math.round((Math.random() - 0.5) * 4); // ±2px Y轴抖动
      const time = Math.round(totalDuration * t);
      points.push({ x, y, time });
    }

    // 末尾添加2~3个微回弹点（模拟过冲修正）
    const overshoot = 2 + Math.floor(Math.random() * 3); // 过冲2~4px
    const lastTime = points[points.length - 1].time;
    points.push({ x: distance + overshoot, y: 0, time: lastTime + 50 });
    points.push({ x: distance + Math.floor(overshoot / 2), y: 0, time: lastTime + 100 });
    points.push({ x: distance, y: 0, time: lastTime + 150 });

    return points;
  }

  async function simulateSliderDrag(btnEl, trackEl, distance) {
    const btnRect = btnEl.getBoundingClientRect();
    const startX = Math.round(btnRect.left + btnRect.width / 2);
    const startY = Math.round(btnRect.top + btnRect.height / 2);

    const track = generateHumanTrack(distance);

    // 辅助创建兼顾 UI Event 与 Vue Data 要求的 MouseEvent/PointerEvent
    const createMouseEvent = (type, x, y, buttons = 1) => {
      const evt = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons: buttons
      });
      // 显式覆写可能只读的 pageX / pageY，Element-UI Vue 组件依赖这两个属性
      Object.defineProperty(evt, 'pageX', { value: x, configurable: true });
      Object.defineProperty(evt, 'pageY', { value: y, configurable: true });
      return evt;
    };

    // 按下 MouseDown / PointerDown
    btnEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY, button: 0, buttons: 1 }));
    btnEl.dispatchEvent(createMouseEvent('mousedown', startX, startY, 1));

    // 沿轨迹滑动 MouseMove / PointerMove (同时发送给按钮、window、document 确保事件被收到)
    let prevTime = 0;
    let maxOffset = 0;
    for (const point of track) {
      const delay = point.time - prevTime;
      if (delay > 0) await sleep(delay);
      prevTime = point.time;

      const moveX = startX + point.x;
      const moveY = startY + point.y;

      const mouseMoveEvt = createMouseEvent('mousemove', moveX, moveY, 1);
      btnEl.dispatchEvent(mouseMoveEvt);
      window.dispatchEvent(mouseMoveEvt);
      document.dispatchEvent(mouseMoveEvt);
      
      // 动态检测滑块是否真的在移动
      const currentLeft = Math.round(btnEl.getBoundingClientRect().left + btnRect.width / 2);
      maxOffset = Math.max(maxOffset, Math.abs(currentLeft - startX));
    }

    // 释放 MouseUp / PointerUp
    const endX = startX + distance;
    const mouseUpEvt = createMouseEvent('mouseup', endX, startY, 0);
    btnEl.dispatchEvent(mouseUpEvt);
    window.dispatchEvent(mouseUpEvt);
    document.dispatchEvent(mouseUpEvt);
    
    // 如果实际最大位移不到 5px，说明拖拽事件被页面 Vue 拦截拒绝了
    return maxOffset >= 5;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 确保在所有变量声明后执行
  init();
})();
