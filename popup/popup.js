document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggleEnabled');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const openOptions = document.getElementById('openOptions');

  // 读取配置
  if (chrome.storage?.sync) {
    chrome.storage.sync.get(['enabled'], (res) => {
      const isEnabled = res?.enabled !== false;
      toggleEnabled.checked = isEnabled;
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
