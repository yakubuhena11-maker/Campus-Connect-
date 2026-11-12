// Keep admin notices visible after any controller displays a success or error.
const notice = document.querySelector('#admin-notice');
if (notice) {
  const observer = new MutationObserver(() => {
    if (!notice.hidden && notice.textContent.trim()) {
      notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  observer.observe(notice, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
}
