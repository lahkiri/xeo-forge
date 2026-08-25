'use client';

import { useEffect, useState } from 'react';
import { Alert, Button } from '@/components/ui';

type Notice = { tone: 'ok' | 'error'; text: string } | null;

export default function RuntimeSettings({ localMode }: { localMode: boolean }) {
  const [browser, setBrowser] = useState<DesktopBrowserState | null>(null);
  const [policy, setPolicy] = useState<DesktopBrowserPolicy | null>(null);
  const [updates, setUpdates] = useState<DesktopUpdateState | null>(null);
  const [updateSettings, setUpdateSettings] = useState<DesktopUpdateSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!window.xeoDesktop || !localMode) return;
    let alive = true;
    Promise.all([window.xeoDesktop.getBrowserState(), window.xeoDesktop.getUpdateState(), window.xeoDesktop.getUpdateSettings()]).then(([nextBrowser, nextUpdates, nextSettings]) => {
      if (!alive) return;
      setBrowser(nextBrowser); setPolicy(nextBrowser.browserPolicy); setUpdates(nextUpdates); setUpdateSettings(nextSettings);
    }).catch((error) => setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not load runtime state.' }));
    const unsubscribe = window.xeoDesktopEvents?.onUpdateStatus((state) => alive && setUpdates(state));
    return () => { alive = false; unsubscribe?.(); };
  }, [localMode]);

  async function refresh() {
    if (!window.xeoDesktop) return;
    setBusy(true); setNotice(null);
    try { setUpdates(await window.xeoDesktop.checkForUpdate()); setNotice({ tone: 'ok', text: 'Update check completed.' }); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Update check failed.' }); }
    finally { setBusy(false); }
  }

  async function savePolicy(patch: Partial<DesktopBrowserPolicy>) {
    if (!window.xeoDesktop || !policy) return;
    try { const next = await window.xeoDesktop.setBrowserPolicy({ ...policy, ...patch }); setBrowser(next); setPolicy(next.browserPolicy); setNotice({ tone: 'ok', text: 'Browser safety policy saved locally.' }); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save browser policy.' }); }
  }

  async function saveUpdates(patch: Partial<DesktopUpdateSettings>) {
    if (!window.xeoDesktop || !updateSettings) return;
    try { setUpdateSettings(await window.xeoDesktop.setUpdateSettings({ ...updateSettings, ...patch })); setNotice({ tone: 'ok', text: 'Update preferences saved locally.' }); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save update preferences.' }); }
  }

  return <div className="settings-page settings-page-narrow"><header className="settings-page-header"><div><span className="codex-kicker">02 / Desktop runtime</span><h2>Runtime</h2><p>Control local updates and the browser safety boundary without mixing them with agent setup.</p></div></header>{notice && <div className="settings-notice"><Alert tone={notice.tone === 'error' ? 'error' : 'success'} title={notice.tone === 'error' ? 'Action needed' : 'Saved'}>{notice.text}</Alert></div>} {!localMode || !window.xeoDesktop ? <div className="settings-info-card"><span className="settings-empty-mark">i</span><div><h3>Runtime controls are available in the desktop app</h3><p>The browser bridge and update channel are intentionally local-only. The web preview keeps this surface read-only.</p></div></div> : <div className="settings-stack"><section className="settings-panel"><div className="settings-panel-head"><div><span className="codex-kicker">Updates</span><h3>Release channel</h3><p>{updates?.message || 'No update check has run in this session.'}</p></div><Button size="sm" variant="secondary" loading={busy} onClick={() => void refresh()}>Check now</Button></div>{updateSettings && <div className="settings-inline-controls"><label>Channel<select className="settings-input" value={updateSettings.channel} onChange={(event) => void saveUpdates({ channel: event.target.value as DesktopUpdateSettings['channel'] })}><option value="latest">Stable</option><option value="beta">Preview</option></select></label><label className="settings-check"><input type="checkbox" checked={updateSettings.autoCheck} onChange={(event) => void saveUpdates({ autoCheck: event.target.checked })} /> Check automatically</label></div>}</section><section className="settings-panel"><div className="settings-panel-head"><div><span className="codex-kicker">Browser boundary</span><h3>{browser?.connected ? 'Browser connected' : 'No browser connected'}</h3><p>{browser?.selectedProfile?.browserName || 'Connect the desktop browser extension when a task needs it.'}</p></div><span className={browser?.connected ? 'settings-status-chip is-on' : 'settings-status-chip is-off'}>{browser?.connected ? 'Connected' : 'Optional'}</span></div>{policy && <div className="settings-policy-list"><label className="settings-check"><input type="checkbox" checked={policy.interactionEnabled} onChange={(event) => void savePolicy({ interactionEnabled: event.target.checked })} /> Allow browser interaction</label><label className="settings-check"><input type="checkbox" checked={policy.redactSensitiveData} onChange={(event) => void savePolicy({ redactSensitiveData: event.target.checked })} /> Redact sensitive data</label><label className="settings-check"><input type="checkbox" checked={policy.allowSensitiveActions} onChange={(event) => void savePolicy({ allowSensitiveActions: event.target.checked })} /> Allow sensitive actions</label></div>}</section></div>}</div>;
}
