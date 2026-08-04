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
});
