document.addEventListener('DOMContentLoaded', () => {
  const customImgSelector = document.getElementById('customImgSelector');
  const customInputSelector = document.getElementById('customInputSelector');
  const customSliderBgSelector = document.getElementById('customSliderBgSelector');
  const customSliderBtnSelector = document.getElementById('customSliderBtnSelector');
  const customRotationOuterSelector = document.getElementById('customRotationOuterSelector');
  const customRotationInnerSelector = document.getElementById('customRotationInnerSelector');
  const customRotationBtnSelector = document.getElementById('customRotationBtnSelector');
  
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const toast = document.getElementById('toast');

  const ALL_KEYS = [
    'customImgSelector',
    'customInputSelector',
    'customSliderBgSelector',
    'customSliderBtnSelector',
    'customRotationOuterSelector',
    'customRotationInnerSelector',
    'customRotationBtnSelector'
  ];

  // 加载已有配置
  if (chrome.storage?.sync) {
    chrome.storage.sync.get(ALL_KEYS, (res) => {
      if (res?.customImgSelector) customImgSelector.value = res.customImgSelector;
      if (res?.customInputSelector) customInputSelector.value = res.customInputSelector;
      if (res?.customSliderBgSelector) customSliderBgSelector.value = res.customSliderBgSelector;
      if (res?.customSliderBtnSelector) customSliderBtnSelector.value = res.customSliderBtnSelector;
      if (res?.customRotationOuterSelector) customRotationOuterSelector.value = res.customRotationOuterSelector;
      if (res?.customRotationInnerSelector) customRotationInnerSelector.value = res.customRotationInnerSelector;
      if (res?.customRotationBtnSelector) customRotationBtnSelector.value = res.customRotationBtnSelector;
    });
  }

  // 保存配置
  saveBtn.addEventListener('click', () => {
    const config = {
      customImgSelector: customImgSelector.value.trim(),
      customInputSelector: customInputSelector.value.trim(),
      customSliderBgSelector: customSliderBgSelector.value.trim(),
      customSliderBtnSelector: customSliderBtnSelector.value.trim(),
      customRotationOuterSelector: customRotationOuterSelector.value.trim(),
      customRotationInnerSelector: customRotationInnerSelector.value.trim(),
      customRotationBtnSelector: customRotationBtnSelector.value.trim()
    };

    if (chrome.storage?.sync) {
      chrome.storage.sync.set(config, () => {
        showToast('✅ 保存成功！已同步应用');
      });
    } else {
      showToast('✅ 保存成功！');
    }
  });

  // 恢复默认配置
  resetBtn.addEventListener('click', () => {
    customImgSelector.value = '';
    customInputSelector.value = '';
    customSliderBgSelector.value = '';
    customSliderBtnSelector.value = '';
    customRotationOuterSelector.value = '';
    customRotationInnerSelector.value = '';
    customRotationBtnSelector.value = '';

    const emptyConfig = ALL_KEYS.reduce((acc, key) => ({ ...acc, [key]: '' }), {});
    if (chrome.storage?.sync) {
      chrome.storage.sync.set(emptyConfig, () => {
        showToast('🔄 已恢复默认配置');
      });
    } else {
      showToast('🔄 已恢复默认配置');
    }
  });

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

  // Tab 切换逻辑
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.target).classList.add('active');
      
      // 如果切换到记忆管理，则加载数据
      if (tab.dataset.target === 'memoryPanel') {
        loadMemoryData();
      } else if (tab.dataset.target === 'whitelistPanel') {
        loadWhitelistData();
      }
    });
  });

  // ==================== 域名白名单管理逻辑 ====================
  const newDomainInput = document.getElementById('newDomainInput');
  const addWhitelistBtn = document.getElementById('addWhitelistBtn');
  const whitelistTableBody = document.getElementById('whitelistTableBody');
  const whitelistEmptyState = document.getElementById('whitelistEmptyState');

  function loadWhitelistData() {
    if (!chrome.storage?.sync) return;
    chrome.storage.sync.get(['domainWhitelist'], (res) => {
      const whitelist = res.domainWhitelist || [];
      renderWhitelistTable(whitelist);
    });
  }

  function renderWhitelistTable(whitelist) {
    whitelistTableBody.innerHTML = '';
    
    if (whitelist.length === 0) {
      whitelistTableBody.parentElement.style.display = 'none';
      whitelistEmptyState.style.display = 'block';
      return;
    }

    whitelistTableBody.parentElement.style.display = 'table';
    whitelistEmptyState.style.display = 'none';

    whitelist.forEach((domain, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family: monospace; font-size: 14px; color: #e2e8f0;">${domain}</td>
        <td>
          <button class="btn delete-btn" data-index="${index}" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 4px 8px; font-size: 12px; cursor: pointer; border-radius: 4px;">删除</button>
        </td>
      `;
      whitelistTableBody.appendChild(tr);
    });

    // 绑定删除事件
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        whitelist.splice(idx, 1);
        chrome.storage.sync.set({ domainWhitelist: whitelist }, () => {
          showToast('✅ 域名已移除');
          renderWhitelistTable(whitelist);
        });
      });
    });
  }

  if (addWhitelistBtn && newDomainInput) {
    addWhitelistBtn.addEventListener('click', () => {
      let domain = newDomainInput.value.trim();
      if (!domain) {
        showToast('⚠️ 请输入域名');
        return;
      }
      
      // 去除 http/https 前缀
      domain = domain.replace(/^https?:\/\//i, '');
      // 去除路径和参数
      domain = domain.split('/')[0];

      chrome.storage.sync.get(['domainWhitelist'], (res) => {
        const whitelist = res.domainWhitelist || [];
        if (whitelist.includes(domain)) {
          showToast('⚠️ 域名已存在白名单中');
          return;
        }
        whitelist.push(domain);
        chrome.storage.sync.set({ domainWhitelist: whitelist }, () => {
          showToast('✅ 域名添加成功');
          newDomainInput.value = '';
          renderWhitelistTable(whitelist);
        });
      });
    });
  }

  // 如果 URL hash 指定了记忆面板，自动切换过去
  if (window.location.hash === '#memory') {
    const memTab = document.querySelector('.tab[data-target="memoryPanel"]');
    if (memTab) memTab.click();
  }

  // 记忆库管理逻辑
  let memoryData = {};
  const tbody = document.getElementById('memoryTableBody');
  const emptyState = document.getElementById('memoryEmptyState');
  const searchInput = document.getElementById('memorySearchInput');

  const OFFSET_EXPLORE_SEQUENCE = [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15, 18, -18, 21, -21];

  function loadMemoryData() {
    if (!chrome.storage?.local) return;
    chrome.storage.local.get('rotationMemory', (res) => {
      memoryData = res.rotationMemory || {};
      renderMemoryTable();
    });
  }

  function renderMemoryTable(filter = '') {
    tbody.innerHTML = '';
    const keys = Object.keys(memoryData);
    
    // 过滤
    const filteredKeys = keys.filter(k => k.toLowerCase().includes(filter.toLowerCase()));
    
    if (filteredKeys.length === 0) {
      emptyState.style.display = 'block';
      tbody.parentElement.style.display = 'none';
      return;
    }
    
    emptyState.style.display = 'none';
    tbody.parentElement.style.display = 'table';

    // 按时间倒序
    filteredKeys.sort((a, b) => (memoryData[b].time || 0) - (memoryData[a].time || 0));

    filteredKeys.forEach(key => {
      const item = memoryData[key];
      const isLearned = typeof item.bestOffset === 'number';
      
      const tr = document.createElement('tr');
      
      // Key
      const tdKey = document.createElement('td');
      tdKey.style.fontFamily = 'monospace';
      tdKey.textContent = key;
      tr.appendChild(tdKey);

      // Status
      const tdStatus = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `status-badge ${isLearned ? 'status-learned' : 'status-exploring'}`;
      badge.textContent = isLearned ? '已学习 (LEARNED)' : `试探中 (第 ${item.stateIndex || 0} 次)`;
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      // Offset (Input)
      const tdOffset = document.createElement('td');
      const offsetInput = document.createElement('input');
      offsetInput.type = 'number';
      offsetInput.className = 'edit-input';
      
      let displayOffset = 0;
      if (isLearned) {
        displayOffset = item.bestOffset;
      } else {
        const idx = item.stateIndex || 0;
        displayOffset = OFFSET_EXPLORE_SEQUENCE[idx] || 0;
      }
      offsetInput.value = displayOffset;
      
      tdOffset.appendChild(offsetInput);
      tr.appendChild(tdOffset);

      // Time
      const tdTime = document.createElement('td');
      const d = new Date(item.time || Date.now());
      tdTime.textContent = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
      tr.appendChild(tdTime);

      // Action
      const tdAction = document.createElement('td');
      
      const calibrateBtn = document.createElement('button');
      calibrateBtn.className = 'calibrate-btn';
      calibrateBtn.textContent = '🎨 可视化校准';
      calibrateBtn.onclick = () => {
        openCalibrationModal(key, item);
      };

      const saveActionBtn = document.createElement('button');
      saveActionBtn.className = 'action-btn';
      saveActionBtn.textContent = '保存修改';
      saveActionBtn.onclick = () => {
        saveSingleMemory(key, parseInt(offsetInput.value, 10));
      };

      tdAction.appendChild(calibrateBtn);
      tdAction.appendChild(saveActionBtn);
      tr.appendChild(tdAction);

      tbody.appendChild(tr);
    });
  }

  // ==================== 可视化旋转校准 Modal 交互逻辑 ====================
  let currentCalibrateKey = null;
  let currentRawAngle = 0;
  let currentTargetAngle = 0;
  let isDifferenceMode = false;
  let isDraggingInnerImg = false;
  let dragCenterX = 0;
  let dragCenterY = 0;
  let dragStartMouseAngle = 0;
  let dragStartTargetAngle = 0;

  const modal = document.getElementById('calibrationModal');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  const modalSaveBtn = document.getElementById('modalSaveBtn');
  const modalOuterImg = document.getElementById('modalOuterImg');
  const modalInnerImg = document.getElementById('modalInnerImg');
  const rotationSlider = document.getElementById('rotationSlider');
  const currentAngleText = document.getElementById('currentAngleText');
  const rawAngleText = document.getElementById('rawAngleText');
  const targetAngleText = document.getElementById('targetAngleText');
  const calculatedOffsetText = document.getElementById('calculatedOffsetText');
  const toggleBlendBtn = document.getElementById('toggleBlendBtn');
  const resetAngleBtn = document.getElementById('resetAngleBtn');

  function openCalibrationModal(key, item) {
    if (!item.outerImage || !item.innerImage) {
      alert('⚠️ 该历史记录暂无图像缓存（可能是功能上线前生成的记录），无法开启可视化校准。您可以在表格中直接修改数字偏移量。');
      return;
    }

    currentCalibrateKey = key;
    currentRawAngle = typeof item.rawBestAngle === 'number' ? item.rawBestAngle : 0;
    
    // 默认初始目标角度 = 算法原始角度 + 当前偏移量
    let initOffset = 0;
    if (typeof item.bestOffset === 'number') {
      initOffset = item.bestOffset;
    } else {
      const idx = item.stateIndex || 0;
      initOffset = OFFSET_EXPLORE_SEQUENCE[idx] || 0;
    }
    currentTargetAngle = (currentRawAngle + initOffset + 360) % 360;

    modalOuterImg.src = item.outerImage;
    modalInnerImg.src = item.innerImage;

    // 按照 cxRatio / cyRatio 以及 radiusRatio 动态定位及缩放中心图
    const updateLayout = () => {
      const w = modalOuterImg.clientWidth || 260;
      const h = modalOuterImg.clientHeight || 130;
      const cx = w * (item.cxRatio || 0.5);
      const cy = h * (item.cyRatio || 0.5);
      
      // 统一固定校准中心圈比例为 0.25
      const UNIFORM_RADIUS_RATIO = 0.25;
      const innerW = w * UNIFORM_RADIUS_RATIO;
      modalInnerImg.style.width = innerW + 'px';
      modalInnerImg.style.height = innerW + 'px';
      modalInnerImg.style.left = (cx - innerW / 2) + 'px';
      modalInnerImg.style.top = (cy - innerW / 2 + 1) + 'px';
    };

    if (modalOuterImg.complete && modalOuterImg.naturalWidth !== 0) {
      updateLayout();
    } else {
      modalOuterImg.onload = updateLayout;
    }

    updateCalibrationUI();
    modal.style.display = 'flex';
  }

  function updateCalibrationUI() {
    currentTargetAngle = (Math.round(currentTargetAngle) + 360) % 360;
    
    // 界面统一使用真实的网页拖拽(顺时针)角度，消除与用户直觉的认知冲突
    const displayTargetAngle = (360 - currentTargetAngle) % 360;
    const displayRawAngle = (360 - currentRawAngle) % 360;
    
    rotationSlider.value = displayTargetAngle;
    modalInnerImg.style.transform = `rotate(${displayTargetAngle}deg)`;
    
    currentAngleText.textContent = `${displayTargetAngle}° (顺时针拖拽角度)`;
    rawAngleText.textContent = `${displayRawAngle}°`;
    targetAngleText.textContent = `${displayTargetAngle}°`;
    
    const calculatedOffset = (currentTargetAngle - currentRawAngle + 540) % 360 - 180;
    const displayOffset = (displayTargetAngle - displayRawAngle + 540) % 360 - 180;
    
    calculatedOffsetText.textContent = `${displayOffset >= 0 ? '+' : ''}${displayOffset}° (底层写入 ${calculatedOffset >= 0 ? '+' : ''}${calculatedOffset}°)`;
  }

  // 极坐标拖拽逻辑 (记录 mousedown 时的中心点，避免 mousemove 过程中因为旋转包围盒变化导致中心抖动)
  modalInnerImg.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDraggingInnerImg = true;
    const rect = modalInnerImg.getBoundingClientRect();
    dragCenterX = rect.left + rect.width / 2;
    dragCenterY = rect.top + rect.height / 2;
    dragStartMouseAngle = Math.atan2(e.clientY - dragCenterY, e.clientX - dragCenterX) * (180 / Math.PI);
    dragStartTargetAngle = currentTargetAngle;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingInnerImg) return;
    const currentMouseAngle = Math.atan2(e.clientY - dragCenterY, e.clientX - dragCenterX) * (180 / Math.PI);
    let delta = currentMouseAngle - dragStartMouseAngle;
    // 鼠标顺时针(正delta) -> 顺时针旋转角度增加 -> 相当于逆时针(底层)角度减少
    currentTargetAngle = (dragStartTargetAngle - delta + 360) % 360;
    updateCalibrationUI();
  });

  window.addEventListener('mouseup', () => {
    isDraggingInnerImg = false;
  });

  // 滑块与微调
  rotationSlider.addEventListener('input', (e) => {
    const displayAngle = parseFloat(e.target.value);
    // 从展示的顺时针角度转换回底层的特征角度
    currentTargetAngle = (360 - displayAngle) % 360;
    updateCalibrationUI();
  });

  // 键盘微调 (← / →)
  window.addEventListener('keydown', (e) => {
    if (modal.style.display !== 'flex') return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      // 左键：希望展示的角度(顺时针)减少，也就是逆时针角度增大
      currentTargetAngle = (currentTargetAngle + step + 360) % 360;
      updateCalibrationUI();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      // 右键：希望展示的角度(顺时针)增加，也就是逆时针角度减少
      currentTargetAngle = (currentTargetAngle - step + 360) % 360;
      updateCalibrationUI();
    }
  });

  // 差值对比模式切换
  toggleBlendBtn.addEventListener('click', () => {
    isDifferenceMode = !isDifferenceMode;
    if (isDifferenceMode) {
      modalInnerImg.classList.add('difference-mode');
      toggleBlendBtn.textContent = '🌓 差值对比模式: 开';
    } else {
      modalInnerImg.classList.remove('difference-mode');
      toggleBlendBtn.textContent = '🌓 差值对比模式: 关';
    }
  });

  // 重置角度
  resetAngleBtn.addEventListener('click', () => {
    currentTargetAngle = currentRawAngle;
    updateCalibrationUI();
  });

  // 关闭与取消
  function closeModal() {
    modal.style.display = 'none';
    currentCalibrateKey = null;
    isDraggingInnerImg = false;
    if (isDifferenceMode) {
      toggleBlendBtn.click();
    }
  }
  modalCloseBtn.addEventListener('click', closeModal);
  modalCancelBtn.addEventListener('click', closeModal);

  // 确认保存
  modalSaveBtn.addEventListener('click', () => {
    if (!currentCalibrateKey) return;
    const calculatedOffset = (currentTargetAngle - currentRawAngle + 540) % 360 - 180;
    
    if (!memoryData[currentCalibrateKey]) {
      memoryData[currentCalibrateKey] = {};
    }
    memoryData[currentCalibrateKey].bestOffset = calculatedOffset;
    memoryData[currentCalibrateKey].manual = true;
    memoryData[currentCalibrateKey].time = Date.now();

    if (chrome.storage?.local) {
      chrome.storage.local.set({ rotationMemory: memoryData }, () => {
        renderMemoryTable(searchInput.value);
        showToast(`✅ 人工校准完成！已保存 ${currentCalibrateKey} 偏移量为 ${calculatedOffset >= 0 ? '+' : ''}${calculatedOffset}°`);
        closeModal();
      });
    }
  });

  searchInput.addEventListener('input', (e) => {
    renderMemoryTable(e.target.value);
  });

  function saveSingleMemory(key, offsetValue) {
    if (isNaN(offsetValue)) {
      alert("请输入有效的数字偏移量");
      return;
    }
    
    // 更新内存中的对象，强制转换为已学习状态
    memoryData[key] = {
      ...memoryData[key],
      bestOffset: offsetValue,
      manual: true,
      time: Date.now()
    };
    
    // 写回 Storage
    if (chrome.storage?.local) {
      chrome.storage.local.set({ rotationMemory: memoryData }, () => {
        renderMemoryTable(searchInput.value);
        showToast(`已成功将 ${key} 的偏移坐标保存为 ${offsetValue}°`);
      });
    }
  }

  // 刷新按钮逻辑
  const refreshBtn = document.getElementById('refreshMemoryBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadMemoryData();
      showToast('🔄 已刷新记忆数据');
    });
  }

  // 一键清空
  const clearAllBtn = document.getElementById('clearAllMemoryBtn');
  clearAllBtn.addEventListener('click', () => {
    if (confirm('确定要清空所有的图像记忆吗？清空后插件需要重新进行自适应试探学习。')) {
      if (chrome.storage?.local) {
        chrome.storage.local.remove('rotationMemory', () => {
          memoryData = {};
          renderMemoryTable(searchInput.value);
          showToast('✅ 图像记忆库已清空');
        });
      }
    }
  });

});
