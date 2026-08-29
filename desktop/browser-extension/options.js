const profileNameInput = document.querySelector('#profileName');
const portInput = document.querySelector('#port');
const tokenInput = document.querySelector('#token');
const status = document.querySelector('#status');

chrome.storage.local.get({ port: 4321, token: '', profileName: '' }).then(({ port, token, profileName }) => {
  profileNameInput.value = String(profileName || '');
  portInput.value = String(port);
  tokenInput.value = token;
});

document.querySelector('#save').addEventListener('click', async () => {
  const profileName = profileNameInput.value.trim().slice(0, 80) || 'Browser profile';
  const port = Number(portInput.value);
  const token = tokenInput.value.trim();
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    status.textContent = 'Enter a valid profile name and port.';
    return;
  }
  if (token && token.length < 32) {
    status.textContent = 'The manual token looks incomplete — leave it blank to connect by pairing approval instead.';
    return;
  }
  await chrome.storage.local.set({ port, token, profileName });
  status.textContent = token
    ? 'Saved. The extension will connect with the manual token.'
    : 'Saved. The extension will request pairing — approve it in Xeo Forge → Settings → Runtime. No token needed.';
});
