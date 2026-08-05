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
      }
    });
  });

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
      const saveActionBtn = document.createElement('button');
      saveActionBtn.className = 'action-btn';
      saveActionBtn.textContent = '保存修改';
      saveActionBtn.onclick = () => {
        saveSingleMemory(key, parseInt(offsetInput.value, 10));
      };
      tdAction.appendChild(saveActionBtn);
      tr.appendChild(tdAction);

      tbody.appendChild(tr);
    });
  }

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
      bestOffset: offsetValue,
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
