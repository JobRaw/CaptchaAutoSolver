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

  // 一键添加域名逻辑
  const addDomainBtn = document.getElementById('addDomainBtn');
  const currentDomainText = document.getElementById('currentDomainText');
  const domainBadge = document.getElementById('domainBadge');
  let currentDomain = '';

  function getCleanUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      const cleanHash = u.hash ? u.hash.split('?')[0] : '';
      return u.origin + u.pathname + cleanHash;
    } catch (e) {
      return '';
    }
  }

  if (chrome.tabs && addDomainBtn && currentDomainText) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0 && tabs[0].url) {
        try {
          currentDomain = getCleanUrl(tabs[0].url);
          if (!currentDomain) throw new Error('No valid URL');
          
          currentDomainText.innerText = currentDomain;
          currentDomainText.title = currentDomain;

          if (chrome.storage?.sync) {
            chrome.storage.sync.get(['domainWhitelist'], (res) => {
              const whitelist = res.domainWhitelist || [];
              if (whitelist.includes(currentDomain)) {
                if (domainBadge) {
                  domainBadge.innerText = '已在白名单';
                  domainBadge.className = 'domain-badge badge-success';
                }
                addDomainBtn.innerText = '✅ 已在白名单';
                addDomainBtn.disabled = true;
              } else {
                if (domainBadge) {
                  domainBadge.innerText = '未加入';
                  domainBadge.className = 'domain-badge badge-warning';
                }
                addDomainBtn.innerText = '➕ 添加当前页面至白名单';
                addDomainBtn.disabled = false;
              }
            });
          }
        } catch (e) {
          currentDomainText.innerText = '无法获取当前页面地址';
          if (domainBadge) {
            domainBadge.innerText = '获取失败';
            domainBadge.className = 'domain-badge badge-gray';
          }
          addDomainBtn.style.display = 'none';
        }
      } else {
        currentDomainText.innerText = '系统/特殊页面不支持识别';
        if (domainBadge) {
          domainBadge.innerText = '无法访问';
          domainBadge.className = 'domain-badge badge-gray';
        }
        addDomainBtn.style.display = 'none';
      }
    });

    addDomainBtn.addEventListener('click', () => {
      if (!currentDomain || addDomainBtn.disabled) return;
      if (chrome.storage?.sync) {
        chrome.storage.sync.get(['domainWhitelist'], (res) => {
          let whitelist = res.domainWhitelist || [];
          if (!whitelist.includes(currentDomain)) {
            whitelist.push(currentDomain);
            chrome.storage.sync.set({ domainWhitelist: whitelist }, () => {
              if (chrome.runtime.lastError) {
                if (domainBadge) {
                  domainBadge.innerText = '添加失败';
                  domainBadge.className = 'domain-badge badge-warning';
                }
                return;
              }
              if (domainBadge) {
                domainBadge.innerText = '已在白名单';
                domainBadge.className = 'domain-badge badge-success';
              }
              addDomainBtn.innerText = '✅ 已成功添加';
              addDomainBtn.disabled = true;
            });
          }
        });
      }
    });
  }
});
