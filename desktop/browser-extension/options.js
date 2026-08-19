const portInput = document.querySelector('#port');
const tokenInput = document.querySelector('#token');
const status = document.querySelector('#status');

chrome.storage.local.get({ port: 4321, token: '' }).then(({ port, token }) => {
  portInput.value = String(port);
  tokenInput.value = token;
});

document.querySelector('#save').addEventListener('click', async () => {
  const port = Number(portInput.value);
  const token = tokenInput.value.trim();
  if (!Number.isInteger(port) || port < 1 || port > 65535 || token.length < 32) {
    status.textContent = 'Enter a valid port and the complete local token.';
    return;
  }
  await chrome.storage.local.set({ port, token });
  status.textContent = 'Saved. The extension will connect to Xeo Forge locally.';
});
