export interface PanelNavItem {
  id: string;
  label: string;
  badge?: string | number;
}

export interface PanelSidebarOptions {
  title?: string;
  label?: string;
  items: readonly PanelNavItem[];
  active: string;
  disabled?: boolean;
  onNavigate: (id: string) => void;
}

export interface PanelHeaderOptions {
  title: string;
  subtitle?: string;
  status?: unknown;
  actions?: unknown;
}

export interface PanelSaveBarOptions {
  status?: unknown;
  save?: unknown;
  cancel?: unknown;
}

/** Render the persistent panel navigation. The caller owns translation and button behavior. */
export function panelSidebar(h: any, options: PanelSidebarOptions): any {
  const items = options.items.map(item => h(
    'button',
    {
      key: item.id,
      type: 'button',
      className: `sidebar-item${options.active === item.id ? ' selected' : ''}`,
      'aria-current': options.active === item.id ? 'page' : undefined,
      disabled: options.disabled,
      onClick: () => options.onNavigate(item.id),
    },
    item.label,
    item.badge === undefined ? null : h('span', {className: 'sidebar-item-badge'}, String(item.badge)),
  ));
  return h(
    'aside',
    {className: 'panel-sidebar'},
    h('div', {className: 'sidebar-brand'}, h('span', {className: 'sidebar-mark', 'aria-hidden': true}, 'D'), h('span', null, options.title ?? 'Bots')),
    h('nav', {className: 'sidebar-nav', 'aria-label': options.label ?? 'Panel navigation'}, ...items),
  );
}

/** Render the common shell around the sidebar, header and content area. */
export function panelShell(h: any, sidebar: any, header: any, content: any, notices: any = null): any {
  return h(
    'div',
    {className: 'app-shell'},
    sidebar,
    h('div', {className: 'app-main'}, h('div', {className: 'app-content'}, header, notices, content)),
  );
}

/** Render a compact page heading with optional status and primary actions. */
export function panelHeader(h: any, options: PanelHeaderOptions): any {
  return h(
    'header',
    {className: 'page-header'},
    h('div', {className: 'page-heading'}, h('h2', null, options.title), options.subtitle ? h('p', {className: 'page-subtitle'}, options.subtitle) : null),
    h('div', {className: 'page-actions'}, options.status ?? null, options.actions ?? null),
  );
}

/** Render the fixed save action row used by draft editors. */
export function panelSaveBar(h: any, options: PanelSaveBarOptions): any {
  return h(
    'div',
    {className: 'save-bar sticky-save-bar'},
    h('div', {className: 'save-state'}, options.status ?? null),
    h('div', {className: 'actions'}, options.cancel ?? null, options.save ?? null),
  );
}

/** Render a two-column workbench while keeping both panes shrink-safe. */
export function panelSplit(h: any, list: any, editor: any): any {
  return h('div', {className: 'split-pane'}, h('aside', {className: 'list-panel'}, list), h('section', {className: 'editor-panel'}, editor));
}

/** Render a compact status pill. `tone` maps to the panel status color tokens. */
export function statusPill(h: any, label: string, tone: 'success' | 'warning' | 'danger' | 'neutral' = 'neutral'): any {
  return h('span', {className: `status-pill ${tone}`, role: 'status'}, label);
}
