type HostLeaveGuardOptions = {
  hasUnsaved: () => boolean;
  dialogOpen: () => boolean;
  confirmLeave: () => Promise<boolean>;
  onError: (error: unknown) => void;
};

export function installHostLeaveGuard(panel: HTMLElement, options: HostLeaveGuardOptions): () => void {
  const host = panel.closest<HTMLElement>('[data-shortcut-modal="settings"]');
  const view = panel.ownerDocument.defaultView;
  if (!host || !view) return () => {};
  const document = panel.ownerDocument;
  const navigation = host.querySelector(':scope > nav');
  const close = host.querySelector<HTMLElement>(':scope > div > div:first-child > button');
  const mask = host.parentElement?.querySelector<HTMLElement>(':scope > [aria-hidden="true"]');
  let pending = false, replaying = false, disposed = false;
  const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const request = (event: Event, target: HTMLElement) => {
    stop(event);
    if (pending || options.dialogOpen()) return;
    pending = true;
    const previous = document.activeElement as HTMLElement | null;
    void Promise.resolve().then(options.confirmLeave).then(accepted => {
      if (disposed) return;
      if (!accepted) { previous?.focus(); return; }
      if (!target.isConnected) return;
      replaying = true;
      try { target.click(); } finally { replaying = false; }
    }).catch(error => { if (!disposed) { previous?.focus(); options.onError(error); } }).finally(() => { pending = false; });
  };
  const click = (event: MouseEvent) => {
    if (replaying || !options.hasUnsaved() || event.button !== 0) return;
    const target = event.target as Element | null;
    if (!target?.closest || panel.contains(target)) return;
    const button = target.closest<HTMLElement>('button');
    if (button && button === close) request(event, button);
    else if (button && navigation?.contains(button) && button.getAttribute('aria-current') !== 'true') request(event, button);
    else if (mask && (target === mask || mask.contains(target))) request(event, mask);
  };
  const keydown = (event: KeyboardEvent) => {
    if (replaying || !options.hasUnsaved() || options.dialogOpen() || !close || event.key !== 'Escape' || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const top = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="menu"]')].at(-1);
    if (top !== host) return;
    if (event.repeat) { stop(event); return; }
    request(event, close);
  };
  view.addEventListener('click', click, true);
  view.addEventListener('keydown', keydown, true);
  return () => {
    disposed = true;
    view.removeEventListener('click', click, true);
    view.removeEventListener('keydown', keydown, true);
  };
}
