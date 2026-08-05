document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggleEnabled');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const openOptions = document.getElementById('openOptions');
  const toggleV1 = document.getElementById('toggleV1');
  const toggleV2 = document.getElementById('toggleV2');
  const toggleV3 = document.getElementById('toggleV3');
  const toggleCollect = document.getElementById('toggleCollect');

  // 读取配置
  if (chrome.storage?.sync) {
    chrome.storage.sync.get(['enabled', 'algoV1', 'algoV2', 'algoV3', 'dataCollect'], (res) => {
      const isEnabled = res?.enabled !== false;
      toggleEnabled.checked = isEnabled;
      toggleV1.checked = res?.algoV1 !== false;
      toggleV2.checked = res?.algoV2 !== false;
      toggleV3.checked = res?.algoV3 !== false;
      toggleCollect.checked = res?.dataCollect !== false;
      updateUI(isEnabled);
    });
  }

  // 状态开关变动
  toggleEnabled.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    updateUI(isEnabled);
    if (chrome.storage?.sync) {
      chrome.storage.sync.set({ enabled: isEnabled });
    }
  });


  [toggleV1, toggleV2, toggleV3, toggleCollect].forEach(el => {
    if (el) {
      el.addEventListener('change', () => {
        if (chrome.storage?.sync) {
          chrome.storage.sync.set({
            algoV1: toggleV1.checked,
            algoV2: toggleV2.checked,
            algoV3: toggleV3.checked,
            dataCollect: toggleCollect.checked
          });
        }
      });
    }
  });

  // 打开记忆管理页
  const openMemoryBtn = document.getElementById('openMemoryBtn');
  if (openMemoryBtn) {
    openMemoryBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#memory') });
    });
  }

  // 打开设置页
  openOptions.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });

  function updateUI(isEnabled) {
    if (isEnabled) {
      statusDot.classList.add('active');
      statusText.innerText = "自动识别服务工作正常";
    } else {
      statusDot.classList.remove('active');
      statusText.innerText = "自动识别助手已暂停";
    }
  }
});
