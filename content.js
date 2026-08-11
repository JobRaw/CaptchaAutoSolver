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

  /** 旋转验证码的通用 CSS 选择器 */
  const ROTATION_SELECTORS = {
    // 外部背景图
    outerImage: [
      '[class*="rotate"] img[class*="bg"]', '[class*="rotate"] img[class*="outer"]',
      '[class*="rotation"] img[class*="bg"]', '[class*="rotation"] img[class*="outer"]',
      '[class*="rotate"] img:first-child', '[class*="spin"] img[class*="bg"]',
      '[class*="captcha"] [class*="bg"]', '[class*="verify"] [class*="bg"]',
      '[class*="captcha"] img:first-child', '[class*="verify"] img:first-child',
      '[class*="captcha"] canvas', '[class*="verify"] canvas',
      '.yidun_bg-img', '.dx_captcha_bg', '.sec-code-bg', '.v_code_bg', '.geetest_bg', '.sm-bg', '.tc-bg',
      '.verify-img-panel taro-image-core', '.verify-img-panel img', '.verify-img-panel',
      '[class*="modal"] img', '[class*="popup"] img', '[class*="dialog"] img'
    ],
    // 圆形旋转内容图
    innerImage: [
      '[class*="rotate"] img[class*="inner"]', '[class*="rotate"] img[class*="circle"]',
      '[class*="rotate"] img[class*="rotate"]', '[class*="rotate"] [class*="circle"] img',
      '[class*="rotation"] img[class*="inner"]', '[class*="rotation"] img[class*="rotate"]',
      '[class*="spin"] img[class*="inner"]', '[class*="spin"] img[class*="circle"]',
      '[class*="captcha"] [class*="circle"]', '[class*="verify"] [class*="circle"]',
      '[class*="captcha"] [class*="rotate"]', '[class*="verify"] [class*="rotate"]',
      '.yidun_jigsaw', '.dx_captcha_slider', '.sec-code-circle', '.v_code_rotate', '.geetest_slice', '.sm-slice', '.tc-slice',
      '.verify-sub-block taro-image-core', '.verify-sub-block img', '.verify-sub-block',
      '[class*="circle"] img', '[class*="round"] img', '[class*="circle"] canvas', '[class*="round"] canvas',
      '[class*="circle"]', '[class*="round"]', '[class*="inner"]'
    ],
    // 拖拽滑块按钮
    sliderBtn: [
      '[class*="rotate"] [class*="slider"] [class*="btn"]',
      '[class*="rotate"] [class*="drag"]', '[class*="rotate"] [class*="handle"]',
      '[class*="rotation"] [class*="slider"] [class*="btn"]',
      '[class*="rotation"] [class*="slider"] [class*="icon"]:not([class*="refresh"])',
      '[class*="spin"] [class*="slider"] [class*="btn"]', '[class*="spin"] [class*="drag"]',
      '[class*="slider"] [class*="btn"]', '[class*="slide"] [class*="btn"]',
      '[class*="slider"] [class*="handler"]', '[class*="slide"] [class*="handler"]',
      '[class*="slider"] [class*="control"]', '[class*="slide"] [class*="control"]',
      '.yidun_slider', '.dx_captcha_btn', '.sec-code-btn', '.geetest_btn', '.sm-btn', '.tc-drag-btn',
      '.verify-move-block',
      '[class*="captcha"] [class*="btn"]', '[class*="verify"] [class*="btn"]'
    ],
    // 滑动轨道
    track: [
      '[class*="rotate"] [class*="slider"]', '[class*="rotate"] [class*="track"]',
      '[class*="rotate"] [class*="bar"]',
      '[class*="rotation"] [class*="slider"]', '[class*="rotation"] [class*="track"]',
      '[class*="spin"] [class*="slider"]', '[class*="spin"] [class*="track"]',
      '[class*="slider"] [class*="track"]', '[class*="slide"] [class*="track"]',
      '.verify-bar-area',
      '[class*="slider"]', '[class*="track"]', '[class*="drag-bar"]'
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
  let isRotationProcessing = false;
  let customRotationOuterSel = '';
  let customRotationInnerSel = '';
  let customRotationBtnSel = '';
  let algoV1Enabled = true;
  let algoV2Enabled = true;
  let algoV3Enabled = true;
  let dataCollectEnabled = true;

  // ==================== 入口 ====================

  function init() {
    console.log(
      '%c[CaptchaSolver]%c 🚀 验证码自动识别扩展已启动并注入页面！',
      'color: #10b981; font-weight: bold;', 'color: auto;'
    );
    loadUserConfig();
    startObserving();
  }

  // ==================== 配置管理 ====================

  /** 从 chrome.storage 加载用户配置并监听实时变更 */
  function loadUserConfig() {
    if (!chrome.storage?.sync) return;

    chrome.storage.sync.get(['enabled', 'algoV1', 'algoV2', 'algoV3', 'dataCollect', 'customImgSelector', 'customInputSelector', 'customSliderBgSelector', 'customSliderBtnSelector', 'customRotationOuterSelector', 'customRotationInnerSelector', 'customRotationBtnSelector'], (res) => {
      isEnabled = res.enabled !== false;
      customImgSel = res.customImgSelector || '';
      customInputSel = res.customInputSelector || '';
      customSliderBgSel = res.customSliderBgSelector || '';
      customSliderBtnSel = res.customSliderBtnSelector || '';
      customRotationOuterSel = res.customRotationOuterSelector || '';
      customRotationInnerSel = res.customRotationInnerSelector || '';
      customRotationBtnSel = res.customRotationBtnSelector || '';
      algoV1Enabled = res.algoV1 !== false;
      algoV2Enabled = res.algoV2 !== false;
      algoV3Enabled = res.algoV3 !== false;
      dataCollectEnabled = res.dataCollect !== false;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.enabled) isEnabled = changes.enabled.newValue !== false;
      if (changes.customImgSelector) customImgSel = changes.customImgSelector.newValue || '';
      if (changes.customInputSelector) customInputSel = changes.customInputSelector.newValue || '';
      if (changes.customSliderBgSelector) customSliderBgSel = changes.customSliderBgSelector.newValue || '';
      if (changes.customSliderBtnSelector) customSliderBtnSel = changes.customSliderBtnSelector.newValue || '';
      if (changes.customRotationOuterSelector) customRotationOuterSel = changes.customRotationOuterSelector.newValue || '';
      if (changes.customRotationInnerSelector) customRotationInnerSel = changes.customRotationInnerSelector.newValue || '';
      if (changes.customRotationBtnSelector) customRotationBtnSel = changes.customRotationBtnSelector.newValue || '';
      if (changes.algoV1) algoV1Enabled = changes.algoV1.newValue !== false;
      if (changes.algoV2) algoV2Enabled = changes.algoV2.newValue !== false;
      if (changes.algoV3) algoV3Enabled = changes.algoV3.newValue !== false;
      if (changes.dataCollect) dataCollectEnabled = changes.dataCollect.newValue !== false;
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
        scanAndSolveRotation();
      }, MUTATION_DEBOUNCE_MS);
    };

    scanAndSolve(); // 初始扫描
    scanAndSolveSlider();
    scanAndSolveRotation();

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

    // 监听全局所有的图片及 Taro 图片加载事件（使用捕获阶段，因为 load 不冒泡）
    document.addEventListener('load', (e) => {
      if (e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'TARO-IMAGE-CORE')) {
        triggerScan();
      }
    }, true);

    let activePollTimer = null;
    const triggerHighFrequencyScan = () => {
      if (activePollTimer) clearInterval(activePollTimer);
      let count = 0;
      activePollTimer = setInterval(() => {
        scanAndSolveRotation();
        scanAndSolveSlider();
        scanAndSolve();
        count++;
        if (count >= 15) {
          clearInterval(activePollTimer);
          activePollTimer = null;
        }
      }, 1000);
    };

    // 针对异步 HTTP 请求加载的验证码：在点击“获取验证码”等按钮时启动轮询探测（每 1 秒一次，持续 15 秒保底）
    document.addEventListener('click', triggerHighFrequencyScan, true);
    document.addEventListener('touchstart', triggerHighFrequencyScan, true);

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
      
      let srcChangeTimer = null;
      new MutationObserver(() => {
        if (srcChangeTimer) clearTimeout(srcChangeTimer);
        srcChangeTimer = setTimeout(() => solveTarget(imgEl, inputEl), SRC_CHANGE_DEBOUNCE_MS);
      }).observe(imgEl, { attributes: true, attributeFilter: ['src'] });

      let clickTimer = null;
      imgEl.addEventListener('click', () => {
        if (clickTimer) clearTimeout(clickTimer);
        clickTimer = setTimeout(() => solveTarget(imgEl, inputEl), CLICK_REFRESH_DEBOUNCE_MS);
      });
    }

    if (!inputEl.dataset.hasSolverObserver) {
      inputEl.dataset.hasSolverObserver = 'true';
      
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

  /** 提取图片的 Base64 编码，支持跨域回退 */
  function getImageBase64(imgEl) {
    return new Promise((resolve) => {
      const w = imgEl.naturalWidth || imgEl.width;
      const h = imgEl.naturalHeight || imgEl.height;
      const canvas = document.createElement('canvas');
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
    let src = img.src || img.getAttribute('src');
    if (!src) {
      if (img.tagName === 'TARO-IMAGE-CORE' || img.tagName === 'IMG' || img.tagName === 'CANVAS') return true;
      return false;
    }
    // 排除占位符/空 src
    src = src.trim().toLowerCase();
    if (src === '' || src === 'about:blank' || src.startsWith('javascript:')) return false;
    // 确保图片真实加载完毕，naturalWidth > 0（仅限原生 img）
    if (img.tagName === 'IMG' && (!img.complete || img.naturalWidth === 0)) return false;
    return true;
  }

  /** 判断图片尺寸是否符合验证码特征（宽 50~350, 高 15~150） */
  function isCaptchaSize(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    return w > 50 && w < 350 && h > 15 && h < 150;
  }

  /** 判断旋转验证码图像元素是否就绪（兼容 img/canvas/div 背景图） */
  function isRotationImageReady(el) {
    if (!el) return false;
    // img 元素或自定义图片：检查 src 有效且已加载
    if (el.tagName === 'IMG' || el.tagName === 'TARO-IMAGE-CORE') {
      return isCaptchaValid(el);
    }
    // canvas 元素：检查宽高有效
    if (el.tagName === 'CANVAS') {
      return el.width > 0 && el.height > 0;
    }
    // div 等元素：检查 background-image 是否存在
    const bg = window.getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    // 或者它是一个包含图片的容器
    if (el.querySelector('img, taro-image-core')) {
      return true;
    }
    return false;
  }

  /** 判断元素是否为圆形（检查自身和父元素的 border-radius，或宽高比 ≈ 1:1） */
  function isElementCircular(el) {
    const targets = [el, el.parentElement].filter(Boolean);
    for (const t of targets) {
      const br = window.getComputedStyle(t).borderRadius;
      if (br && br.includes('50%')) return true;
      // 处理 "75px" 这种绝对值：与元素短边一半对比
      const match = br && br.match(/^(\d+(?:\.\d+)?)px$/);
      if (match) {
        const rect = t.getBoundingClientRect();
        const halfSize = Math.min(rect.width, rect.height) / 2;
        if (Math.abs(parseFloat(match[1]) - halfSize) < 2) return true;
      }
    }
    // 宽高比接近 1:1，并且宽高介于 30 到 200 之间，大概率是验证码旋转内部图或拼图块
    const rect = el.getBoundingClientRect();
    if (rect.width >= 30 && rect.width <= 200 && rect.height >= 30 && rect.height <= 200) {
      return Math.abs(rect.width / rect.height - 1) < 0.15;
    }
    return false;
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
    const now = Date.now();

    if (btnEl.dataset.sliderSrc !== currentSrc) {
      btnEl.dataset.sliderSrc = currentSrc;
      btnEl.dataset.sliderSrcTime = now.toString();
      btnEl.dataset.sliderSolved = 'false';
    }

    if (btnEl.dataset.sliderSolved === 'true') {
      return; // 已成功解决该图，等待图片变化
    }

    // 防抖与加载等待：新图片出现后，强制等待 500ms
    const timeSinceNewSrc = now - parseInt(btnEl.dataset.sliderSrcTime || '0');
    if (timeSinceNewSrc < 500) {
      return; 
    }

    // 失败冷却期：如果刚失败不久，等待 2000ms 后再试
    if (btnEl.dataset.sliderFailedTime && now - parseInt(btnEl.dataset.sliderFailedTime) < 2000) {
      return;
    }

    // 校验背景图片是否加载完成且不是透明/占位
    if (!isCaptchaValid(bgEl)) return;

    isSliderProcessing = true;
    showNotice(btnEl, '🧩 正在识别滑动验证码...');

    try {
      // 提取图像数据（含 Base64 与真实物理尺寸）
      const bgData = await getElementImage(bgEl);
      const pieceData = pieceEl && isCaptchaValid(pieceEl) ? await getElementImage(pieceEl) : null;

      if (!bgData || !bgData.base64) throw new Error('无法提取背景图');

      const bgBase64 = bgData.base64;
      const pieceBase64 = pieceData ? pieceData.base64 : null;

      const bgRect = bgEl.getBoundingClientRect();
      const bgNaturalWidth = bgData.width || bgRect.width;
      const scale = bgRect.width / bgNaturalWidth;

      let initialPieceLeft = 0;
      if (pieceEl) {
        const pieceRect = pieceEl.getBoundingClientRect();
        initialPieceLeft = Math.max(0, (pieceRect.left - bgRect.left) / scale);
      }

      

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
      btnEl.dataset.sliderFailedTime = Date.now().toString();
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

  // ==================== 旋转验证码：记忆与自适应学习系统 ====================

  let OFFSET_EXPLORE_SEQUENCE = [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15, 18, -18, 20, -20];

  // 全局内存变量，解决 DOM 节点被销毁导致无法跨周期记录验证失败的问题
  let pendingRotationMemoryTask = null;
  let pendingRotationMetrics = null;

  // 轻量级 Base64 字符串归一化哈希生成器 (djb2 变体)
  function getStableImageHash(str) {
    if (!str) return 'empty';
    // 剥离可能存在的 base64 协议头
    const cleanStr = str.replace(/^data:image\/[a-z]+;base64,/, '').trim();
    let hash = 5381;
    const len = cleanStr.length;
    const step = Math.max(1, Math.floor(len / 1000));
    for (let i = 0; i < len; i += step) {
      hash = ((hash << 5) + hash) + cleanStr.charCodeAt(i);
      hash = hash & hash;
    }
    return 'img_' + Math.abs(hash).toString(36);
  }

  /** 将 Base64 图像等比压缩缩放，降至指定最大宽度并转为 WebP (默认 300px, 0.75 质量) */
  async function compressBase64Image(base64Str, maxWidth = 300) {
    if (!base64Str || typeof base64Str !== 'string') return '';
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            let width = img.naturalWidth || img.width || 300;
            let height = img.naturalHeight || img.height || 300;
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const compressed = canvas.toDataURL('image/webp', 0.75);
            resolve(compressed);
          } catch (e) {
            resolve(base64Str);
          }
        };
        img.onerror = () => resolve(base64Str);
        img.src = base64Str;
      } catch (e) {
        resolve(base64Str);
      }
    });
  }

  async function getMemoryOffset(imgHash) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['rotationMemory'], (res) => {
          const memory = res.rotationMemory || {};
          const record = memory[imgHash];
          if (!record) {
            console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] 🧠【缓存读取】未找到该图片的历史自适应缓存，使用初始默认偏移 0° (Hash: ${imgHash})`, 'color: #6b7280;');
            resolve({ offset: 0, stateIndex: 0, isMemorized: false });
          } else if (typeof record.bestOffset === 'number') {
            console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] 🧠【缓存读取 - 命中已锁定答案】成功读取已学习的最佳偏移量: ${record.bestOffset >= 0 ? '+' : ''}${record.bestOffset}° (Hash: ${imgHash})`, 'color: #059669; font-weight: bold;');
            resolve({ offset: record.bestOffset, stateIndex: record.stateIndex || 0, isMemorized: true });
          } else {
            const idx = record.stateIndex || 0;
            const offset = OFFSET_EXPLORE_SEQUENCE[idx] || 0;
            console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] 🧠【缓存读取 - 探索模式】读取当前探索轮次 (第 ${idx + 1} 次尝试)，计算尝试偏移量: ${offset >= 0 ? '+' : ''}${offset}° (Hash: ${imgHash})`, 'color: #d97706; font-weight: bold;');
            resolve({ offset, stateIndex: idx, isMemorized: false });
          }
        });
      } catch (e) {
        resolve({ offset: 0, stateIndex: 0, isMemorized: false });
      }
    });
  }

  async function saveMemoryResult(imgHash, appliedOffset, isSuccess, currentStateIndex, extraData = null) {
    try {
      chrome.storage.local.get(['rotationMemory'], (res) => {
        let memory = res.rotationMemory || {};
        const keys = Object.keys(memory);
        // 容量调控，超过 200 条自动淘汰最老的数据
        if (keys.length > 200) {
          let oldestKey = keys[0];
          let oldestTime = Infinity;
          for (const k of keys) {
            if (memory[k].time && memory[k].time < oldestTime) {
              oldestTime = memory[k].time;
              oldestKey = k;
            }
          }
          delete memory[oldestKey];
        }

        const existingRecord = memory[imgHash] || {};

        if (isSuccess) {
          // 验证通过，成功锁定最佳偏移量写入缓存
          memory[imgHash] = {
            bestOffset: appliedOffset,
            rawBestAngle: extraData?.rawBestAngle ?? existingRecord.rawBestAngle,
            outerImage: extraData?.outerImage ?? existingRecord.outerImage,
            innerImage: extraData?.innerImage ?? existingRecord.innerImage,
            cxRatio: extraData?.cxRatio ?? existingRecord.cxRatio ?? 0.5,
            cyRatio: extraData?.cyRatio ?? existingRecord.cyRatio ?? 0.5,
            radiusRatio: extraData?.radiusRatio ?? existingRecord.radiusRatio,
            manual: extraData?.manual ?? existingRecord.manual ?? false,
            time: Date.now()
          };
          console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] 🧠【缓存写入 - 锁定正确答案】验证成功！将最佳偏移量 (${appliedOffset >= 0 ? '+' : ''}${appliedOffset}°) 写入本地缓存 (Hash: ${imgHash})`, 'color: #059669; font-weight: bold;');
          console.log(`%c[DATA_COLLECTION] ${JSON.stringify({ hash: imgHash, bestOffset: appliedOffset, status: 'LEARNED' })}`, 'background: #fef9c3; color: #854d0e; padding: 2px 4px; font-family: monospace;');
        } else {
          // 验证失败
          if (memory[imgHash] && memory[imgHash].manual) {
            console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] 🧠【缓存保留】该记录为人工强行标注，本次失败不重置缓存设置 (Hash: ${imgHash})`, 'color: #d97706; font-weight: bold;');
          } else {
            let nextIdx = currentStateIndex + 1;
            // 如果原本以为已经学对了 (有 bestOffset)，但实际上失败了，说明答案失效或算法误判，必须回退重新探索
            if (memory[imgHash] && typeof memory[imgHash].bestOffset === 'number') {
              console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] 🧠【缓存写入 - 标记失效回退】先前记忆的偏移量 (${memory[imgHash].bestOffset}°) 验证失败！自动清除错误答案，强制退回探索模式从第 2 索引开始重新尝试 (Hash: ${imgHash})`, 'color: #ef4444; font-weight: bold;');
              nextIdx = 1;
            }
            memory[imgHash] = {
              stateIndex: nextIdx,
              rawBestAngle: extraData?.rawBestAngle ?? existingRecord.rawBestAngle,
              outerImage: extraData?.outerImage ?? existingRecord.outerImage,
              innerImage: extraData?.innerImage ?? existingRecord.innerImage,
              cxRatio: extraData?.cxRatio ?? existingRecord.cxRatio ?? 0.5,
              cyRatio: extraData?.cyRatio ?? existingRecord.cyRatio ?? 0.5,
              radiusRatio: extraData?.radiusRatio ?? existingRecord.radiusRatio,
              time: Date.now()
            };
            const nextOffset = OFFSET_EXPLORE_SEQUENCE[nextIdx] ?? '超出范围';
            console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] 🧠【缓存写入 - 推进探索】本次验证失败，写入更新探索状态: 下次遇到将尝试第 ${nextIdx + 1} 个探索偏移量 (${nextOffset}°) (Hash: ${imgHash})`, 'color: #d97706; font-weight: bold;');
            console.log(`%c[DATA_COLLECTION] ${JSON.stringify({ hash: imgHash, retryState: nextIdx, nextOffset: nextOffset, status: 'EXPLORING' })}`, 'background: #ffedd5; color: #c2410c; padding: 2px 4px; font-family: monospace;');
          }
        }

        chrome.storage.local.set({ rotationMemory: memory });
      });
    } catch (e) {}
  }

  // ==================== 旋转验证码 ====================

  async function scanAndSolveRotation() {
    if (!isEnabled) return;
    if (isRotationProcessing) {
      
      return;
    }

    // 查找旋转验证码元素
    const rotationElements = findRotationElements();
    if (!rotationElements) {
      // 可以在此处打印静默跳过，避免控制台刷屏
      return;
    }

    

    const { outerEl, innerEl, btnEl, trackEl } = rotationElements;

    // 获取当前图像来源（防重复）
    const currentSrc = outerEl.src || outerEl.getAttribute('src') || outerEl.style.backgroundImage || '';
    const now = Date.now();

    if (btnEl.dataset.rotationSrc !== currentSrc) {
      btnEl.dataset.rotationSrc = currentSrc;
      btnEl.dataset.rotationSrcTime = now.toString();
      btnEl.dataset.rotationSolved = 'false';
    }

    if (btnEl.dataset.rotationSolved === 'true') {
      return; // 已成功解决该图，等待图片变化
    }

    // 图片加载状态校验：如果是 IMG 标签且尚未加载完毕，绑定 load 事件并在加载完毕后重新触发识别
    if (outerEl.tagName === 'IMG' && (!outerEl.complete || outerEl.naturalWidth === 0)) {
      outerEl.addEventListener('load', () => scanAndSolveRotation(), { once: true });
      return;
    }
    if (innerEl.tagName === 'IMG' && (!innerEl.complete || innerEl.naturalWidth === 0)) {
      innerEl.addEventListener('load', () => scanAndSolveRotation(), { once: true });
      return;
    }

    // 防抖与过渡动画等待：新图片出现后，强制等待至少 800ms，让 Loading 动画彻底消失
    const timeSinceNewSrc = now - parseInt(btnEl.dataset.rotationSrcTime || '0');
    if (timeSinceNewSrc < 800) {
      setTimeout(() => scanAndSolveRotation(), 800 - timeSinceNewSrc);
      return; 
    }

    // 失败冷却期：如果刚失败不久，等待 2000ms 后再试，避免疯狂重试导致的验证码抽搐
    if (btnEl.dataset.rotationFailedTime && now - parseInt(btnEl.dataset.rotationFailedTime) < 2000) {
      return;
    }

    // 校验图片是否加载完成（兼容 img/canvas/div 背景图）
    const outerReady = isRotationImageReady(outerEl);
    const innerReady = isRotationImageReady(innerEl);
    if (!outerReady || !innerReady) {
      
      return;
    }

    // 只有经过了上面 800ms 的等待期、且图片确实加载完毕，才会到达这里。
    // 如果到达这里，说明我们正在对一张“全新”的图片发起真正的识别。
    // 这时如果还有残留的 pendingRotationMetrics 或 pendingRotationMemoryTask，那它 100% 就是上一轮验证失败留下的。
    if (pendingRotationMemoryTask) {
       try {
           console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] ⚠️ 检测到上一轮拖拽后图片重新刷新，认定上轮验证失败，补记失败缓存...`, 'color: #dc2626; font-weight: bold;');
           saveMemoryResult(
             pendingRotationMemoryTask.hash, 
             pendingRotationMemoryTask.offset, 
             false, 
             pendingRotationMemoryTask.stateIndex,
             pendingRotationMemoryTask.extraData
           );
       } catch (e) {}
       pendingRotationMemoryTask = null;
    }

    if (btnEl.dataset.pendingMetrics || pendingRotationMetrics) {
       try {
           const m = pendingRotationMetrics || JSON.parse(btnEl.dataset.pendingMetrics);
           m.outcome = 'FAIL';
           console.log(`%c[DATA_COLLECTION] ${JSON.stringify(m)}`, 'background: #fee2e2; color: #991b1b; padding: 2px 4px; font-family: monospace;');
       } catch (e) {}
       btnEl.dataset.pendingMetrics = '';
       pendingRotationMetrics = null;
    }

    isRotationProcessing = true;
    
    showNotice(btnEl, '🔄 正在识别旋转验证码...');

    try {
      // 提取图像和真实尺寸
      const outerData = await getElementImage(outerEl);
      const innerData = await getElementImage(innerEl);

      if (!outerData || !outerData.base64 || !innerData || !innerData.base64) {
        throw new Error('无法提取旋转验证码图像');
      }

      // 计算圆心和半径
      const outerRect = outerEl.getBoundingClientRect();
      const innerRect = innerEl.getBoundingClientRect();
      
      // 圆心相对于外部图像真实像素坐标的比例
      const scaleX = outerData.width / outerRect.width;
      const scaleY = outerData.height / outerRect.height;
      
      const cx = Math.round((innerRect.left - outerRect.left + innerRect.width / 2) * scaleX);
      const cy = Math.round((innerRect.top - outerRect.top + innerRect.height / 2) * scaleY);
      const radius = Math.round((Math.min(innerRect.width, innerRect.height) / 2) * scaleX);
      
      const innerScaleX = innerData.width / innerRect.width;
      const innerRadius = Math.round((Math.min(innerRect.width, innerRect.height) / 2) * innerScaleX);

      

      // 发送到 Background -> Offscreen 进行角度检测
      const result = await chrome.runtime.sendMessage({
        type: 'rotation',
        outerImage: outerData.base64,
        innerImage: innerData.base64,
        cx: cx,
        cy: cy,
        radius: radius,
        innerRadius: innerRadius,
        algoOptions: {
          v1: algoV1Enabled,
          v2: algoV2Enabled,
          v3: algoV3Enabled,
          collect: dataCollectEnabled
        }
      });

      let angleToUse = 0;
      let isFallback = false;

      // 提取图片指纹及记忆偏移
      const imgHash = getStableImageHash(outerData.base64);
      const memInfo = await getMemoryOffset(imgHash);
      const appliedOffset = memInfo.offset;

      // 图像轻量 WebP 压缩，用于设置页面的可视化调试
      const compressedOuter = await compressBase64Image(outerData.base64, 300);
      const compressedInner = await compressBase64Image(innerData.base64, 150);
      const cxRatio = outerData.width ? (cx / outerData.width) : 0.5;
      const cyRatio = outerData.height ? (cy / outerData.height) : 0.5;

      const radiusRatio = 0.25;

      const extraData = {
        rawBestAngle: result ? (result.bestAngle || 0) : 0,
        outerImage: compressedOuter,
        innerImage: compressedInner,
        cxRatio: cxRatio,
        cyRatio: cyRatio,
        radiusRatio: radiusRatio
      };

      if (result && result.debugLogs && Array.isArray(result.debugLogs)) {
        // 在前台 (网页 F12) 打印来自离屏后台的分析日志
        result.debugLogs.forEach(log => {
          console.log(`%c${log}`, 'color: #9333ea; font-style: italic;');
        });
      }

      if (result) {
        pendingRotationMetrics = {
            ...(result.metrics || {}),
            details: result.details || {},
            bestAngle: result.bestAngle,
            confidence: result.confidence
        };
        pendingRotationMemoryTask = {
            hash: imgHash,
            offset: appliedOffset,
            stateIndex: memInfo.stateIndex || 0,
            extraData: extraData
        };
        btnEl.dataset.pendingMetrics = JSON.stringify(pendingRotationMetrics);
      }

      if (result && result.success && typeof result.bestAngle === 'number') {
        const rawBestAngle = result.bestAngle;
        // 计算结合了记忆偏移量的最终角度
        angleToUse = (rawBestAngle + appliedOffset + 360) % 360;
        
        if (memInfo.isMemorized) {
          console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] 🧠【自适应生效 - 命中锁定答案】原始计算角度: ${rawBestAngle}° | 加上记忆正确偏移量: ${appliedOffset >= 0 ? '+' : ''}${appliedOffset}° | 最终执行角度: ${angleToUse}° (Hash: ${imgHash})`, 'color: #059669; font-weight: bold;');
          console.log(`%c[DATA_COLLECTION] ${JSON.stringify({ hash: imgHash, action: 'APPLY_LEARNED', offset: appliedOffset, original: rawBestAngle, final: angleToUse })}`, 'background: #dcfce7; color: #166534; padding: 2px 4px; font-family: monospace;');
        } else if (appliedOffset !== 0) {
          console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] 🧠【自适应生效 - 试探偏移中】原始计算角度: ${rawBestAngle}° | 加上试探偏移量(第 ${memInfo.stateIndex + 1} 次尝试): ${appliedOffset >= 0 ? '+' : ''}${appliedOffset}° | 最终执行角度: ${angleToUse}° (Hash: ${imgHash})`, 'color: #d97706; font-weight: bold;');
          console.log(`%c[DATA_COLLECTION] ${JSON.stringify({ hash: imgHash, action: 'APPLY_EXPLORE', attempt: memInfo.stateIndex + 1, offset: appliedOffset, original: rawBestAngle, final: angleToUse })}`, 'background: #fef08a; color: #a16207; padding: 2px 4px; font-family: monospace;');
        } else {
          // appliedOffset === 0 且没有命中记忆时
          console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] 🧠【自适应无偏移】原始计算角度: ${rawBestAngle}° | 偏移量: 0° | 最终执行角度: ${angleToUse}° (Hash: ${imgHash})`, 'color: #4b5563;');
          console.log(`%c[DATA_COLLECTION] ${JSON.stringify({ hash: imgHash, action: 'NO_RECORD', offset: 0, original: rawBestAngle, final: angleToUse })}`, 'background: #f3f4f6; color: #4b5563; padding: 2px 4px; font-family: monospace;');
        }

        if (dataCollectEnabled && result.details) {
            console.log(
                `%c========== [DATA_COLLECTION] Scoreboard ==========\n` +
                `%c V1(极坐标): %c${result.details.v1?.angle ?? 'N/A'}° (分: ${result.details.v1?.score?.toFixed(4) ?? 'N/A'})\n` +
                `%c V2(方差): %c${result.details.v2?.angle ?? 'N/A'}° (分: ${result.details.v2?.score?.toFixed(4) ?? 'N/A'})\n` +
                `%c V3(色彩): %c${result.details.v3?.angle ?? 'N/A'}° (分: ${result.details.v3?.score?.toFixed(4) ?? 'N/A'})\n` +
                `%c🏆 最终决断 (聚类/优选): %c${angleToUse}° %c(原始: ${rawBestAngle}°, 偏移: ${appliedOffset >= 0 ? '+' : ''}${appliedOffset}°, 策略: ${result.metrics?.chosenAlgo || 'N/A'})`,
                'color: #d97706; font-weight: bold;',
                'color: #2563eb;', 'font-weight:bold;',
                'color: #059669;', 'font-weight:bold;',
                'color: #dc2626;', 'font-weight:bold;',
                'color: #9333ea; font-weight: bold;', 'color: #9333ea; font-weight: bold; font-size: 1.1em;', 'color: #6b7280;'
            );
        } else {
            console.log(
              `[CaptchaSolver] ✅ 旋转角度检测成功: %c${angleToUse}°%c (原始: ${rawBestAngle}°, 偏移: ${appliedOffset >= 0 ? '+' : ''}${appliedOffset}°), 置信度: %c${(result.confidence || 0).toFixed(3)}`,
              'color:#2563eb; font-weight:bold;', '',
              'color:#16a34a; font-weight:bold;'
            );
        }
      } else {
        const errMsg = (result && result.error) || '未知错误';
        console.warn(`[CaptchaSolver] ⚠️ 旋转角度检测失败 (${errMsg})，可能是图片仍在加载中或不支持。进入冷却等待...`);
        showNotice(btnEl, `⏳ 识别失败或加载中，等待重试...`, 2000);
        btnEl.dataset.rotationFailedTime = Date.now().toString();
        return; // 绝对不乱拖拽，直接中止本次循环，等待冷却
      }

      // 绑定唯一的 Session ID，隔离防竞态
      const currentSessionId = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      btnEl.dataset.solveSessionId = currentSessionId;

      // 计算滑块需要拖拽的距离
      const trackRect = trackEl.getBoundingClientRect();
      const btnRect = btnEl.getBoundingClientRect();
      
      // 提取滑块初始位置相对于轨道左侧的实际物理偏移 (考虑了 padding / border)
      const initialOffset = Math.max(0, btnRect.left - trackRect.left);
      
      // 优先排除左右对称的初始 padding / border 偏移量
      let dragRange = trackRect.width - btnRect.width - (initialOffset * 2);
      
      // 保底处理，避免某些奇葩排版下算出负数或过小
      if (dragRange < 50) {
         dragRange = trackEl.clientWidth - btnEl.offsetWidth;
      }
      if (dragRange < 50) {
         dragRange = trackRect.width - btnRect.width;
      }
      
      // 顺时针旋转所需角度 = (360 - angleToUse) % 360
      const rotateAngle = (360 - angleToUse) % 360;
      const dragDistance = Math.round((rotateAngle / 360) * dragRange);

      

      // 执行模拟拖拽
      const dragSuccess = await simulateSliderDrag(btnEl, trackEl, dragDistance);
      if (!dragSuccess) {
        throw new Error('拖拽被拦截');
      }

      btnEl.dataset.rotationSolved = 'true';
      showNotice(btnEl, `✅ 旋转验证码已完成 (${angleToUse}°)`, 2500);
      showTransientGlow(btnEl, '#10b981', 'rgba(16, 185, 129, 0.85)');

      // 埋个定时器检测是否真正成功。这是唯一可靠的一锤定音判断点。
      setTimeout(() => {
        // 校验 Session ID 防竞态错乱
        if (btnEl.dataset.solveSessionId !== currentSessionId) return;

        // 如果全局任务已经被 failsafe 提前清理/重置（说明在新验证码加载时已认定上一轮失败），则放弃 timer 处理
        if (!pendingRotationMemoryTask || pendingRotationMemoryTask.hash !== imgHash) {
          return;
        }

        // 如果 2.5 秒后元素依然存在且可见，说明没能把这个验证码消灭掉（服务器拦截了），说明失败了
        if (document.body.contains(btnEl) && isVisible(btnEl)) {
           console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] ❌【结果判定 - 验证失败】经过 2.5 秒观察，验证码依然存在，判定拖拽未通过服务器校验！(Hash: ${imgHash})`, 'color: #dc2626; font-size: 13px; font-weight: bold;');
           saveMemoryResult(imgHash, appliedOffset, false, memInfo.stateIndex, extraData);

           if (btnEl.dataset.pendingMetrics || pendingRotationMetrics) {
             try {
                 const m = pendingRotationMetrics || JSON.parse(btnEl.dataset.pendingMetrics);
                 m.outcome = 'FAIL';
                 console.log(`%c[DATA_COLLECTION] ${JSON.stringify(m)}`, 'background: #fee2e2; color: #991b1b; padding: 2px 4px; font-family: monospace;');
             } catch (e) {}
             btnEl.dataset.pendingMetrics = ''; // 防止重复打印
             pendingRotationMetrics = null;
           }
           btnEl.dataset.rotationSolved = 'false'; // 允许重新开始扫描
        } else {
           // 元素不见了，说明通关了！
           console.log(`%c[CaptchaSolver] [ADAPTIVE_MEMORY] 🎉【结果判定 - 验证成功】经过 2.5 秒观察，验证码 DOM 已消除，确认成功通过服务端校验！(Hash: ${imgHash})`, 'color: #16a34a; font-size: 13px; font-weight: bold;');
           saveMemoryResult(imgHash, appliedOffset, true, memInfo.stateIndex, extraData);

           if (btnEl.dataset.pendingMetrics || pendingRotationMetrics) {
             try {
                 const m = pendingRotationMetrics || JSON.parse(btnEl.dataset.pendingMetrics);
                 m.outcome = 'SUCCESS';
                 console.log(`%c[DATA_COLLECTION] ${JSON.stringify(m)}`, 'background: #dcfce7; color: #166534; padding: 2px 4px; font-family: monospace;');
             } catch (e) {}
             btnEl.dataset.pendingMetrics = '';
             pendingRotationMetrics = null;
           }
        }
        pendingRotationMemoryTask = null;
      }, 2500);

    } catch (err) {
      console.error('[CaptchaSolver] 旋转验证码处理失败:', err);
      showNotice(btnEl, `⚠️ ${err.message}`, 3000);
    } finally {
      isRotationProcessing = false;
    }
  }

  function findRotationElements() {
    // 优先使用用户自定义选择器
    const customOuter = querySafe(customRotationOuterSel);
    const customInner = querySafe(customRotationInnerSel);
    const customBtn = querySafe(customRotationBtnSel);

    let bestOuterEl = null, bestInnerEl = null, bestBtnEl = null, bestTrackEl = null;

    // 获取候选节点辅助函数
    const getCandidates = (customEl, selectors) => {
      if (customEl && isVisible(customEl)) return [customEl];
      let candidates = [];
      for (const sel of selectors) {
        try {
          const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
          if (els.length > 0) candidates.push(...els);
        } catch (e) {}
      }
      return candidates;
    };

    const outerCandidates = getCandidates(customOuter, ROTATION_SELECTORS.outerImage);
    const innerCandidates = getCandidates(customInner, ROTATION_SELECTORS.innerImage);
    const btnCandidates = getCandidates(customBtn, ROTATION_SELECTORS.sliderBtn);

    // 寻找合法组合：防止不同验证码实例的元素被错误拼凑（张冠李戴）
    let foundCombination = false;
    for (const outerEl of outerCandidates) {
      if (foundCombination) break;
      const outerRect = outerEl.getBoundingClientRect();
      
      for (const innerEl of innerCandidates) {
        if (foundCombination) break;
        const innerRect = innerEl.getBoundingClientRect();
        
        // 校验 1：内图的中心必须落在这个外图的矩形范围内
        const innerCX = innerRect.left + innerRect.width / 2;
        const innerCY = innerRect.top + innerRect.height / 2;
        const isContained = (
          innerCX >= outerRect.left && innerCX <= outerRect.right &&
          innerCY >= outerRect.top && innerCY <= outerRect.bottom
        );
        if (!isContained) continue;

        for (const btnEl of btnCandidates) {
          // 校验 2：拖动按钮应该跟外图属于同一个较近的容器上下文 (向上寻找最近 12 级)
          let commonAncestor = outerEl.parentElement;
          let sharedContext = false;
          let depth = 0;
          while (commonAncestor && commonAncestor !== document.body && depth < 12) {
            if (commonAncestor.contains(btnEl)) {
              sharedContext = true;
              break;
            }
            commonAncestor = commonAncestor.parentElement;
            depth++;
          }
          
          // 若通过了容器约束（或者页面上只有唯一的一个按钮候选）
          if (sharedContext || btnCandidates.length === 1) {
            // 原有的置信度及大小过滤
            if ((innerRect.width >= 20 && innerRect.height >= 20 && outerRect.width >= 100) || isElementCircular(innerEl)) {
              bestOuterEl = outerEl;
              bestInnerEl = innerEl;
              bestBtnEl = btnEl;
              
              // 寻找轨道
              for (const sel of ROTATION_SELECTORS.track) {
                try {
                  const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
                  // 轨道也必须在共同容器内
                  const validTrack = els.find(t => !commonAncestor || commonAncestor.contains(t) || t.contains(bestBtnEl));
                  if (validTrack) { bestTrackEl = validTrack; break; }
                } catch(e) {}
              }
              if (!bestTrackEl) bestTrackEl = bestBtnEl.parentElement;
              
              foundCombination = true;
              break;
            }
          }
        }
      }
    }

    if (foundCombination && bestOuterEl && bestInnerEl && bestBtnEl && bestTrackEl) {
      return { outerEl: bestOuterEl, innerEl: bestInnerEl, btnEl: bestBtnEl, trackEl: bestTrackEl };
    }

    // ==================== 智能语义/结构退化探测 ====================
    // 当静态选择器未精准匹配时，扫描包含验证码/弹窗的容器
    const containers = document.querySelectorAll(
      '[class*="captcha"], [class*="verify"], [class*="modal"], [class*="popup"], [class*="dialog"], [class*="sec"], [id*="captcha"], [id*="verify"], .van-popup, .geetest_box'
    );

    for (const container of containers) {
      if (!isVisible(container)) continue;

      // 寻找大图片或 Canvas，包括 taro-image-core
      const imgs = Array.from(container.querySelectorAll('img, canvas, taro-image-core, div[style*="background"]')).filter(isVisible);
      if (imgs.length < 2) continue;

      let foundOuter = null;
      let foundInner = null;

      // 寻找包含圆形特征的子元素作为 innerEl
      for (const img of imgs) {
        if (isElementCircular(img)) {
          foundInner = img;
          break;
        }
      }

      // 如果找到圆形子图，则在剩余元素中找尺寸最大的作为背景 outerEl
      if (foundInner) {
        for (const img of imgs) {
          if (img !== foundInner && isCaptchaValid(img)) {
            if (!foundOuter || (img.offsetWidth * img.offsetHeight > foundOuter.offsetWidth * foundOuter.offsetHeight)) {
              foundOuter = img;
            }
          }
        }
      }

      // 寻找拖拽按钮
      let foundBtn = container.querySelector('[class*="btn"], [class*="drag"], [class*="handle"], [class*="slider"], [class*="control"]');
      if (foundBtn && !isVisible(foundBtn)) foundBtn = null;

      if (foundOuter && foundInner && foundBtn) {
        let foundTrack = container.querySelector('[class*="track"], [class*="bar"], [class*="slider"]');
        if (!foundTrack || !isVisible(foundTrack)) foundTrack = foundBtn.parentElement;
        return { outerEl: foundOuter, innerEl: foundInner, btnEl: foundBtn, trackEl: foundTrack };
      }
    }

    // ==================== 终极物理特征全图探测（无视DOM类名和结构） ====================
    const possibleBgElements = Array.from(document.querySelectorAll('img, canvas, taro-image-core, div')).filter(el => {
      if (!isVisible(el)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 150 && rect.width <= 400 && rect.height >= 150 && rect.height <= 400;
    }).filter(el => el.tagName === 'IMG' || el.tagName === 'CANVAS' || el.tagName === 'TARO-IMAGE-CORE' || (el.style && el.style.backgroundImage && el.style.backgroundImage !== 'none'));

    for (const bg of possibleBgElements) {
      const bgRect = bg.getBoundingClientRect();
      
      const possibleInners = Array.from(document.querySelectorAll('img, canvas, div')).filter(el => {
        if (el === bg || !isVisible(el)) return false;
        const rect = el.getBoundingClientRect();
        const isInside = (rect.left >= bgRect.left - 20) && (rect.right <= bgRect.right + 20) && (rect.top >= bgRect.top - 20) && (rect.bottom <= bgRect.bottom + 20);
        return isInside && isElementCircular(el);
      }).filter(el => el.tagName === 'IMG' || el.tagName === 'CANVAS' || (el.style && el.style.backgroundImage && el.style.backgroundImage !== 'none'));

      if (possibleInners.length > 0) {
        const inner = possibleInners[0];
        
        const possibleBtns = Array.from(document.querySelectorAll('*')).filter(el => {
          if (!isVisible(el) || el.tagName === 'IMG' || el.tagName === 'CANVAS') return false;
          const rect = el.getBoundingClientRect();
          return rect.top >= bgRect.bottom - 20 && rect.top <= bgRect.bottom + 150 && rect.height >= 20 && rect.height <= 70 && rect.width >= 20 && rect.width <= 80;
        });
        
        let btn = possibleBtns.find(el => {
          const style = window.getComputedStyle(el);
          return style.cursor === 'pointer' || el.className.includes('btn') || el.className.includes('drag') || el.className.includes('slider');
        }) || possibleBtns[0];

        if (btn) {
          
          return { outerEl: bg, innerEl: inner, btnEl: btn, trackEl: btn.parentElement };
        }
      }
    }

    return null;
  }

  async function getElementImage(el) {
    if (el.tagName === 'CANVAS') {
      try {
        return { base64: el.toDataURL('image/png'), width: el.width, height: el.height };
      } catch {
        return null;
      }
    }
    
    // 如果元素是一个包含 img 或 taro-image-core 的容器，向下寻找
    if (el.tagName !== 'IMG' && el.tagName !== 'TARO-IMAGE-CORE' && !(window.getComputedStyle(el).backgroundImage && window.getComputedStyle(el).backgroundImage !== 'none')) {
      const childImg = el.querySelector('img, taro-image-core');
      if (childImg) el = childImg;
    }

    // 提取图片 URL (img.src 或 attr(src) 或 div.style.backgroundImage)
    let imgSrc = el.src || el.getAttribute('src');
    if (!imgSrc && el.tagName !== 'IMG' && el.tagName !== 'TARO-IMAGE-CORE') {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        const match = bg.match(/^url\((['"]?)(.*)\1\)$/);
        if (match) imgSrc = match[2];
      }
    }

    if (!imgSrc) return null;

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        resolve({ base64: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        // 前端 CORS 受阻：请求 Background 借由 Extension 权限进行跨域 Fetch
        chrome.runtime.sendMessage({ type: 'fetch-image', url: imgSrc }).then(res => {
          if (res && res.success && res.base64) {
            const fallbackImg = new Image();
            fallbackImg.onload = () => {
              resolve({ base64: res.base64, width: fallbackImg.naturalWidth, height: fallbackImg.naturalHeight });
            };
            fallbackImg.onerror = () => resolve(null);
            fallbackImg.src = res.base64;
          } else {
            resolve(null);
          }
        }).catch(() => resolve(null));
      };
      img.src = imgSrc;
    });
  }

  function generateHumanTrack(distance) {
    const points = [];
    const totalDuration = 800 + Math.random() * 700; // 800~1500ms
    const steps = 40 + Math.floor(Math.random() * 30); // 40~70步

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      
      // 更复杂的非线性缓动：人类通常是前期快速拉动，中后期开始试探性微调对准
      let easedT;
      if (t < 0.6) {
        // 加速和快速滑动
        easedT = 1 - Math.pow(1 - (t / 0.6), 3);
        easedT *= 0.85; // 60% 的时间走到 85% 的距离
      } else {
        // 慢速试探和微调
        const rem = (t - 0.6) / 0.4;
        easedT = 0.85 + 0.15 * Math.sin(rem * Math.PI / 2);
      }

      const x = Math.round(distance * easedT);
      // Y轴使用更平滑的随机漫步，而不是每步都跳动
      const prevY = i > 0 ? points[i - 1].y : 0;
      const y = Math.round(prevY + (Math.random() - 0.5) * 2); 
      const time = Math.round(totalDuration * t);
      points.push({ x, y, time });
    }

    // 终点处的微调、回退和停留
    const overshoot = Math.floor(Math.random() * 4); 
    const lastTime = points[points.length - 1].time;
    if (overshoot > 0) {
      points.push({ x: distance + overshoot, y: points[points.length - 1].y, time: lastTime + 100 });
      points.push({ x: distance + Math.floor(overshoot / 2), y: 0, time: lastTime + 200 });
    }
    // 释放前的停顿（人类对准后通常会停顿一下再松手）
    points.push({ x: distance, y: 0, time: lastTime + 300 + Math.random() * 200 });

    return points;
  }

  async function simulateSliderDrag(btnEl, trackEl, distance) {
    const btnRect = btnEl.getBoundingClientRect();
    const startX = Math.round(btnRect.left + btnRect.width / 2);
    const startY = Math.round(btnRect.top + btnRect.height / 2);

    const track = generateHumanTrack(distance);

    const createPointerEvent = (type, x, y, buttons = 1) => {
      try {
        return new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          clientX: x, clientY: y, screenX: x, screenY: y,
          button: type.endsWith('up') ? 0 : (buttons > 0 ? 0 : -1),
          buttons: buttons,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          pressure: type.endsWith('up') ? 0 : 0.5
        });
      } catch (e) { return null; }
    };

    const createMouseEvent = (type, x, y, buttons = 1) => {
      return new MouseEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        clientX: x, clientY: y, screenX: x, screenY: y,
        button: type.endsWith('up') ? 0 : (buttons > 0 ? 0 : -1),
        buttons: buttons
      });
    };

    const createTouchEvent = (type, target, x, y) => {
      try {
        const touch = new Touch({
          identifier: 1, target: target,
          clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y,
          radiusX: 11.5, radiusY: 11.5, rotationAngle: 0, force: 1
        });
        return new TouchEvent(type, {
          cancelable: true, bubbles: true, composed: true,
          touches: type === 'touchend' ? [] : [touch],
          targetTouches: type === 'touchend' ? [] : [touch],
          changedTouches: [touch]
        });
      } catch (e) { return null; }
    };

    const dispatchAll = (typePrefix, target, x, y, buttons) => {
      const pe = createPointerEvent(`pointer${typePrefix}`, x, y, buttons);
      if (pe) target.dispatchEvent(pe);
      
      const touchType = typePrefix === 'down' ? 'touchstart' : typePrefix === 'up' ? 'touchend' : 'touchmove';
      const te = createTouchEvent(touchType, btnEl, x, y);
      if (te) target.dispatchEvent(te);
      
      const me = createMouseEvent(`mouse${typePrefix}`, x, y, buttons);
      target.dispatchEvent(me);
    };

    // --- Down ---
    dispatchAll('down', btnEl, startX, startY, 1);

    let prevTime = 0;
    let maxOffset = 0;
    
    // --- Move ---
    for (const point of track) {
      const delay = point.time - prevTime;
      if (delay > 0) await sleep(delay);
      prevTime = point.time;

      const moveX = startX + point.x;
      const moveY = startY + point.y;

      // 分发给按钮和 Document，确保绑定在全局的事件能收到
      dispatchAll('move', btnEl, moveX, moveY, 1);
      dispatchAll('move', document, moveX, moveY, 1);
      
      const currentLeft = Math.round(btnEl.getBoundingClientRect().left + btnRect.width / 2);
      maxOffset = Math.max(maxOffset, Math.abs(currentLeft - startX));
    }

    // --- Up ---
    const endX = startX + distance;
    await sleep(150); // 解决“即将到达目标角度的抽动”导致提前触发验证的问题
    dispatchAll('up', btnEl, endX, startY, 0);
    dispatchAll('up', document, endX, startY, 0);
    
    return maxOffset >= 5;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getCleanUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      const cleanHash = u.hash ? u.hash.split('?')[0] : '';
      return u.origin + u.pathname + cleanHash;
    } catch (e) {
      return rawUrl.split('?')[0];
    }
  }

  // 确保在所有变量声明后执行
  if (chrome.storage?.sync) {
    chrome.storage.sync.get(['domainWhitelist'], (res) => {
      const whitelist = res.domainWhitelist || [];
      const currentDomain = getCleanUrl(window.location.href);
      
      // 只有当前页面全路径在白名单中时，才初始化扩展
      if (whitelist.length > 0 && whitelist.includes(currentDomain)) {
        init();
      } else {
        console.log(`[CaptchaSolver] 当前页面 ${currentDomain} 不在白名单中，自动识别已禁用。`);
      }
    });
  } else {
    // 兼容可能没有 storage 的环境，保守处理不启动，或者默认启动（这里选择不启动，因为用户要求列表为空不运行）
    console.warn('[CaptchaSolver] 无法访问 chrome.storage API');
  }
})();
