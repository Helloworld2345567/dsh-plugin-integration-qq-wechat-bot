export const panelStyles = `
[data-shortcut-modal="settings"]:has(.bot-admin) { width: min(1440px, calc(100vw - 48px)); }
[data-shortcut-modal="settings"]:has(.bot-admin) > div:has(.bot-admin) { min-height: 0; }
[data-shortcut-modal="settings"]:has(.bot-admin) > div:has(.bot-admin) > div:has(.bot-admin) { padding: 0; }
.bot-admin {
  --bg: var(--dsw-alias-bg-base, light-dark(#f5f6f3, #171e1a));
  --surface: var(--dsw-alias-bg-layer-1, light-dark(#fff, #202a24));
  --nested: var(--dsw-alias-bg-layer-2, light-dark(#f9faf7, #253128));
  --ink: var(--dsw-alias-label-primary, light-dark(#263c33, #e4eee7));
  --muted: var(--dsw-alias-label-secondary, light-dark(#68776d, #a4b6a9));
  --line: var(--dsw-alias-border-l1, light-dark(#e4e9e2, #344238));
  --line-strong: var(--dsw-alias-border-l2, light-dark(#ccd6cd, #4d6152));
  --accent: light-dark(#2d6750, #8ec5a4);
  --idle: var(--dsw-alias-state-idle-primary, light-dark(#c1cbc4, #53695b));
  --danger: var(--dsw-alias-state-error-primary, light-dark(#a93a38, #f3918e));
  --success: var(--dsw-alias-state-success-primary, var(--accent));
  --warning: var(--dsw-alias-state-warn-primary, light-dark(#93652b, #e6bd79));
  --overlay: var(--dsw-alias-bg-overlay, #101e1a66);
  container-type: inline-size;
  box-sizing: border-box;
  min-height: 560px;
  width: 100%;
  color: var(--ink);
  background: var(--bg);
  font: 14px/22px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  overflow-wrap: anywhere;
}
.bot-admin * { box-sizing: border-box; }
.bot-admin [hidden] { display: none !important; }
.bot-admin h2 { font-size: 20px; line-height: 28px; margin: 0; font-weight: 500; }
.bot-admin h3 { font-size: 16px; line-height: 1.35; margin: 0; font-weight: 600; }
.bot-admin h4 { font-size: 14px; margin: 0; }
.bot-admin p { margin: 8px 0; }
.bot-admin small, .bot-admin .muted { color: var(--muted); font-size: 12px; }
.bot-admin .app-shell { display: grid; grid-template-columns: 188px minmax(0, 1fr); min-height: 560px; }
.bot-admin .panel-sidebar { position: sticky; top: 0; align-self: start; z-index: 10; display: flex; flex-direction: column; gap: 24px; min-width: 0; padding: 24px 12px; border-right: 1px solid var(--line); background: var(--surface); }
.bot-admin .sidebar-nav { display: grid; gap: 4px; }
.bot-admin .sidebar-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 40px; padding: 8px 12px; border: 1px solid transparent; border-radius: 12px; background: transparent; color: var(--muted); text-align: left; }
.bot-admin .sidebar-item:hover:not(:disabled) { background: var(--nested); color: var(--ink); }
.bot-admin .sidebar-item.selected { border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); color: var(--accent); font-weight: 600; }
.bot-admin .sidebar-item-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bot-admin .sidebar-item-badge { min-width: 20px; color: var(--muted); font-size: 12px; text-align: right; }
.bot-admin .app-main { min-width: 0; background: var(--bg); }
.bot-admin .app-content { width: min(1180px, 100%); margin: 0 auto; padding: 24px; }
.bot-admin .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin: 0 0 24px; }
.bot-admin .page-heading { min-width: 0; }
.bot-admin .page-subtitle { margin: 4px 0 0; color: var(--muted); }
.bot-admin .page-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
.bot-admin .global-status { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; min-height: 32px; padding: 5px 9px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.bot-admin .global-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--idle); }
.bot-admin .global-status-dot.success { background: var(--success); }
.bot-admin .global-status-dot.warning { background: var(--warning); }
.bot-admin .global-status-dot.danger { background: var(--danger); }
.bot-admin .row, .bot-admin .actions, .bot-admin .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bot-admin .spread { justify-content: space-between; }
.bot-admin .toolbar { margin: 0 0 16px; }
.bot-admin .toolbar label { flex: 1; }
.bot-admin button { font: inherit; max-width: 100%; white-space: normal; overflow-wrap: anywhere; min-height: 36px; padding: 7px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink); cursor: pointer; transition: background-color .15s ease, border-color .15s ease, color .15s ease; }
.bot-admin button:hover:not(:disabled) { background: var(--nested); }
.bot-admin button:disabled { opacity: .5; cursor: not-allowed; }
.bot-admin button.primary { border-color: var(--accent); background: var(--accent); color: var(--bg); font-weight: 600; }
.bot-admin button.primary:hover:not(:disabled) { border-color: var(--accent); filter: brightness(1.06); }
.bot-admin button.quiet { border-color: transparent; background: transparent; color: var(--accent); }
.bot-admin button.danger { color: var(--danger); }
.bot-admin .main-nav { display: flex; gap: 22px; border-bottom: 1px solid var(--line); margin-bottom: 20px; }
.bot-admin .main-nav button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; padding: 10px 0; color: var(--muted); }
.bot-admin .main-nav button[aria-current="page"] { border-bottom-color: var(--accent); color: var(--accent); font-weight: 600; }
.bot-admin .subnav { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0; }
.bot-admin .subnav button.selected { border-color: var(--line); background: var(--nested); color: var(--accent); }
.bot-admin .card { padding: 20px; margin-bottom: 16px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
.bot-admin .card:last-child { margin-bottom: 0; }
.bot-admin .item { padding: 14px 0; border-bottom: 1px solid color-mix(in srgb, var(--line) 55%, transparent); }
.bot-admin .item:last-child { border: 0; }
.bot-admin .identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.bot-admin .avatar { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 36px; border-radius: 12px; background: var(--nested); color: var(--accent); font-weight: 600; }
.bot-admin .badge, .bot-admin .status-pill { display: inline-flex; align-items: center; gap: 5px; min-height: 24px; padding: 3px 9px; border-radius: 999px; background: var(--nested); color: var(--muted); font-size: 12px; white-space: nowrap; }
.bot-admin .badge.warning, .bot-admin .status-pill.danger { color: var(--danger); }
.bot-admin .status-pill.success { color: var(--success); }
.bot-admin .status-pill.warning { color: var(--warning); }
.bot-admin .status-pill.neutral { color: var(--muted); }
.bot-admin .workbench { display: grid; gap: 16px; }
.bot-admin .panel-page, .bot-admin .persona-page { display: grid; gap: 16px; min-width: 0; }
.bot-admin .page-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.bot-admin .page-toolbar > div:first-child { min-width: 0; }
.bot-admin .page-toolbar h3 { margin: 0; }
.bot-admin .entity-workspace, .bot-admin .persona-workspace { display: grid; grid-template-columns: 208px minmax(0, 1fr); gap: 24px; min-width: 0; align-items: start; }
.bot-admin .entity-strip { display: grid; align-items: stretch; gap: 6px; min-width: 0; max-width: 100%; padding: 6px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
.bot-admin .entity-strip :is(button, input):focus-visible { outline-offset: -3px; }
.bot-admin .bot-list-row, .bot-admin .persona-list-row { width: 100%; min-height: 84px; min-width: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.bot-admin .bot-list-row { position: relative; }
.bot-admin .bot-list-row.selected, .bot-admin .persona-list-row.selected { border-color: color-mix(in srgb, var(--accent) 60%, var(--line)); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
.bot-admin .bot-list-select { display: flex; flex-direction: column; align-items: stretch; justify-content: space-between; gap: 8px; width: 100%; height: 100%; min-width: 0; padding: 12px; border: 0; border-radius: 11px; background: transparent; text-align: left; }
.bot-admin .bot-list-select:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 5%, transparent); }
.bot-admin .bot-list-row > .danger { position: absolute; top: 4px; right: 4px; padding: 4px 6px; font-size: 12px; }
.bot-admin .bot-list-row:has(> .danger) .identity { padding-right: 40px; }
.bot-admin .bot-list-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.bot-admin .bot-list-meta .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bot-admin .bot-list-meta .badge { flex-shrink: 0; }
.bot-admin .persona-list { min-width: 0; }
.bot-admin .persona-list-row { display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 6px; padding: 14px; text-align: left; }
.bot-admin .persona-list-row > strong, .bot-admin .persona-list-row > small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bot-admin .persona-list-row > .muted { margin-top: auto; }
.bot-admin .persona-editor { min-width: 0; }
.bot-admin .persona-editor-header { margin-bottom: 16px; }
.bot-admin .persona-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.bot-admin .persona-section-nav, .bot-admin .bot-section-nav { display: flex; gap: 8px; min-width: 0; overflow-x: auto; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
.bot-admin .persona-section-nav button, .bot-admin .bot-section-nav button { flex-shrink: 0; border-color: transparent; background: transparent; color: var(--muted); }
.bot-admin .persona-section-nav button.selected, .bot-admin .bot-section-nav button.selected { background: var(--nested); color: var(--accent); }
.bot-admin .persona-section-content, .bot-admin .bot-section-content { min-width: 0; }
.bot-admin .bot-section-nav { margin-bottom: 0; }
.bot-admin .bot-danger-zone { padding-top: 12px; border-top: 1px solid var(--line); }
.bot-admin .identity-copy { display: grid; gap: 2px; min-width: 0; text-align: left; }
.bot-admin .identity-copy strong, .bot-admin .identity-copy .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bot-admin .bot-detail { display: grid; gap: 16px; min-width: 0; padding: 20px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
.bot-admin .detail-header, .bot-admin .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.bot-admin .detail-header { padding-bottom: 4px; border-bottom: 1px solid var(--line); }
.bot-admin .detail-section { display: grid; gap: 10px; padding-bottom: 16px; border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
.bot-admin .detail-section:last-child { padding-bottom: 0; border-bottom: 0; }
.bot-admin .trusted-users { display: grid; gap: 6px; }
.bot-admin .trusted-user { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 12px; }
.bot-admin .trusted-user > span { overflow-wrap: anywhere; }
.bot-admin .service-card { display: grid; gap: 14px; }
.bot-admin .service-card .fields { margin: 0; }
.bot-admin .service-config-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.bot-admin .service-priority-wrap { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bot-admin .service-priority-list { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0; padding: 0; }
.bot-admin .service-priority-item { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 5px 7px 5px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--nested); white-space: nowrap; }
.bot-admin .service-priority-item .actions { margin: 0; gap: 4px; }
.bot-admin .service-priority-item .actions button { min-height: 30px; padding: 3px 8px; border-radius: 999px; }
.bot-admin .service-priority-add { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.bot-admin .service-priority-add button { min-height: 36px; padding: 5px 10px; border-radius: 999px; }
.bot-admin .services-page .save-bar { margin-top: 2px; }
.bot-admin .split-pane { display: grid; grid-template-columns: 208px minmax(0, 1fr); gap: 24px; align-items: start; }
.bot-admin .list-panel, .bot-admin .editor-panel { min-width: 0; }
.bot-admin .list-panel { position: sticky; top: 16px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.bot-admin .editor-panel { min-height: 280px; }
.bot-admin .list-items { display: grid; gap: 4px; margin-top: 10px; }
.bot-admin .list-item { display: grid; gap: 3px; width: 100%; padding: 10px; border: 1px solid transparent; border-radius: 12px; background: transparent; color: var(--ink); text-align: left; }
.bot-admin .list-item:hover:not(:disabled) { background: var(--nested); }
.bot-admin .list-item.selected { border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
.bot-admin .list-item-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 12px; }
.bot-admin .section-grid { display: grid; gap: 12px; }
.bot-admin .media-sections { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
.bot-admin .media-card { min-width: 0; }
.bot-admin .media-card > .toggle-row > span { font-size: 15px; font-weight: 600; }
.bot-admin .media-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-items: end; margin-top: 14px; min-width: 0; }
.bot-admin .media-fields-two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.bot-admin .media-fields-four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.bot-admin .media-fields > *, .bot-admin .media-model-picker > * { min-width: 0; }
.bot-admin .media-fields textarea { min-height: 72px; }
.bot-admin .media-model-picker { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 8px; }
.bot-admin .media-fields-four > .full { max-width: 480px; width: 100%; }
.bot-admin .media-card-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; }
.bot-admin .media-card-actions p { margin: 0; }
.bot-admin .media-inline { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.bot-admin .section-card { padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.bot-admin .section-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.bot-admin .section-card-heading h3 { font-size: 15px; }
.bot-admin .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 14px; margin: 16px 0; }
.bot-admin .full { grid-column: 1 / -1; }
.bot-admin .stack { display: grid; gap: 16px; }
.bot-admin .field-group { display: grid; gap: 8px; }
.bot-admin .field-group-title { font-weight: 600; }
.bot-admin details { border-top: 1px solid var(--line); padding: 14px 0; margin-top: 12px; }
.bot-admin summary { cursor: pointer; font-weight: 500; }
.bot-admin .detail-body { display: grid; gap: 14px; margin-top: 14px; }
.bot-admin .save-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: 16px; margin-top: 18px; background: var(--surface); }
.bot-admin .sticky-save-bar, .bot-admin .save-bar.sticky { position: sticky; bottom: 12px; z-index: 5; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 8px 24px color-mix(in srgb, var(--ink) 12%, transparent); }
.bot-admin .save-state { min-width: 0; color: var(--muted); }
.bot-admin .path { overflow-wrap: anywhere; word-break: break-word; }
.bot-admin .empty { padding: 24px 12px; text-align: center; color: var(--muted); }
.bot-admin .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.bot-admin label { display: flex; flex-direction: column; gap: 6px; min-width: 0; color: var(--ink); font-size: 14px; }
.bot-admin input, .bot-admin select, .bot-admin textarea { width: 100%; min-width: 0; min-height: 36px; padding: 6px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink); font: inherit; }
.bot-admin textarea { min-height: 112px; resize: vertical; }
.bot-admin .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 40px; }
.bot-admin button.toggle { position: relative; width: 42px; height: 24px; min-height: 24px; flex: 0 0 42px; padding: 0; border: 0; border-radius: 999px; background: var(--idle); }
.bot-admin button.toggle[aria-checked="true"] { background: var(--accent); }
.bot-admin button.toggle:hover:not(:disabled) { border: 1px solid var(--line-strong); }
.bot-admin .toggle-thumb { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border: 1px solid var(--line); border-radius: 50%; background: var(--surface); transition: transform .16s ease; }
.bot-admin .toggle[aria-checked="true"] .toggle-thumb { transform: translateX(18px); }
.bot-admin .item details { padding: 0; border: 0; margin-top: 6px; }
.bot-admin .item .detail-body { padding: 8px 0; }
.bot-admin .item p { margin: 4px 0; }
.bot-admin .directory-field { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 10px; }
.bot-admin .directory-field button { min-height: 38px; }
.bot-admin .preset-row { display: flex; gap: 8px; flex-wrap: wrap; }
.bot-admin .notice, .bot-admin .error { padding: 10px 12px; margin: 0 0 16px; border-radius: 12px; white-space: pre-wrap; background: var(--nested); }
.bot-admin .notice { color: var(--success); }
.bot-admin .error { color: var(--danger); }
.bot-admin .stats-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0 0 16px; }
.bot-admin .stats-card { display: flex; flex-direction: column; gap: 5px; min-width: 0; padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.bot-admin .stats-card strong { font-size: 26px; font-weight: 600; line-height: 1.3; font-variant-numeric: tabular-nums; }
.bot-admin .stats-table-wrap { overflow-x: auto; }
.bot-admin .stats-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.bot-admin .stats-table th, .bot-admin .stats-table td { padding: 10px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
.bot-admin .stats-table td.numeric { text-align: right; font-variant-numeric: tabular-nums; }
.bot-admin .stats-trend { display: grid; grid-template-columns: 80px minmax(40px, 1fr); align-items: center; gap: 8px; margin: 14px 0; font-size: 12px; }
.bot-admin .stats-trend > span:last-child { grid-column: 2; }
.bot-admin .stats-bar-track { height: 8px; overflow: hidden; border-radius: 12px; background: var(--nested); }
.bot-admin .stats-bar { height: 100%; border-radius: 12px; background: var(--accent); }
.bot-admin img { max-width: 100%; height: auto; border-radius: 12px; }
.bot-admin .dialog { width: min(440px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; border-radius: 28px; color: var(--ink); }
.bot-admin dialog.card { margin: auto; }
.bot-admin dialog::backdrop { background: var(--overlay); }
.bot-admin .dialog form { margin: 0; }
.bot-admin .dialog label { margin: 16px 0; }
.bot-admin dialog.card.confirm-dialog { position: fixed; inset: 0; width: min(400px, calc(100vw - 32px)); min-width: 0; max-width: calc(100vw - 32px); height: fit-content; min-height: 0; max-height: calc(100dvh - 32px); margin: auto; padding: 20px; }
.bot-admin .confirm-dialog form { display: grid; gap: 16px; min-width: 0; }
.bot-admin .confirm-dialog :is(h3, p) { margin: 0; overflow-wrap: anywhere; }
.bot-admin .confirm-dialog .actions { justify-content: flex-end; }
.bot-admin dialog.auth-dialog.card { margin: auto; color: var(--ink); width: min(440px, calc(100vw - 40px)); }
.bot-admin .auth-dialog img { display: block; margin: 16px auto 0; max-width: 100%; height: auto; }
.bot-admin :is(button, input, select, textarea, summary):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
@container (max-width: 1180px) {
  .bot-admin .media-fields { grid-template-columns: minmax(0, 1fr); }
  .bot-admin .service-config-fields { grid-template-columns: minmax(0, 1fr); }
  .bot-admin .media-fields-four > .full { max-width: none; }
  .bot-admin .app-shell { grid-template-columns: 1fr; }
  .bot-admin .panel-sidebar { flex-direction: row; align-items: center; gap: 12px; overflow-x: auto; padding: 10px 12px; border-right: 0; border-bottom: 1px solid var(--line); }
  .bot-admin .sidebar-nav { display: flex; gap: 4px; min-width: max-content; }
  .bot-admin .sidebar-item { min-height: 40px; width: auto; padding: 8px 12px; }
  .bot-admin .app-content { padding: 20px 18px 32px; }

}

.bot-admin .field-error { color: var(--danger); font-size: 12px; line-height: 18px; }
.bot-admin :is(input, select, textarea)[aria-invalid="true"] { border-color: var(--danger); }
.bot-admin fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.bot-admin .entity-list { display: grid; gap: 6px; min-width: 0; }
.bot-admin .entity-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 56px; padding: 12px; text-align: left; border-color: transparent; background: transparent; }
.bot-admin .entity-row.selected { border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); color: var(--accent); }
.bot-admin .service-list .entity-row { flex-direction: column; align-items: flex-start; gap: 6px; }
.bot-admin .picker-actions { align-self: end; }
@container (max-width: 760px) {
  .bot-admin .entity-workspace, .bot-admin .persona-workspace, .bot-admin .split-pane { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .bot-admin .entity-strip, .bot-admin .service-list, .bot-admin .list-items { display: flex; overflow-x: auto; overscroll-behavior-x: contain; }
  .bot-admin .bot-list-row, .bot-admin .persona-list-row { flex: 0 0 208px; width: 208px; }
  .bot-admin .service-list .entity-row { flex: 0 0 172px; width: 172px; }
  .bot-admin .list-panel { position: static; }
  .bot-admin .list-item { min-width: 180px; }
}
@container (max-width: 460px) {
  .bot-admin .app-content { padding: 16px 12px 24px; }
  .bot-admin .page-header { display: grid; gap: 12px; }
  .bot-admin .page-actions { justify-content: flex-start; }
  .bot-admin .stats-cards { gap: 7px; }
  .bot-admin .stats-card { padding: 10px; }
  .bot-admin .stats-card strong { font-size: 22px; }
  .bot-admin .card, .bot-admin .section-card { padding: 14px; }
  .bot-admin .directory-field { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .bot-admin * { transition: none !important; } }
@media (pointer: coarse) {
  .bot-admin button:not(.toggle) { min-height: 44px; }
  .bot-admin .toggle-row { min-height: 44px; }
  .bot-admin button.toggle::after { content: ''; position: absolute; inset: -10px 0; }
  .bot-admin input, .bot-admin select, .bot-admin textarea { font-size: 16px; }
}
.bot-admin .workspace-paths { display: grid; gap: 6px; margin-top: 12px; }
.bot-admin .workspace-paths code { overflow-wrap: anywhere; white-space: normal; }
.bot-admin .storage-table-wrap { max-width: 100%; overflow-x: auto; }
.bot-admin .workspace-storage table { width: 100%; text-align: left; border-collapse: collapse; }
.bot-admin .workspace-storage th, .bot-admin .workspace-storage td { padding: 8px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.bot-admin .workspace-storage th, .bot-admin .workspace-storage td:not(:first-child) { white-space: nowrap; overflow-wrap: normal; }
.bot-admin .workspace-storage td:first-child { min-width: 180px; max-width: 360px; }
.bot-admin .workspace-storage .toggle-row > span { display: none; }
.bot-admin .delivery-record { padding: 8px 0; overflow-wrap: anywhere; }
.bot-admin .delivery-record dl > div { display: flex; flex-wrap: wrap; gap: 6px 12px; }
.bot-admin .delivery-record dt { color: var(--muted); }
.bot-admin .delivery-record dd { margin: 0; min-width: 0; }
`;
