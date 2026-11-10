export const panelStyles = `
[data-shortcut-modal="settings"]:has(.bot-admin) { width: min(1440px, calc(100vw - 48px)); }
[data-shortcut-modal="settings"]:has(.bot-admin) > div:has(.bot-admin) { min-height: 0; }
[data-shortcut-modal="settings"]:has(.bot-admin) > div:has(.bot-admin) > div:has(.bot-admin) { padding: 0; }
@media (max-width: 680px) {
  [data-shortcut-modal="settings"]:has(.bot-admin) { flex-direction: column; }
  [data-shortcut-modal="settings"]:has(.bot-admin) > nav { width: 100%; min-width: 0; gap: 12px; padding: 16px 12px 8px; }
  [data-shortcut-modal="settings"]:has(.bot-admin) > nav > :first-child { padding: 0 4px; }
  [data-shortcut-modal="settings"]:has(.bot-admin) > nav > :last-child { flex-direction: row; overflow-x: auto; }
  [data-shortcut-modal="settings"]:has(.bot-admin) > nav > :last-child > button { flex: 0 0 auto; }
  [data-shortcut-modal="settings"]:has(.bot-admin) > nav > :last-child > button[aria-current="true"] { order: -1; }
  [data-shortcut-modal="settings"]:has(.bot-admin) > div:has(.bot-admin) > :first-child { position: absolute; top: 0; right: 0; height: 52px; padding: 12px; }
}
.bot-admin {
  --bg: var(--dsw-alias-bg-base);
  --surface: var(--dsw-alias-bg-layer-1);
  --nested: var(--dsw-alias-bg-layer-2);
  --ink: var(--dsw-alias-label-primary);
  --muted: var(--dsw-alias-label-secondary);
  --line: var(--dsw-alias-border-l1);
  --line-strong: var(--dsw-alias-border-l2);
  --accent: var(--dsw-alias-brand-primary);
  --idle: var(--dsw-alias-state-idle-primary);
  --danger: var(--dsw-alias-state-error-primary);
  --success: var(--dsw-alias-state-success-primary);
  --warning: var(--dsw-alias-state-warn-primary);
  container-type: inline-size;
  box-sizing: border-box;
  min-height: 560px;
  width: 100%;
  color: var(--ink);
  background: var(--bg);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  overflow-wrap: anywhere;
}
.bot-admin * { box-sizing: border-box; }
.bot-admin [hidden] { display: none !important; }
.bot-admin h2 { font-size: 22px; line-height: 1.3; margin: 0; font-weight: 650; }
.bot-admin h3 { font-size: 16px; line-height: 1.35; margin: 0; font-weight: 600; }
.bot-admin h4 { font-size: 14px; margin: 0; }
.bot-admin p { margin: 8px 0; }
.bot-admin small, .bot-admin .muted { color: var(--muted); font-size: 12px; }
.bot-admin .app-shell { display: grid; grid-template-columns: 224px minmax(0, 1fr); min-height: 560px; }
.bot-admin .panel-sidebar { display: flex; flex-direction: column; gap: 24px; min-width: 0; padding: 22px 14px; border-right: 1px solid var(--line); background: var(--surface); }
.bot-admin .sidebar-brand { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 10px; font-weight: 650; }
.bot-admin .sidebar-mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--accent); color: var(--bg); font-size: 14px; font-weight: 750; }
.bot-admin .sidebar-nav { display: grid; gap: 4px; }
.bot-admin .sidebar-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 38px; padding: 8px 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--muted); text-align: left; }
.bot-admin .sidebar-item:hover:not(:disabled) { background: var(--nested); color: var(--ink); }
.bot-admin .sidebar-item.selected { border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); color: var(--accent); font-weight: 600; }
.bot-admin .sidebar-item-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bot-admin .sidebar-item-badge { min-width: 20px; color: var(--muted); font-size: 12px; text-align: right; }
.bot-admin .app-main { min-width: 0; background: var(--bg); }
.bot-admin .app-content { width: min(1180px, 100%); margin: 0 auto; padding: 28px 32px 40px; }
.bot-admin .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin: 0 0 24px; }
.bot-admin .page-heading { min-width: 0; }
.bot-admin .page-subtitle { margin: 4px 0 0; color: var(--muted); }
.bot-admin .page-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
.bot-admin .global-status { display: inline-flex; align-items: center; gap: 8px; min-height: 32px; padding: 5px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.bot-admin .global-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--idle); }
.bot-admin .global-status-dot.success { background: var(--success); }
.bot-admin .global-status-dot.warning { background: var(--warning); }
.bot-admin .global-status-dot.danger { background: var(--danger); }
.bot-admin .row, .bot-admin .actions, .bot-admin .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bot-admin .spread { justify-content: space-between; }
.bot-admin .toolbar { margin: 0 0 16px; }
.bot-admin .toolbar label { flex: 1; }
.bot-admin button { font: inherit; min-height: 36px; padding: 7px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); cursor: pointer; transition: background-color .15s ease, border-color .15s ease, color .15s ease; }
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
.bot-admin .card { padding: 18px; margin-bottom: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.bot-admin .card:last-child { margin-bottom: 0; }
.bot-admin .item { padding: 14px 0; border-bottom: 1px solid color-mix(in srgb, var(--line) 55%, transparent); }
.bot-admin .item:last-child { border: 0; }
.bot-admin .identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.bot-admin .avatar { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 36px; border-radius: 10px; background: var(--nested); color: var(--accent); font-weight: 600; }
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
.bot-admin .entity-workspace, .bot-admin .persona-workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; min-width: 0; align-items: start; }
.bot-admin .entity-strip { display: flex; align-items: stretch; gap: 12px; min-width: 0; max-width: 100%; overflow-x: auto; padding-bottom: 6px; overscroll-behavior-x: contain; }
.bot-admin .entity-strip :is(button, input):focus-visible { outline-offset: -3px; }
.bot-admin .bot-list-row, .bot-admin .persona-list-row { flex: 0 0 208px; width: 208px; height: 128px; min-width: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.bot-admin .bot-list-row { position: relative; }
.bot-admin .bot-list-row.selected, .bot-admin .persona-list-row.selected { border-color: color-mix(in srgb, var(--accent) 60%, var(--line)); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
.bot-admin .bot-list-select { display: flex; flex-direction: column; align-items: stretch; justify-content: space-between; gap: 12px; width: 100%; height: 100%; min-width: 0; padding: 14px; border: 0; border-radius: 11px; background: transparent; text-align: left; }
.bot-admin .bot-list-select:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 5%, transparent); }
.bot-admin .bot-list-row > .danger { position: absolute; top: 4px; right: 4px; padding: 4px 6px; font-size: 12px; }
.bot-admin .bot-list-row:has(> .danger) .identity { padding-right: 40px; }
.bot-admin .bot-list-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.bot-admin .bot-list-meta .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bot-admin .bot-list-meta .badge { flex-shrink: 0; }
.bot-admin .entity-create { display: grid; place-items: center; flex: 0 0 128px; width: 128px; height: 128px; padding: 0; border-radius: 12px; color: var(--accent); font-size: 48px; font-weight: 400; line-height: 1; }
.bot-admin .entity-create:hover:not(:disabled) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
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
.bot-admin .bot-detail { display: grid; gap: 16px; min-width: 0; padding: 20px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.bot-admin .detail-header, .bot-admin .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.bot-admin .detail-header { padding-bottom: 4px; border-bottom: 1px solid var(--line); }
.bot-admin .detail-section { display: grid; gap: 10px; padding-bottom: 16px; border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
.bot-admin .detail-section:last-child { padding-bottom: 0; border-bottom: 0; }
.bot-admin .trusted-users { display: grid; gap: 6px; }
.bot-admin .trusted-user { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
.bot-admin .trusted-user > span { overflow-wrap: anywhere; }
.bot-admin .service-card { display: grid; gap: 14px; }
.bot-admin .service-card .fields { margin: 0; }
.bot-admin .overview-service-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.bot-admin .overview-service-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: 9px; }
.bot-admin .overview-service-item strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bot-admin .services-page .save-bar { margin-top: 2px; }
.bot-admin .split-pane { display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); gap: 16px; align-items: start; }
.bot-admin .list-panel, .bot-admin .editor-panel { min-width: 0; }
.bot-admin .list-panel { position: sticky; top: 16px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.bot-admin .editor-panel { min-height: 280px; }
.bot-admin .list-items { display: grid; gap: 4px; margin-top: 10px; }
.bot-admin .list-item { display: grid; gap: 3px; width: 100%; padding: 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--ink); text-align: left; }
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
.bot-admin .section-card { padding: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
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
.bot-admin .sticky-save-bar, .bot-admin .save-bar.sticky { position: sticky; bottom: 12px; z-index: 5; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 24px color-mix(in srgb, var(--ink) 12%, transparent); }
.bot-admin .save-state { min-width: 0; color: var(--muted); }
.bot-admin .path { overflow-wrap: anywhere; word-break: break-word; }
.bot-admin .empty { padding: 24px 12px; text-align: center; color: var(--muted); }
.bot-admin .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.bot-admin label { display: flex; flex-direction: column; gap: 6px; min-width: 0; color: var(--muted); font-size: 13px; }
.bot-admin input, .bot-admin select, .bot-admin textarea { width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; }
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
.bot-admin .notice, .bot-admin .error { padding: 10px 12px; margin: 0 0 16px; border-radius: 8px; white-space: pre-wrap; background: var(--nested); }
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
.bot-admin .stats-bar-track { height: 8px; overflow: hidden; border-radius: 8px; background: var(--nested); }
.bot-admin .stats-bar { height: 100%; border-radius: 8px; background: var(--accent); }
.bot-admin img { max-width: 100%; height: auto; border-radius: 10px; }
.bot-admin .dialog-backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 20px; background: var(--dsw-alias-bg-overlay); }
.bot-admin .dialog { width: min(440px, 100%); max-height: 85vh; overflow: auto; }
.bot-admin .dialog label { margin: 16px 0; }
.bot-admin :is(button, input, select, textarea, summary):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
@container (max-width: 760px) {
  .bot-admin .media-fields { grid-template-columns: minmax(0, 1fr); }
  .bot-admin .media-fields-four > .full { max-width: none; }
  .bot-admin .app-shell { grid-template-columns: 1fr; }
  .bot-admin .panel-sidebar { position: sticky; top: 0; z-index: 10; flex-direction: row; align-items: center; gap: 12px; overflow-x: auto; padding: 10px 12px; border-right: 0; border-bottom: 1px solid var(--line); }
  .bot-admin .sidebar-brand { flex: 0 0 auto; padding: 0 4px; }
  .bot-admin .sidebar-nav { display: flex; gap: 4px; min-width: max-content; }
  .bot-admin .sidebar-item { min-height: 34px; width: auto; padding: 6px 10px; }
  .bot-admin .app-content { padding: 20px 18px 32px; }
  .bot-admin .split-pane { grid-template-columns: 1fr; }
  .bot-admin .list-panel { position: static; }
  .bot-admin .list-items { display: flex; overflow-x: auto; }
  .bot-admin .list-item { min-width: 180px; }
}
@container (max-width: 460px) {
  .bot-admin .app-content { padding: 16px 12px 24px; }
  .bot-admin .page-header { display: grid; gap: 12px; }
  .bot-admin .page-actions { justify-content: flex-start; }
  .bot-admin .stats-cards { gap: 7px; }
  .bot-admin .stats-card { padding: 10px; }
  .bot-admin .stats-card strong { font-size: 22px; }
  .bot-admin .overview-service-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
`;
