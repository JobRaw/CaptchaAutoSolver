document.addEventListener('DOMContentLoaded', () => {
  const customImgSelector = document.getElementById('customImgSelector');
  const customInputSelector = document.getElementById('customInputSelector');
  const saveBtn = document.getElementById('saveBtn');
  const toast = document.getElementById('toast');

  if (chrome.storage?.sync) {
    chrome.storage.sync.get(['customImgSelector', 'customInputSelector'], (res) => {
      if (res?.customImgSelector) customImgSelector.value = res.customImgSelector;
      if (res?.customInputSelector) customInputSelector.value = res.customInputSelector;
    });
  }

  saveBtn.addEventListener('click', () => {
    const config = {
      customImgSelector: customImgSelector.value.trim(),
      customInputSelector: customInputSelector.value.trim()
    };

    if (chrome.storage?.sync) {
      chrome.storage.sync.set(config, () => {
        showToast();
      });
    } else {
      showToast();
    }
  });

  function showToast() {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }
});
